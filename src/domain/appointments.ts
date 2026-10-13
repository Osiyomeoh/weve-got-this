import { subjectOf } from './who.js';
import type { CareStore } from '../store/store.js';
import type { EventConfidence, EventSource } from './types.js';
import { proposeFromAppointment } from './inference.js';
import { toInstant, implausible } from './time.js';

/**
 * Recording an appointment - the one path, whether a person spoke it or a calendar
 * sync produced it.
 *
 * This exists for the same reason `applySignal` does (see ingest.ts): a Google
 * Calendar event and a family member saying "cardiology Thursday" must reach the
 * care record through *identical* logic, or the calendar becomes a second, weaker
 * way to create an appointment - one that might skip a guard the spoken path
 * enforces. The whole argument of the system is that evidence is treated by what it
 * is, not by which door it arrived through. So `record_appointment` (voice) and the
 * Google Calendar connector both call this.
 *
 * What it always does, regardless of source:
 *  - validates the time against the household clock, and refuses an implausible one
 *    (a date a model invented, a sync clock skew) rather than recording it;
 *  - records an `appointment_scheduled` event, attributed to its real source and
 *    with an honest confidence - a calendar sync is `observed`, never `confirmed`;
 *  - PROPOSES the work the appointment probably implies (a ride, a companion) as
 *    INFERRED obligations a human must confirm. It never creates OPEN work, and it
 *    never marks anything done.
 */

export interface AppointmentInput {
  /** What the appointment is, as said or as the calendar titled it. */
  kind: string;
  /** ISO 8601 start, in the household's local time. Validated here, not trusted. */
  startsAt: string;
  /** Who it is for. Defaults to the care recipient. */
  forMemberId?: string;
  /** Anything else about it, kept verbatim. */
  detail?: string;
  /** The member or connector that reported it (attribution is never anonymous). */
  reportedBy: string;
  /** The channel it arrived through. */
  source: EventSource;
  /** How sure we are of the observation itself. */
  confidence: EventConfidence;
  /**
   * A stable id from the source system (e.g. a Google Calendar event id), kept on
   * the event for traceability and de-duplication. Not required for the voice path.
   */
  externalId?: string;
}

export type AppointmentResult =
  | {
      ok: true;
      eventId: string;
      recipientId: string;
      subject: string;
      at: string;
      proposals: { id: string; what: string; ask: string }[];
      /** One line, ready to speak - identical wording across every source. */
      spoken: string;
    }
  | {
      ok: false;
      /** Why it was refused, phrased for a person. Nothing was written. */
      spoken: string;
    };

/**
 * Apply an appointment to a household's care record. Pure of transport concerns:
 * callers own authorization (the tool checks the actor's capability; a connector
 * runs as a trusted system identity) and how the result is spoken back.
 */
export async function applyAppointment(
  store: CareStore,
  householdId: string,
  input: AppointmentInput,
  now: Date,
): Promise<AppointmentResult> {
  const state = store.getCareState(householdId);

  // With more than one person being cared for, an appointment nobody placed is asked
  // about, never filed under whoever happens to be first.
  const who = subjectOf(state, input.forMemberId, 'this appointment');
  if ('problem' in who) return { ok: false, spoken: who.problem };
  const recipient = who.member;
  const subject = recipient.spokenAs ?? recipient.name;

  // A timestamp we were handed is a claim, not a fact - a model may have invented
  // "Thursday at ten", a sync clock may be skewed. Validate before anyone relies on it.
  const at = toInstant(input.startsAt, state.household.timezone);
  if (!at) {
    return {
      ok: false,
      spoken:
        `I couldn't make sense of "${input.startsAt}" as a date and time. ` +
        'Ask them which day and time they meant.',
    };
  }
  const doubtful = implausible(at, now);
  if (doubtful) return { ok: false, spoken: doubtful.spoken };

  const event = await store.appendEvent({
    householdId,
    kind: 'appointment_scheduled',
    reportedBy: input.reportedBy,
    occurredAt: at,
    source: input.source,
    confidence: input.confidence,
    ...(input.detail ? { detail: input.detail } : {}),
    data: {
      appointmentKind: input.kind,
      forMemberId: recipient.id,
      ...(input.externalId ? { externalId: input.externalId } : {}),
    },
  });

  const seeds = proposeFromAppointment(input.kind, subject, at);
  const proposed = await Promise.all(
    seeds.map((seed) =>
      store.createObligation({
        householdId,
        what: seed.what,
        status: 'PROPOSED',
        consequence: seed.consequence,
        provenance: seed.provenance,
        ownerId: null,
        ...(seed.dueAt ? { dueAt: seed.dueAt } : {}),
        sourceEventId: event.id,
        // The work is for this recipient; their standing needs (e.g. accessible transport)
        // then flow into how the gap ranks once a human confirms the proposal.
        aboutEntityId: recipient.id,
      }),
    ),
  );

  const spoken =
    proposed.length === 0
      ? `Noted - ${input.kind} for ${subject}.`
      : `Noted - ${input.kind} for ${subject}. ${seeds[0]!.ask}`;

  return {
    ok: true,
    eventId: event.id,
    recipientId: recipient.id,
    subject,
    at,
    proposals: proposed.map((o, i) => ({ id: o.id, what: o.what, ask: seeds[i]!.ask })),
    spoken,
  };
}
