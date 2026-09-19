import type { AppointmentInput } from './appointments.js';

/**
 * Adapter: a real Google Calendar event -> a vendor-neutral appointment intent.
 *
 * Modelled on the Google Calendar API v3 `events` resource. The same discipline as
 * the Ring adapter (domain/ring.ts) applies: the reader is defensive, takes only the
 * fields the documented contract guarantees, and ignores the rest.
 *
 * Two honesty rules shape what this does and does not turn into an appointment:
 *
 *  - A calendar event is EVIDENCE the family scheduled something, not a fact the
 *    system asserts. It enters as `observed`, and the work it implies (a ride, a
 *    companion) enters PROPOSED - a human confirms, exactly as with a spoken
 *    appointment. Nothing about it is treated as done or certain.
 *  - We only bring in events that read as a real dated commitment. A `cancelled`
 *    event, an all-day banner, or one the recipient has `declined` is not an
 *    appointment CareCircle should act on, so it is dropped rather than guessed at.
 *
 * The event id + last-updated stamp form an idempotency key, because a calendar
 * sync redelivers the same event on every poll and an edited event comes back with
 * a new `updated` time - the same reason the Ring webhook keys on `request_id`.
 */

/** The subset of a Google Calendar v3 event this adapter relies on. */
export interface GoogleCalendarEvent {
  id?: string;
  status?: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary?: string;
  description?: string;
  location?: string;
  updated?: string; // RFC3339, changes when the event is edited
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ self?: boolean; responseStatus?: string; email?: string }>;
  /** App-private metadata. CareCircle stamps its own events here (see write-back). */
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * The marker CareCircle writes into `extendedProperties.private.carecircleSource`
 * on every event it creates. Its purpose is the loop guard below: an event this
 * system wrote to the calendar must never be read back in as a new appointment, or
 * write-back and inbound sync would feed each other forever.
 */
export const CARECIRCLE_SOURCE = 'carecircle';

/** A calendar event mapped to the shared appointment path, or the reason it was skipped. */
export type CalendarMapping =
  | { apply: true; input: Omit<AppointmentInput, 'reportedBy' | 'forMemberId'>; }
  | { apply: false; reason: string };

/** The connector identity recorded as the reporter of a calendar-sourced appointment. */
export const CALENDAR_REPORTER = 'connector:google-calendar';

/**
 * Idempotency key for a calendar event: its id plus the last time it changed. A
 * re-poll of an unchanged event yields the same key (skip it); an edit yields a new
 * one (re-apply). Returns null when the event has no id to key on.
 */
export function calendarIdempotencyKey(event: GoogleCalendarEvent): string | null {
  if (!event.id) return null;
  return `${event.id}@${event.updated ?? ''}`;
}

/**
 * Map a Google Calendar event to an appointment intent, or explain why it is not one
 * CareCircle should act on. Pure: no clock, no network, no store.
 */
export function calendarEventToAppointment(event: GoogleCalendarEvent): CalendarMapping {
  if (event.status === 'cancelled') {
    return { apply: false, reason: 'event is cancelled' };
  }

  // The loop guard: an event CareCircle itself wrote to the calendar (write-back)
  // must not be re-ingested as a fresh appointment, or the two doors would feed
  // each other. It is already in the record - that is why it is on the calendar.
  if (event.extendedProperties?.private?.['carecircleSource'] === CARECIRCLE_SOURCE) {
    return { apply: false, reason: 'authored by CareCircle (write-back), not re-ingested' };
  }

  // A timed start is what makes this an appointment. An all-day event (only `date`,
  // no `dateTime`) is a banner, not a dated commitment we would propose a ride for.
  const startsAt = event.start?.dateTime;
  if (!startsAt) {
    return { apply: false, reason: 'no timed start (all-day or malformed)' };
  }

  // If the household's own calendar owner declined, they are not attending - do not
  // manufacture work for an appointment they opted out of.
  const selfDeclined = (event.attendees ?? []).some(
    (a) => a.self && a.responseStatus === 'declined',
  );
  if (selfDeclined) {
    return { apply: false, reason: 'declined by the calendar owner' };
  }

  const kind = (event.summary ?? '').trim();
  if (!kind) {
    return { apply: false, reason: 'no title to name the appointment' };
  }

  // Keep the event's own words for the record, without inventing any.
  const detailParts = [event.location, event.description]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  const detail = detailParts.length > 0 ? detailParts.join(' - ') : undefined;

  return {
    apply: true,
    input: {
      kind,
      startsAt,
      ...(detail ? { detail } : {}),
      source: 'calendar',
      // A calendar sync observed a scheduled event; it did not confirm the world.
      confidence: 'observed',
      ...(event.id ? { externalId: event.id } : {}),
    },
  };
}
