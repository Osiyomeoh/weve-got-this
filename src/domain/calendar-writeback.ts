import type { Member, Obligation } from './types.js';
import { CARECIRCLE_SOURCE, type GoogleCalendarEvent } from './calendar.js';

/**
 * Write-back: turning CareCircle's committed state into shared-calendar events.
 *
 * This is the other half of the calendar door. When the family settles who owns a
 * dated piece of work, that fact should appear on the shared calendar every one of
 * them already carries on their phone - so "Musa has the Thursday ride" is not a
 * thing buried in one app, it is on everyone's calendar without anyone re-typing it.
 *
 * Two honesty rules carry over from everywhere else in the system:
 *  - We write only what is REAL and DATED. A PROPOSED obligation is still a guess, so
 *    it is never written; a DISMISSED or RESOLVED one is not live work. Only OPEN,
 *    REQUESTED and ASSIGNED obligations with a due time reach the calendar.
 *  - We write the STATE honestly, never a rosier version. An unowned ride says it
 *    needs a driver; an asked-but-unanswered one says it was asked, not agreed. The
 *    calendar entry can never claim more certainty than the record has.
 *
 * Every event carries `carecircleObligationId` (so a status change patches the same
 * event instead of duplicating it) and `carecircleSource` (so the inbound door skips
 * it - see the loop guard in calendar.ts).
 */

/** Obligation statuses that belong on the shared calendar. */
const WRITABLE = new Set<Obligation['status']>(['OPEN', 'REQUESTED', 'ASSIGNED']);

function nameOf(members: Member[], id: string | null | undefined): string | null {
  if (!id) return null;
  const m = members.find((x) => x.id === id);
  return m ? (m.spokenAs ?? m.name) : null;
}

/** The one-hour default an appointment/obligation occupies when only a start is known. */
const DEFAULT_DURATION_MS = 3_600_000;

/**
 * The calendar event body for an obligation, phrased to match its real status.
 * Pure: no clock, no network. Returns null when the obligation should not be written.
 */
export function obligationToCalendarEvent(
  obligation: Obligation,
  members: Member[],
): GoogleCalendarEvent | null {
  if (!WRITABLE.has(obligation.status)) return null;
  if (!obligation.dueAt) return null;

  let suffix: string;
  if (obligation.status === 'ASSIGNED') {
    const owner = nameOf(members, obligation.ownerId);
    suffix = owner ? ` — ${owner}` : ' — owned';
  } else if (obligation.status === 'REQUESTED') {
    const asked = nameOf(members, obligation.request?.askedOfId);
    suffix = asked ? ` — asked ${asked}` : ' — asked, awaiting reply';
  } else {
    suffix = ' — needs an owner';
  }

  const start = obligation.dueAt;
  const end = new Date(new Date(start).getTime() + DEFAULT_DURATION_MS).toISOString();

  return {
    summary: `${obligation.what}${suffix}`,
    description: 'Tracked by CareCircle. This entry reflects the current owner and status.',
    start: { dateTime: start, timeZone: 'UTC' },
    end: { dateTime: end, timeZone: 'UTC' },
    extendedProperties: {
      private: {
        carecircleSource: CARECIRCLE_SOURCE,
        carecircleObligationId: obligation.id,
        carecircleStatus: obligation.status,
      },
    },
  };
}

export interface WritebackPlan {
  creates: Array<{ obligationId: string; body: GoogleCalendarEvent }>;
  updates: Array<{ eventId: string; obligationId: string; body: GoogleCalendarEvent }>;
}

/**
 * Decide what to create and what to patch, given the current obligations and the
 * CareCircle-authored events already on the calendar (keyed by obligation id).
 *
 * An obligation with no existing event is created; one that already has an event is
 * patched only when its writable form changed (owner, status, or time), so an
 * unchanged re-run touches nothing.
 */
export function planCalendarWriteback(
  obligations: Obligation[],
  members: Member[],
  existingByObligationId: Map<string, { eventId: string; summary?: string; start?: string }>,
): WritebackPlan {
  const plan: WritebackPlan = { creates: [], updates: [] };

  for (const o of obligations) {
    const body = obligationToCalendarEvent(o, members);
    if (!body) continue;

    const existing = existingByObligationId.get(o.id);
    if (!existing) {
      plan.creates.push({ obligationId: o.id, body });
      continue;
    }
    const changed = existing.summary !== body.summary
      || existing.start !== body.start?.dateTime;
    if (changed) {
      plan.updates.push({ eventId: existing.eventId, obligationId: o.id, body });
    }
  }

  return plan;
}
