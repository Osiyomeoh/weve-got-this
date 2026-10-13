/**
 * Setting a family up, one step at a time, and changing who is in the circle.
 */

import { subjectOf } from '../../domain/who.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { require as requireCap } from '../../domain/auth.js';
import { onboardingProgress } from '../../domain/onboarding.js';
import { bootstrapSubject } from '../../http/identity.js';
import { OUT } from '../output-schemas.js';
import { countPhrase, joinSpoken, sentence } from '../text.js';
import {
  ALSO_CALLED,
  describeError,
  guidance,
  isValidTimeZone,
  namesFrom,
  reply,
  type ToolContext,
  validMedicationTimes,
} from '../toolkit.js';

/**
 * First run: guide a new family in.
 *
 * Every setup tool already exists; this is the thing that tells a newcomer where
 * they are and what the one next step is, so onboarding is a guided conversation
 * rather than a toolbox. Read-only, and deterministic: the step is recomputed from
 * the record every time, so it can never drift from what is actually set up.
 */
export function registerGetStarted({ server, actorId, now, state }: ToolContext): void {
  server.registerTool(
    'get_started',
    {
      title: 'Set up, or pick up where setup left off',
      description:
        'Call this FIRST whenever someone new arrives, asks to get set up, says "set up a ' +
        'care circle", or seems not to belong to a circle yet. It returns the single next ' +
        'onboarding step, already phrased to speak: create the circle, add the person being ' +
        'cared for, add one medication or appointment, or - once there is enough - the first ' +
        'thing that needs an owner. Follow the spoken step, do that one action with the ' +
        'matching tool (create_household, add_member, add_medication, record_appointment), ' +
        'then call get_started again for the next step. Do not ask for everything at once.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
      outputSchema: OUT.get_started,
    },
    async () => {
      try {
        // An unmapped-but-authenticated caller belongs to no circle yet - the one moment
        // create_household is the only move, and the only time state is null.
        const unmapped = bootstrapSubject(actorId) !== null;
        const progress = onboardingProgress(unmapped ? null : state(), { now: now() });
        return reply(progress.spoken, {
          step: progress.step,
          done: progress.done,
          complete: progress.complete,
          ...(progress.firstGap ? { firstGap: progress.firstGap } : {}),
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Set up a care circle for my dad."
 */
export function registerCreateHousehold({ server, store, actorId }: ToolContext): void {
  server.registerTool(
    'create_household',
    {
      title: 'Create a new care circle',
      description:
        'Start a brand-new care circle. This is the one action available to someone who ' +
        'is authenticated but not yet part of any circle: it creates the household and ' +
        'makes the caller its first primary caregiver. Everyone else joins an existing ' +
        'circle via add_member.',
      inputSchema: {
        name: z.string().describe('A name for the care circle, e.g. "Margaret\'s care circle".'),
        timezone: z
          .string()
          .describe('IANA timezone, e.g. "America/New_York". Medication times are read in it.'),
        callerName: z.string().describe("The founding caregiver's name, as they gave it."),
        spokenAs: z
          .string()
          .optional()
          .describe('How the caller is referred to when spoken about.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.create_household,
    },
    async ({ name, timezone, callerName, spokenAs }) => {
      try {
        const subject = bootstrapSubject(actorId);
        if (!subject) {
          return guidance(
            "You already belong to a care circle, so I can't start a new one for you here.",
          );
        }
        if (!isValidTimeZone(timezone)) {
          return guidance(
            `"${timezone}" isn't a timezone I recognise. Use an IANA name like "America/New_York".`,
          );
        }
        const householdId = `h_${randomUUID()}`;
        const memberId = `m_${randomUUID()}`;
        await store.addHousehold({ id: householdId, name, timezone });
        await store.addMember({
          id: memberId,
          householdId,
          name: callerName,
          role: 'primary_caregiver',
          ...(spokenAs ? { spokenAs } : {}),
        });
        await store.mapIdentity({ subject, memberId, householdId });
        return reply(
          `Done - "${name}" is set up, and you're its primary caregiver. Add the rest of the family with add_member.`,
          { householdId, memberId },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Add my sister Funmi to the circle."
 */
export function registerAddMember({ server, store, actor }: ToolContext): void {
  server.registerTool(
    'add_member',
    {
      title: 'Add someone to the care circle',
      description:
        'Add a member to this care circle and give them a role: care_recipient, ' +
        'primary_caregiver, caregiver, or helper. Only a primary caregiver can do this. ' +
        'If the new member will sign in, pass the subject their credential carries so ' +
        'they resolve to this member.',
      inputSchema: {
        name: z.string().describe('Their name.'),
        role: z
          .enum(['care_recipient', 'primary_caregiver', 'caregiver', 'helper'])
          .describe('Their authority in the circle.'),
        spokenAs: z.string().optional().describe('How they are referred to when spoken about.'),
        subject: z
          .string()
          .optional()
          .describe('The credential subject that authenticates as this member.'),
        needsAccessibleTransport: z
          .boolean()
          .optional()
          .describe(
            'Getting them places needs an accessible vehicle. Raises the risk of a dropped ride.',
          ),
        requiresAssistance: z
          .boolean()
          .optional()
          .describe('Their care needs someone who can give hands-on help, not just anyone free.'),
        livesAway: z
          .string()
          .optional()
          .describe(
            'Where they live, if far away (e.g. "London"). They will never be picked ' +
              'automatically for work that needs someone there.',
          ),
        dailyUpdate: z
          .boolean()
          .optional()
          .describe('Send them a short update on the day every evening.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.add_member,
    },
    async ({
      name,
      role,
      spokenAs,
      subject,
      needsAccessibleTransport,
      requiresAssistance,
      livesAway,
      dailyUpdate,
    }) => {
      try {
        const me = actor();
        requireCap(me, 'manage_circle');
        const memberId = `m_${randomUUID()}`;
        // Only record attributes that were actually set, so "unspecified" stays unspecified
        // rather than being written as an explicit "no need".
        const attributes = {
          ...(needsAccessibleTransport ? { needsAccessibleTransport } : {}),
          ...(requiresAssistance ? { requiresAssistance } : {}),
        };
        await store.addMember({
          id: memberId,
          householdId: me.householdId,
          name,
          role,
          ...(spokenAs ? { spokenAs } : {}),
          ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
          ...(livesAway?.trim() ? { livesAway: livesAway.trim() } : {}),
          ...(dailyUpdate ? { dailyUpdate } : {}),
        });
        if (subject) await store.mapIdentity({ subject, memberId, householdId: me.householdId });
        const extras = [
          ...(livesAway?.trim() ? [`I won't pick ${name} for things that need someone there`] : []),
          ...(dailyUpdate ? [`${name} will get an update every evening`] : []),
        ];
        return reply(
          `Added ${name} to the circle as ${role.replace('_', ' ')}.` +
            (extras.length > 0 ? ` ${sentence(joinSpoken(extras))}.` : ''),
          { memberId },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "He takes his eye drops at 8 and 8."
 */
export function registerAddMedication({ server, store, actor, state, now }: ToolContext): void {
  server.registerTool(
    'add_medication',
    {
      title: 'Add a medication schedule',
      description:
        'Record a medication and the times it is due, so missing doses can be noticed. ' +
        'Times are 24-hour "HH:MM" in the household timezone. Only a primary caregiver ' +
        'can do this.',
      inputSchema: {
        name: z.string().describe('The medication, as the family calls it (e.g. "heart pill").'),
        times: z.array(z.string()).describe('Due times, 24-hour "HH:MM", e.g. ["08:00","20:00"].'),
        until: z
          .string()
          .optional()
          .describe(
            'The last day, "YYYY-MM-DD" in the household\'s time, when it is for a set course ("for two weeks").',
          ),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Who it is for: their name as the family says it (e.g. "Mum"), or their id. Leave it out when only one person is being cared for.',
          ),
        alsoCalled: ALSO_CALLED,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.add_medication,
    },
    async ({ name, times, forMemberId, until, alsoCalled }) => {
      try {
        const me = actor();
        requireCap(me, 'manage_circle');
        if (!validMedicationTimes(times)) {
          return guidance(
            'I need the dose times as 24-hour "HH:MM" - for example ["08:00","20:00"]. Say them again that way.',
          );
        }
        const who = subjectOf(state(), forMemberId, 'this medication');
        if ('problem' in who) return guidance(who.problem);
        const forId = who.member.id;
        const id = `med_${randomUUID()}`;
        if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until))
          return guidance(
            'I need the last day as a date, like "2026-10-07". Ask which day they meant.',
          );
        const names = namesFrom(alsoCalled);
        await store.addMedication({
          id,
          householdId: me.householdId,
          name,
          times,
          forMemberId: forId,
          since: now().toISOString(),
          ...(until ? { until } : {}),
          ...(names ? { names } : {}),
        });
        const called = names
          ? ` (also called ${joinSpoken(Object.values(names).map((n) => `"${n}"`))})`
          : '';
        return reply(
          `Added ${name}${called} at ${joinSpoken(times)}${until ? `, until ${until}` : ''}.`,
          { medicationId: id },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Take Musa off the circle."
 */
export function registerRemoveMember({ server, store, actor }: ToolContext): void {
  server.registerTool(
    'remove_member',
    {
      title: 'Remove someone from the care circle',
      description:
        'Remove a member. Their open work is not deleted - it is released back to the ' +
        'circle as unowned, so it resurfaces as a Care Gap rather than vanishing. Only ' +
        'a primary caregiver can do this, and the last primary caregiver cannot be ' +
        'removed.',
      inputSchema: {
        memberId: z.string().describe('Who to remove.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      outputSchema: OUT.remove_member,
    },
    async ({ memberId }) => {
      try {
        const me = actor();
        requireCap(me, 'manage_circle');
        if (memberId === me.id) return guidance("You can't remove yourself from the circle.");
        const target = store.getMember(memberId);
        if (
          target.role === 'primary_caregiver' &&
          store.membersWithRole(me.householdId, 'primary_caregiver').length <= 1
        ) {
          return guidance(
            "That's the only primary caregiver - add another before removing this one.",
          );
        }
        const { released } = await store.removeMember(me.householdId, memberId);
        const tail =
          released > 0
            ? ` ${countPhrase(released, 'piece')} of their work is back on the board.`
            : '';
        return reply(`Removed ${target.name} from the circle.${tail}`, { memberId, released });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}
