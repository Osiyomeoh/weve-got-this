/**
 * Recording what happened: a dose, an appointment, a note.
 */

import { activeMedications } from '../../domain/care-changes.js';
import { careRecipients, subjectOf } from '../../domain/who.js';
import { z } from 'zod';
import { currentChannel } from '../channel.js';
import { applyAppointment } from '../../domain/appointments.js';
import { require as requireCap } from '../../domain/auth.js';
import { orphanedBy } from '../../domain/inference.js';
import { asTask, clockTime, dueSpoken, happenedAt } from '../../domain/local-time.js';
import { doseRecord, localParts, parseHHMM, spokenClock } from '../../domain/gaps.js';
import { namesMedicine } from '../../domain/language.js';
import type { CareEvent, CareState } from '../../domain/types.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken } from '../text.js';
import { closed, describeError, guidance, reply, type ToolContext } from '../toolkit.js';

/**
 * "I used my eye drops."
 */
export function registerLogCareEvent({
  server,
  store,
  now,
  actor,
  state,
  nameOf,
}: ToolContext): void {
  server.registerTool(
    'log_care_event',
    {
      title: 'Log something that happened',
      description:
        'Record that something happened - a medication taken, a meal eaten, a check-in, ' +
        'how someone is feeling. Use this for things that ALREADY happened. A question about ' +
        'whether something happened ("did he use his drops?") is not a report that it did: ' +
        'answer it, never log it. For something ' +
        'scheduled in the future use record_appointment instead; for an observation or ' +
        'concern with no action attached use add_note. When what happened is that a task ' +
        'or errand got done - a ride given, a pickup made, a job finished - that closes ' +
        'the task: use resolve_obligation. In Nigerian Pidgin "I don take am", "I don use my ' +
        'drops" means it HAS been done ("don" marks the past, not "don\'t"). Only for the care ' +
        'of someone in this circle: never a smart-home action (lights, a vacuum, a coffee maker).',
      inputSchema: {
        kind: z.enum(['medication_taken', 'check_in']).describe('What sort of event this is.'),
        medicationName: z
          .string()
          .optional()
          .describe('For medication_taken: what they took, as they said it (e.g. "heart pill").'),
        notOnSchedule: z
          .boolean()
          .optional()
          .describe(
            'For medication_taken: true only when they confirmed it is a medicine that is not on their schedule.',
          ),
        detail: z
          .string()
          .optional()
          .describe('Anything else they said about it, kept verbatim for the record.'),
        occurredAt: z
          .string()
          .optional()
          .describe('ISO timestamp if they said when. Defaults to now if they did not.'),
        aboutMemberId: z
          .string()
          .optional()
          .describe(
            'Only when logging on behalf of someone else: their name as the family says it (e.g. "Dad"), or their id. Defaults to the speaker.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.log_care_event,
    },
    async ({ kind, medicationName, notOnSchedule, detail, occurredAt, aboutMemberId }) => {
      try {
        const me = actor();
        let subject = me.id;
        if (aboutMemberId) {
          const who = subjectOf(state(), aboutMemberId);
          if ('problem' in who) return guidance(who.problem);
          subject = who.member.id;
        }
        requireCap(me, subject === me.id ? 'log_own_event' : 'log_others_event');

        const meds = activeMedications(state(), now());
        const whose =
          subject === me.id ? 'your' : nameOf(subject) ? `${nameOf(subject)}'s` : 'their';
        let medicationId: string | undefined;
        if (kind === 'medication_taken' && !medicationName) {
          // "He took his medicine": which one decides which dose is cleared, so ask first.
          const scheduled = meds.filter((m) => m.forMemberId === subject);
          if (scheduled.length > 0) {
            return guidance(
              `Which medicine was it? ${whose[0]!.toUpperCase() + whose.slice(1)} schedule has: ` +
                `${joinSpoken(scheduled.map((m) => `"${m.name}"`))}. Ask them, then call this again with that name.`,
            );
          }
        }
        if (kind === 'medication_taken' && medicationName) {
          // By any name the family gave it: "colírio" is Mum's eye drops on the first call.
          const named = meds.filter((m) => namesMedicine(medicationName, m));
          // Two people on eye drops: the one this is about decides whose dose it was.
          const theirs = named.filter((m) => m.forMemberId === subject);
          const matches = named.length > 1 && theirs.length > 0 ? theirs : named;
          if (matches.length > 1) {
            // Ambiguity is resolved by asking, never by picking the first match.
            return guidance(
              `More than one medication matches "${medicationName}": ` +
                `${joinSpoken(matches.map((m) => m.name))}. Ask which one they mean, then call this again.`,
            );
          }
          medicationId = matches[0]?.id;
          // No name matched, but this person has medicines on their schedule. People say a
          // medicine in their own words and their own language ("colírio", "my drops"): saved
          // as a stray, the dose would never count, and the family would hear "no record" for
          // a dose that was taken. So nothing is saved until the name is settled.
          const scheduled = meds.filter((m) => m.forMemberId === subject);
          if (!medicationId && !notOnSchedule && scheduled.length > 0) {
            return guidance(
              `"${medicationName}" is not a name on ${whose} schedule, which has: ` +
                `${joinSpoken(scheduled.map((m) => `"${m.name}"`))}. If they meant one of these, in another ` +
                'language or other words, call this again with that name exactly as written here. If it ' +
                'really is a medicine that is not on the schedule, call again with notOnSchedule: true. ' +
                'If you cannot tell, ask them which one.',
            );
          }
        }

        const when = happenedAt(occurredAt, state().household.timezone, now());
        if ('problem' in when) return guidance(when.problem);

        // Already a record of this dose? Say so. Someone whose eyes are recovering may not
        // remember, and a relative may log what he already did: a second dose is a real risk.
        // It is still recorded - it is what they told us - but nobody is left unaware.
        const before = medicationId ? sameDose(state(), medicationId, when.at) : undefined;

        const event = await store.appendEvent({
          householdId: me.householdId,
          kind,
          reportedBy: me.id,
          occurredAt: when.at,
          // Their word either way; the channel says whether it was spoken or pressed.
          source: currentChannel() ?? 'voice',
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
        const spoken =
          kind === 'medication_taken'
            ? unknownMed
              ? `Got it, I've noted the ${medicationName}. That one isn't on the schedule I have, so I can't match it to a dose.`
              : medicationName
                ? `Got it, I've logged the ${medicationName}.`
                : "Got it, I've noted the medicine."
            : "Thanks, I've noted that.";
        if (before) {
          const tz = state().household.timezone;
          const who =
            before.record.reportedBy === me.id
              ? 'you'
              : (nameOf(before.record.reportedBy) ?? 'someone');
          return reply(
            `${spoken} Just so you know, there was already a record of the ${spokenClock(before.slot)} dose, ` +
              `at ${clockTime(before.record.occurredAt, tz)}, from ${who}. If that was the same dose, say so and I'll note it.`,
            {
              eventId: event.id,
              matchedMedication: medicationId ?? null,
              alreadyRecorded: { at: before.record.occurredAt, by: before.record.reportedBy },
            },
          );
        }
        return reply(spoken, { eventId: event.id, matchedMedication: medicationId ?? null });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "The eye check-up is Thursday at ten."
 */
export function registerRecordAppointment({ server, store, now, actor }: ToolContext): void {
  server.registerTool(
    'record_appointment',
    {
      title: 'Record an appointment',
      description:
        'Record a scheduled appointment or any future dated commitment the person mentions ' +
        "- a doctor's visit, a haircut, book club on Wednesday, a birthday. It does not " +
        'have to be medical: use this, not add_note, whenever there is a date and time. ' +
        'Not an alarm, a timer or a wake-up call, and not booking a taxi, train or flight: ' +
        'the assistant does those itself. ' +
        'It also works out what the appointment probably requires - only a MEDICAL one ' +
        'proposes a ride or a companion - and PROPOSES that work for a human to confirm. ' +
        'Proposals are guesses and are never treated as real until confirmed with ' +
        'confirm_proposal. Tell the person what was proposed and ask.',
      inputSchema: {
        kind: z
          .string()
          .describe('What the appointment is, as said (e.g. "cardiology", "dentist").'),
        startsAt: z
          .string()
          .describe(
            "ISO 8601 timestamp of when it starts, in the household's local time " +
              '(e.g. "2026-09-24T10:00:00"). Resolve "Thursday" against today\'s date - ' +
              'never guess a date, and ask which day they meant if it is not clear.',
          ),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Who it is for: their name as the family says it (e.g. "Mum"), or their id. Leave it out when only one person is being cared for.',
          ),
        detail: z.string().optional().describe('Anything else said about it.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.record_appointment,
    },
    async ({ kind, startsAt, forMemberId, detail }) => {
      try {
        const me = actor();
        requireCap(me, 'create_obligation');
        // Spoken by a person, so it travels the shared appointment path as `voice` /
        // `reported`. The Google Calendar connector calls the same applyAppointment with
        // `calendar` / `observed` - identical logic, honest about where it came from.
        const result = await applyAppointment(
          store,
          me.householdId,
          {
            kind,
            startsAt,
            ...(forMemberId ? { forMemberId } : {}),
            ...(detail ? { detail } : {}),
            reportedBy: me.id,
            source: 'voice',
            confidence: 'reported',
          },
          now(),
        );

        if (!result.ok) return guidance(result.spoken);
        return reply(result.spoken, {
          eventId: result.eventId,
          proposals: result.proposals,
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Daddy sounded tired on the phone."
 */
export function registerAddNote({ server, store, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool(
    'add_note',
    {
      title: 'Add a note to the care record',
      description:
        'Record an observation, concern, or piece of context that the rest of the family ' +
        'should see - "Mom sounded tired", "the doctor changed her dose". Use this when ' +
        'there is something to SAY but nothing specific that must be DONE. If someone needs ' +
        'to take an action, use record_appointment or let the note stand and let them claim it. ' +
        "Only about someone's care: never a shopping or to-do list, music, a smart-home command " +
        'or a message to someone outside the family - leave those to the assistant.\n\n' +
        'IMPORTANT: if the person says they (or someone) will be UNAVAILABLE - "I can\'t drive ' +
        'Thursday", "I won\'t be able to make Friday after all", "Renee is away next week" - ' +
        'this is still an add_note, with `unavailable` filled in. It is never "nothing to do": ' +
        'work that person was covering may quietly stop being covered, and that silence is ' +
        'exactly what this system exists to catch.\n\n' +
        'But if the speaker was ASKED to take something on and this is their answer - "I can\'t ' +
        'do Thursday, my car can\'t take the chair" right after being asked to drive - that is ' +
        'respond_to_request with accepted false and their reason as the note, not add_note. ' +
        'Call get_my_requests first when unsure.',
      inputSchema: {
        note: z.string().describe('The observation, in the words it was said.'),
        aboutMemberId: z
          .string()
          .optional()
          .describe('Who it concerns: their name as the family says it (e.g. "Mum"), or their id.'),
        unavailable: closed({
          memberName: z.string().describe('Who is unavailable, as the speaker named them.'),
          from: z.string().describe('ISO start of the window they cannot cover.'),
          to: z.string().describe('ISO end of the window.'),
        })
          .optional()
          .describe('Set when the note says someone cannot do something in a time window.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.add_note,
    },
    async ({ note, aboutMemberId, unavailable }) => {
      try {
        const me = actor();
        const s = state();
        // A note names who it is about, or it is about the one person cared for. With two
        // and nobody named, it stays a note about the family, rather than guessing.
        let about: string | undefined;
        if (aboutMemberId) {
          const who = subjectOf(s, aboutMemberId);
          if ('problem' in who) return guidance(who.problem);
          about = who.member.id;
        } else {
          const cared = careRecipients(s);
          about = cared.length === 1 ? cared[0]!.id : undefined;
        }
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
          // "I can't do Thursday" from someone who was just asked to do Thursday is very
          // likely their answer. It is still theirs to give: say what is waiting on them
          // and ask, rather than declining it on their behalf or letting it hang unanswered.
          const waiting = person.id === me.id ? unansweredBy(s, me.id) : [];
          if (waiting.length > 0) {
            const tz = s.household.timezone;
            const asks = waiting.map((o) => {
              const due = dueSpoken(o.dueAt, tz, now());
              return `${nameOf(o.request!.askedById) ?? 'Someone'} asked if you can ${asTask(o.what)}${due ? ` ${due}` : ''}`;
            });
            return reply(
              `Noted. ${joinSpoken(asks)}, and you haven't answered yet. Is that a no?`,
              {
                eventId: event.id,
                orphaned: [],
                unanswered: waiting.map((o) => ({ obligationId: o.id, what: o.what })),
              },
            );
          }
          return reply("Noted - I'll keep that in mind.", { eventId: event.id, orphaned: [] });
        }

        // Reopen the orphaned work rather than silently reassigning it: the app
        // notices, and asks. It never moves someone else's responsibility on its own.
        for (const o of orphaned) {
          await store.transition(
            o.obligationId,
            me.householdId,
            'OPEN',
            me.id,
            { ownerId: null },
            `Owner unavailable: ${note}`,
          );
        }
        return reply(orphaned[0]!.ask, {
          eventId: event.id,
          orphaned: orphaned.map((o) => ({ obligationId: o.obligationId, what: o.what })),
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/** Requests put to this member that they have not answered yet, soonest due first. */
function unansweredBy(state: CareState, memberId: string): CareState['obligations'] {
  return state.obligations
    .filter((o) => o.status === 'REQUESTED' && o.request?.askedOfId === memberId)
    .sort((a, b) => (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9'));
}

/** A dose of this medication already on the record for the slot this one falls in, if any. */
function sameDose(
  state: CareState,
  medicationId: string,
  at: string,
): { slot: string; record: CareEvent } | undefined {
  const med = state.medications.find((m) => m.id === medicationId);
  if (!med) return undefined;
  const mins = localParts(new Date(at), state.household.timezone).minutes;
  const slot = med.times
    .filter((t) => parseHHMM(t) !== null && Math.abs(parseHHMM(t)! - mins) <= 180)
    .sort((a, b) => Math.abs(parseHHMM(a)! - mins) - Math.abs(parseHHMM(b)! - mins))[0];
  if (!slot) return undefined;
  const record = doseRecord(state, medicationId, slot, new Date(at));
  return record ? { slot, record } : undefined;
}
