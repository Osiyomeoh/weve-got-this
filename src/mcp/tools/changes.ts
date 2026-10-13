/**
 * When care changes: a medication's course, an appointment's date, and the moment
 * something is wrong and everyone needs to know now.
 */

import { z } from 'zod';
import { require as requireCap } from '../../domain/auth.js';
import { appointmentsOf, emergencyAdvice, isActiveMedication } from '../../domain/care-changes.js';
import { localParts, spokenClock, spokenDue } from '../../domain/gaps.js';
import { toInstant } from '../../domain/time.js';
import { called, subjectOf } from '../../domain/who.js';
import { LANGUAGES, namesMedicine } from '../../domain/language.js';
import type { LanguageCode, Member, MedicationSchedule } from '../../domain/types.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken } from '../text.js';
import {
  ALSO_CALLED,
  describeError,
  guidance,
  namesFrom,
  reply,
  type ToolContext,
} from '../toolkit.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIVE = new Set(['PROPOSED', 'OPEN', 'REQUESTED', 'ASSIGNED']);

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 2);
}

/** "Wednesday 7 October", for a household-local date. */
function spokenDate(date: string, timezone: string): string {
  const at = toInstant(`${date}T12:00:00`, timezone) ?? `${date}T12:00:00Z`;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(at));
}

/**
 * "The doctor says Dad can stop the drops after next Wednesday."
 */
export function registerChangeMedication({ server, store, now, actor, state }: ToolContext): void {
  server.registerTool(
    'change_medication',
    {
      title: 'Change or stop a medication',
      description:
        'Change a medication that is already on the schedule, or stop it - when the doctor or ' +
        'the family changes the treatment. New dose times ("she takes it at 9 now"), a last ' +
        'day ("only until the 7th", "for two more weeks"), or stop it now ("the doctor stopped ' +
        'the eye drops"), or correct its name when it was entered wrong ("it\'s not eye ' +
        'drops, it\'s the pain tablets"). The record keeps what it was; it is just no longer ' +
        'expected. For a new medication use add_medication.',
      inputSchema: {
        medicationName: z.string().describe('The medication as they said it (e.g. "eye drops").'),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Who takes it: their name as the family says it (e.g. "Dad"), or their id. Needed when two people take a medication with that name.',
          ),
        times: z
          .array(z.string())
          .optional()
          .describe('New due times, 24-hour "HH:MM", e.g. ["09:00","21:00"].'),
        until: z
          .string()
          .optional()
          .describe(
            'The last day it is taken, "YYYY-MM-DD" in the household\'s time. Work it out from what they said against today\'s date.',
          ),
        stopNow: z.boolean().optional().describe('True when it has been stopped as of now.'),
        newName: z
          .string()
          .optional()
          .describe(
            'Its correct name, when the one on the record is wrong. The doses already recorded stay with it.',
          ),
        alsoCalled: ALSO_CALLED,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      outputSchema: OUT.change_medication,
    },
    async ({ medicationName, forMemberId, times, until, stopNow, newName, alsoCalled }) => {
      try {
        const me = actor();
        const s = state();
        const tz = s.household.timezone;
        let forId: string | undefined;
        if (forMemberId) {
          const who = subjectOf(s, forMemberId);
          if ('problem' in who) return guidance(who.problem);
          forId = who.member.id;
        }
        const named = s.medications.filter(
          (m) =>
            isActiveMedication(m, now(), tz) &&
            namesMedicine(medicationName, m) &&
            (!forId || m.forMemberId === forId),
        );
        if (named.length === 0) {
          const all = s.medications
            .filter((m) => isActiveMedication(m, now(), tz))
            .map((m) => m.name);
          return guidance(
            `There's no medication called "${medicationName}" on the schedule` +
              (all.length
                ? `. The ones I have are ${joinSpoken(all)}. Ask which one they meant.`
                : '. Ask what it is called, or add it with add_medication.'),
          );
        }
        if (named.length > 1) {
          const whose = named.map(
            (m) => `${m.name} for ${called(s.members.find((x) => x.id === m.forMemberId) ?? me)}`,
          );
          return guidance(
            `More than one medication matches: ${joinSpoken(whose)}. Ask which one they mean.`,
          );
        }
        const med = named[0]!;
        // The person takes their own medicine; anyone looking after them can record a change.
        if (!(me.role === 'care_recipient' && med.forMemberId === me.id))
          requireCap(me, 'log_others_event');
        if (me.role === 'helper')
          return guidance(
            'A change to a medication needs someone in the family to make it. Ask them to.',
          );

        const names = namesFrom(alsoCalled);
        const rename = newName?.trim();
        if (!times?.length && !until && !stopNow && !names && !rename)
          return guidance('Ask what has changed: new times, a last day, stopping it, or its name.');
        if (
          rename &&
          s.medications.some(
            (m) =>
              m.id !== med.id &&
              m.forMemberId === med.forMemberId &&
              isActiveMedication(m, now(), tz) &&
              m.name.toLowerCase() === rename.toLowerCase(),
          )
        ) {
          return guidance(
            `There's already a medication called "${rename}" on the schedule for them. Ask whether they meant to stop this one instead.`,
          );
        }
        if (times?.length && !times.every((t) => HHMM.test(t)))
          return guidance('I need the new times as 24-hour "HH:MM", like ["09:00","21:00"].');
        if (until && !DATE.test(until))
          return guidance(
            'I need the last day as a date, like "2026-10-07". Ask which day they meant.',
          );
        if (until && until < localParts(now(), tz).date)
          return guidance(
            'That last day has already passed. If it has stopped, say so and I will stop it now.',
          );

        const changes: Partial<
          Pick<MedicationSchedule, 'name' | 'times' | 'until' | 'stoppedAt' | 'names'>
        > = {};
        if (rename && rename !== med.name) changes.name = rename;
        if (times?.length) changes.times = times;
        if (until) changes.until = until;
        if (stopNow) changes.stoppedAt = now().toISOString();
        if (names) changes.names = names;

        const was = med.name;
        await store.updateMedication(med.id, me.householdId, changes);

        const owner = called(s.members.find((m) => m.id === med.forMemberId) ?? me);
        const whose = `${owner}'s ${changes.name ?? was}`;
        const said = stopNow
          ? `I've stopped ${whose}. I won't expect it any more, and the record keeps that it was taken until today.`
          : [
              times?.length
                ? `${whose} ${times.length === 1 ? 'is' : 'are'} now at ${joinSpoken(times.map(spokenClock))}.`
                : '',
              until
                ? `The last day is ${spokenDate(until, tz)}; after that I won't expect it.`
                : '',
              changes.name
                ? `${owner}'s "${was}" is now called ${changes.name}; the doses already recorded stay with it.`
                : '',
              names
                ? `${whose} can also be called ${joinSpoken(Object.entries(names).map(([code, n]) => `"${n}" in ${LANGUAGES[code as LanguageCode].name}`))}.`
                : '',
            ]
              .filter(Boolean)
              .join(' ');
        const event = await store.appendEvent({
          householdId: me.householdId,
          kind: 'medication_changed',
          reportedBy: me.id,
          occurredAt: now().toISOString(),
          source: 'voice',
          confidence: 'reported',
          detail: said,
          data: {
            medicationId: med.id,
            forMemberId: med.forMemberId,
            ...changes,
            ...(changes.name ? { renamedFrom: was } : {}),
          },
        });
        return reply(`Done. ${said}`, { medicationId: med.id, eventId: event.id });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "The eye check-up has moved to Friday at two." / "The dentist is cancelled."
 */
export function registerChangeAppointment({
  server,
  store,
  now,
  actor,
  state,
  notifier,
  nameOf,
}: ToolContext): void {
  server.registerTool(
    'change_appointment',
    {
      title: 'Move or cancel an appointment',
      description:
        'Move or cancel an appointment that is already on the record - "the check-up has moved ' +
        'to Friday at 2", "the dentist is cancelled", "they pushed it back an hour". What was ' +
        'arranged for it, like a ride, moves or is called off with it, and whoever had taken ' +
        'that on is told. For a new appointment use record_appointment.',
      inputSchema: {
        appointment: z
          .string()
          .describe('Which appointment, as they said it (e.g. "the eye check-up", "dentist").'),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Whose appointment: their name as the family says it, or their id. Needed only when it is unclear.',
          ),
        newStartsAt: z
          .string()
          .optional()
          .describe(
            'When it is now, ISO 8601 in the household\'s local time (e.g. "2026-10-02T14:00:00"). Resolve "Friday" against today\'s date.',
          ),
        cancel: z.boolean().optional().describe('True when it is cancelled.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.change_appointment,
    },
    async ({ appointment, forMemberId, newStartsAt, cancel }) => {
      try {
        const me = actor();
        requireCap(me, 'create_obligation');
        const s = state();
        const tz = s.household.timezone;
        let forId: string | undefined;
        if (forMemberId) {
          const who = subjectOf(s, forMemberId);
          if ('problem' in who) return guidance(who.problem);
          forId = who.member.id;
        }
        const soon = appointmentsOf(s).filter(
          (a) =>
            !a.cancelled &&
            Date.parse(a.at) >= now().getTime() - 12 * 3_600_000 &&
            (!forId || a.forMemberId === forId),
        );
        const key = words(appointment).filter(
          (w) => !['the', 'appointment', 'his', 'her', 'their'].includes(w),
        );
        const matches = soon.filter((a) => {
          const kind = new Set(words(`${a.kind} ${a.detail ?? ''}`));
          return key.length > 0 && key.some((w) => kind.has(w));
        });
        const whoseName = (id: string | null) => called(s.members.find((m) => m.id === id) ?? me);
        const describe = (a: { kind: string; at: string; forMemberId: string | null }) =>
          `${whoseName(a.forMemberId)}'s ${a.kind}${spokenDue(a.at, tz, now())}`;
        if (matches.length === 0) {
          return guidance(
            soon.length
              ? `I couldn't find "${appointment}". Coming up I have ${joinSpoken(soon.slice(0, 4).map(describe))}. Ask which one they meant.`
              : 'There are no upcoming appointments on the record. If this is a new one, use record_appointment.',
          );
        }
        if (matches.length > 1)
          return guidance(
            `More than one appointment fits: ${joinSpoken(matches.map(describe))}. Ask which one.`,
          );
        const appt = matches[0]!;

        if (!cancel && !newStartsAt)
          return guidance('Ask whether it has moved - and to when - or been cancelled.');
        let startsAt: string | undefined;
        if (!cancel) {
          const at = toInstant(newStartsAt!, tz);
          if (!at)
            return guidance(
              `I couldn't make sense of "${newStartsAt}" as a date and time. Ask which day and time they meant.`,
            );
          if (Date.parse(at) < now().getTime())
            return guidance('That time has already passed. Ask when it is now.');
          startsAt = at;
        }

        const event = await store.appendEvent({
          householdId: me.householdId,
          kind: 'appointment_changed',
          reportedBy: me.id,
          occurredAt: now().toISOString(),
          source: 'voice',
          confidence: 'reported',
          detail: cancel ? `${appt.kind} cancelled` : `${appt.kind} moved to ${startsAt}`,
          data: {
            appointmentEventId: appt.eventId,
            ...(cancel ? { cancelled: true } : { startsAt }),
          },
        });

        // The work that existed for it follows it: a ride moves with the appointment, or is called off.
        const shift = startsAt ? Date.parse(startsAt) - Date.parse(appt.at) : 0;
        const work = s.obligations.filter(
          (o) => o.sourceEventId === appt.eventId && LIVE.has(o.status),
        );
        const toldNames: string[] = [];
        for (const o of work) {
          if (cancel) {
            await store.transition(
              o.id,
              me.householdId,
              'DISMISSED',
              me.id,
              { resolutionNote: 'The appointment was cancelled.' },
              'appointment cancelled',
            );
          } else if (o.dueAt) {
            await store.redateObligation(
              o.id,
              me.householdId,
              new Date(Date.parse(o.dueAt) + shift).toISOString(),
            );
          }
          const holder = o.ownerId ?? o.request?.askedOfId;
          if (holder && holder !== me.id) {
            const holderName = nameOf(holder) ?? 'them';
            const message = cancel
              ? `${called(me)} says ${whoseName(appt.forMemberId)}'s ${appt.kind} is cancelled, so "${o.what}" isn't needed any more.`
              : `${called(me)} says ${whoseName(appt.forMemberId)}'s ${appt.kind} is now${spokenDue(startsAt, tz, now())}, so "${o.what}" moves with it.`;
            const d = await notifier.deliver({
              to: holder,
              toName: holderName,
              from: called(me),
              message,
            });
            if (d.delivered) toldNames.push(holderName);
          }
        }

        const moved = work.length
          ? cancel
            ? ' What was arranged for it is called off.'
            : ' What was arranged for it moves too.'
          : '';
        const told = toldNames.length ? ` I've let ${joinSpoken(toldNames)} know.` : '';
        const said = cancel
          ? `Done. ${whoseName(appt.forMemberId)}'s ${appt.kind}${spokenDue(appt.at, tz, now())} is cancelled.${moved}${told}`
          : `Done. ${whoseName(appt.forMemberId)}'s ${appt.kind} is now${spokenDue(startsAt, tz, now())}.${moved}${told}`;
        return reply(said, {
          eventId: event.id,
          appointmentEventId: appt.eventId,
          ...(startsAt ? { startsAt } : {}),
          cancelled: !!cancel,
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Daddy has fallen in the bathroom."
 */
export function registerRaiseUrgent({
  server,
  store,
  now,
  actor,
  state,
  notifier,
}: ToolContext): void {
  server.registerTool(
    'raise_urgent',
    {
      title: 'Tell the whole family now',
      description:
        'Tell everyone in the family at once that something serious is happening - a fall, bad ' +
        'pain, trouble breathing, chest pain, sudden confusion, bleeding that will not stop, ' +
        'they cannot be reached, or they have been taken to hospital. Use this the moment ' +
        'someone describes an emergency or asks for everyone to be alerted now, before ' +
        'anything else. It does not call emergency services: it tells the person to.',
      inputSchema: {
        what: z
          .string()
          .describe('What is happening, in their words (e.g. "Dad fell in the bathroom").'),
        forMemberId: z
          .string()
          .optional()
          .describe('Who it is about: their name as the family says it, or their id.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.raise_urgent,
    },
    async ({ what, forMemberId }) => {
      try {
        const me = actor();
        const s = state();
        const who = forMemberId ? subjectOf(s, forMemberId) : undefined;
        const about: Member | undefined = who && 'member' in who ? who.member : undefined;
        const call = emergencyAdvice(s.household.timezone);
        const message = `URGENT from ${called(me)}: ${what.trim()}. Please call or go to them now. If it is an emergency, ${call}.`;

        // Everyone except whoever raised it and whoever it is about.
        const recipients = s.members.filter((m) => m.id !== me.id && m.id !== about?.id);
        const delivered: string[] = [];
        if (notifier.broadcast) {
          const r = await notifier.broadcast({
            householdId: me.householdId,
            recipients: recipients.map((m) => ({ id: m.id, name: called(m) })),
            message,
          });
          delivered.push(...r.reached);
        } else {
          for (const m of recipients) {
            const d = await notifier.deliver({
              to: m.id,
              toName: called(m),
              from: called(me),
              message,
            });
            if (d.delivered) delivered.push(called(m));
          }
        }
        const event = await store.appendEvent({
          householdId: me.householdId,
          kind: 'urgent_raised',
          reportedBy: me.id,
          occurredAt: now().toISOString(),
          source: 'voice',
          confidence: 'reported',
          detail: what.trim(),
          data: { ...(about ? { aboutMemberId: about.id } : {}), reached: delivered },
        });
        const cap = call.charAt(0).toUpperCase() + call.slice(1);
        const said = delivered.length
          ? `${cap} if this is an emergency. I've told ${joinSpoken(delivered)}.`
          : `${cap} if this is an emergency. I couldn't reach anyone's phone from here, so please call the family yourself; it's on the care record.`;
        return reply(said, { eventId: event.id, reached: delivered });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}
