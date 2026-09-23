/**
 * Recording what happened: a dose, an appointment, a note.
 */

import { z } from 'zod';
import { applyAppointment } from '../../domain/appointments.js';
import { require as requireCap } from '../../domain/auth.js';
import { orphanedBy } from '../../domain/inference.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken } from '../text.js';
import { describeError, guidance, reply, type ToolContext } from '../toolkit.js';

/**
 * "I used my eye drops."
 */
export function registerLogCareEvent({ server, store, now, actor }: ToolContext): void {
  server.registerTool('log_care_event', {
    title: 'Log something that happened',
    description:
      'Record that something happened - a medication taken, a meal eaten, a check-in, '
      + 'how someone is feeling. Use this for things that ALREADY happened. For something '
      + 'scheduled in the future use record_appointment instead; for an observation or '
      + 'concern with no action attached use add_note.',
    inputSchema: {
      kind: z.enum(['medication_taken', 'check_in'])
        .describe('What sort of event this is.'),
      medicationName: z.string().optional()
        .describe('For medication_taken: what they took, as they said it (e.g. "heart pill").'),
      detail: z.string().optional()
        .describe('Anything else they said about it, kept verbatim for the record.'),
      occurredAt: z.string().optional()
        .describe('ISO timestamp if they said when. Defaults to now if they did not.'),
      aboutMemberId: z.string().optional()
        .describe('Only when logging on behalf of someone else. Defaults to the speaker.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: OUT.log_care_event,
  }, async ({ kind, medicationName, detail, occurredAt, aboutMemberId }) => {
    try {
      const me = actor();
      const subject = aboutMemberId ?? me.id;
      requireCap(me, subject === me.id ? 'log_own_event' : 'log_others_event');

      const meds = store.getMedications(me.householdId);
      let medicationId: string | undefined;
      if (kind === 'medication_taken' && medicationName) {
        const needle = medicationName.toLowerCase();
        const matches = meds.filter((m) => m.name.toLowerCase().includes(needle)
          || needle.includes(m.name.toLowerCase()));
        if (matches.length > 1) {
          // Ambiguity is resolved by asking, never by picking the first match.
          return guidance(
            `More than one medication matches "${medicationName}": `
            + `${joinSpoken(matches.map((m) => m.name))}. Ask which one they mean, then call this again.`,
          );
        }
        medicationId = matches[0]?.id;
      }

      const event = await store.appendEvent({
        householdId: me.householdId,
        kind,
        reportedBy: me.id,
        occurredAt: occurredAt ?? now().toISOString(),
        source: 'voice',
        confidence: 'reported',
        ...(detail ? { detail } : {}),
        data: {
          ...(medicationId ? { medicationId } : {}),
          ...(medicationName ? { medicationName } : {}),
          aboutMemberId: subject,
        },
      });

      // A dose logged against a medication we don't know about is still recorded -
      // we just can't use it to clear a scheduled dose, and we say so.
      const unknownMed = kind === 'medication_taken' && medicationName && !medicationId;
      const spoken = kind === 'medication_taken'
        ? (unknownMed
          ? `Got it, I've noted the ${medicationName}. That one isn't on the schedule I have, so I can't match it to a dose.`
          : `Got it, I've logged the ${medicationName}.`)
        : "Thanks, I've noted that.";
      return reply(spoken, { eventId: event.id, matchedMedication: medicationId ?? null });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "The eye check-up is Thursday at ten."
 */
export function registerRecordAppointment({ server, store, now, actor }: ToolContext): void {
  server.registerTool('record_appointment', {
    title: 'Record an appointment',
    description:
      'Record a scheduled appointment or any future dated commitment the person mentions '
      + '- a doctor\'s visit, a haircut, book club on Wednesday, a birthday. It does not '
      + 'have to be medical: use this, not add_note, whenever there is a date and time. '
      + 'It also works out what the appointment probably requires - only a MEDICAL one '
      + 'proposes a ride or a companion - and PROPOSES that work for a human to confirm. '
      + 'Proposals are guesses and are never treated as real until confirmed with '
      + 'confirm_proposal. Tell the person what was proposed and ask.',
    inputSchema: {
      kind: z.string().describe('What the appointment is, as said (e.g. "cardiology", "dentist").'),
      startsAt: z.string().describe(
        'ISO 8601 timestamp of when it starts, in the household\'s local time '
        + '(e.g. "2026-09-24T10:00:00"). Resolve "Thursday" against today\'s date - '
        + 'never guess a date, and ask which day they meant if it is not clear.',
      ),
      forMemberId: z.string().optional().describe('Who it is for. Defaults to the care recipient.'),
      detail: z.string().optional().describe('Anything else said about it.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: OUT.record_appointment,
  }, async ({ kind, startsAt, forMemberId, detail }) => {
    try {
      const me = actor();
      requireCap(me, 'create_obligation');
      // Spoken by a person, so it travels the shared appointment path as `voice` /
      // `reported`. The Google Calendar connector calls the same applyAppointment with
      // `calendar` / `observed` - identical logic, honest about where it came from.
      const result = await applyAppointment(store, me.householdId, {
        kind,
        startsAt,
        ...(forMemberId ? { forMemberId } : {}),
        ...(detail ? { detail } : {}),
        reportedBy: me.id,
        source: 'voice',
        confidence: 'reported',
      }, now());

      if (!result.ok) return guidance(result.spoken);
      return reply(result.spoken, {
        eventId: result.eventId,
        proposals: result.proposals,
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "Daddy sounded tired on the phone."
 */
export function registerAddNote({ server, store, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool('add_note', {
    title: 'Add a note to the care record',
    description:
      'Record an observation, concern, or piece of context that the rest of the family '
      + 'should see - "Mom sounded tired", "the doctor changed her dose". Use this when '
      + 'there is something to SAY but nothing specific that must be DONE. If someone needs '
      + 'to take an action, use record_appointment or let the note stand and let them claim it.\n\n'
      + 'IMPORTANT: if the person says they (or someone) will be UNAVAILABLE - "I can\'t drive '
      + 'Thursday", "I won\'t be able to make Friday after all", "Renee is away next week" - '
      + 'this is still an add_note, with `unavailable` filled in. It is never "nothing to do": '
      + 'work that person was covering may quietly stop being covered, and that silence is '
      + 'exactly what this system exists to catch.',
    inputSchema: {
      note: z.string().describe('The observation, in the words it was said.'),
      aboutMemberId: z.string().optional().describe('Who it concerns. Defaults to the care recipient.'),
      unavailable: z.object({
        memberName: z.string().describe('Who is unavailable, as the speaker named them.'),
        from: z.string().describe('ISO start of the window they cannot cover.'),
        to: z.string().describe('ISO end of the window.'),
      }).optional().describe('Set when the note says someone cannot do something in a time window.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: OUT.add_note,
  }, async ({ note, aboutMemberId, unavailable }) => {
    try {
      const me = actor();
      const s = state();
      const about = aboutMemberId ?? s.members.find((m) => m.role === 'care_recipient')?.id;
      const event = await store.appendEvent({
        householdId: me.householdId,
        kind: 'note_added',
        reportedBy: me.id,
        occurredAt: now().toISOString(),
        source: 'voice',
        confidence: 'reported',
        detail: note,
        data: { aboutMemberId: about, ...(unavailable ? { unavailable } : {}) },
      });

      if (!unavailable) {
        return reply("I've added that to the care record.", { eventId: event.id });
      }

      // A constraint does not create work - it can orphan work that already has an
      // owner. Nobody says "create a task"; somebody says they can't make Thursday.
      const person = store.findMemberByName(me.householdId, unavailable.memberName);
      if (!person) {
        return reply("I've added that to the care record.", { eventId: event.id });
      }
      const orphaned = orphanedBy(
        { memberId: person.id, from: unavailable.from, to: unavailable.to, said: note },
        s.obligations,
        (id) => nameOf(id) ?? 'They',
      );
      if (orphaned.length === 0) {
        return reply("Noted - I'll keep that in mind.", { eventId: event.id, orphaned: [] });
      }

      // Reopen the orphaned work rather than silently reassigning it: CareCircle
      // notices, and asks. It never moves someone else's responsibility on its own.
      for (const o of orphaned) {
        await store.transition(o.obligationId, me.householdId, 'OPEN', me.id, { ownerId: null },
          `Owner unavailable: ${note}`);
      }
      return reply(orphaned[0]!.ask, {
        eventId: event.id,
        orphaned: orphaned.map((o) => ({ obligationId: o.obligationId, what: o.what })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}
