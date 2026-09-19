import type { AppointmentInput } from './appointments.js';

/**
 * Adapter: an email that carries a calendar invite -> an appointment intent.
 *
 * The Gmail door is deliberately narrow, because honesty demands it. Guessing a date
 * out of free-text email prose ("see you next Thursday-ish") is exactly the kind of
 * confident fabrication this whole system refuses. So this door acts only on what is
 * unambiguous: a real iCalendar (.ics) invite attached to the email, whose DTSTART is
 * a machine-readable instant. A doctor's or clinic's confirmation email typically
 * carries one. An email without a parseable invite is not turned into an appointment
 * - it is skipped, not guessed at.
 *
 * As everywhere else, what results is EVIDENCE: an `email`-sourced, `observed`
 * appointment whose implied work is PROPOSED for a human to confirm. The email is
 * proof a message arrived, not proof the appointment is a settled fact.
 */

/** The minimal shape of a VEVENT this door relies on. */
export interface IcsEvent {
  uid?: string;
  summary?: string;
  /** ISO 8601 instant, or null when the invite is all-day or unparseable. */
  startsAt: string | null;
  location?: string;
}

export const EMAIL_REPORTER = 'connector:gmail';

/**
 * Unfold RFC 5545 line folding: a CRLF followed by a space or tab continues the
 * previous line. Done before any property is read, or a folded DTSTART is misread.
 */
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

/**
 * Parse an iCalendar DTSTART value into an ISO instant, or null when it is a form we
 * will not act on. Handled: UTC (`...Z`), zoned (`TZID=...:local`, read via the zone),
 * and floating local (read in the household zone). Rejected: date-only (all-day), which
 * is a banner, not a timed appointment.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string>,
  timezone: string,
): string | null {
  const raw = value.trim();
  // Date-only (VALUE=DATE or an 8-digit date): an all-day marker, not an appointment.
  if (params['VALUE'] === 'DATE' || /^\d{8}$/.test(raw)) return null;

  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') {
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  // Floating or zoned local time: resolve against the TZID if given, else the
  // household zone. `zoneOffsetAt` finds the offset at that wall time.
  const zone = params['TZID'] || timezone;
  const wall = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const provisional = new Date(`${wall}Z`);
  if (Number.isNaN(provisional.getTime())) return null;
  const offset = zoneOffsetAt(provisional, zone);
  if (offset === null) return null;
  return new Date(provisional.getTime() - offset).toISOString();
}

/** Offset of `zone` from UTC at instant `at`, in ms, or null if the zone is invalid. */
function zoneOffsetAt(at: Date, zone: string): number | null {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
    const asUTC = Date.UTC(
      Number(p['year']), Number(p['month']) - 1, Number(p['day']),
      Number(p['hour']) % 24, Number(p['minute']), Number(p['second']),
    );
    return asUTC - at.getTime();
  } catch {
    return null; // an unknown TZID
  }
}

/**
 * Extract the first VEVENT from an iCalendar document. Defensive: takes only the
 * fields we act on, ignores the rest, and returns null when there is no usable event.
 */
export function parseIcs(ics: string, timezone: string): IcsEvent | null {
  const lines = unfold(ics);
  let inEvent = false;
  const ev: IcsEvent = { startsAt: null };
  let sawStart = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { inEvent = true; continue; }
    if (trimmed === 'END:VEVENT') break;
    if (!inEvent) continue;

    const colon = trimmed.indexOf(':');
    if (colon < 0) continue;
    const namePart = trimmed.slice(0, colon);
    const value = trimmed.slice(colon + 1);
    const [name, ...paramPairs] = namePart.split(';');
    const params: Record<string, string> = {};
    for (const p of paramPairs) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }

    switch (name!.toUpperCase()) {
      case 'UID': ev.uid = value; break;
      case 'SUMMARY': ev.summary = value.replace(/\\,/g, ',').replace(/\\;/g, ';').trim(); break;
      case 'LOCATION': ev.location = value.replace(/\\,/g, ',').trim(); break;
      case 'DTSTART': ev.startsAt = parseIcsDate(value, params, timezone); sawStart = true; break;
    }
  }

  if (!sawStart) return null;
  return ev;
}

/** An email reduced to what this door reads. */
export interface EmailMessage {
  /** Gmail message id, used for idempotency when the invite has no UID. */
  messageId: string;
  from?: string;
  subject?: string;
  /** The raw text of any text/calendar (.ics) part, already base64url-decoded. */
  icsText?: string;
}

export type EmailMapping =
  | { apply: true; input: Omit<AppointmentInput, 'reportedBy' | 'forMemberId'> }
  | { apply: false; reason: string };

/**
 * Map an email to an appointment intent via its calendar invite, or explain why it
 * was skipped. Pure of the network. Requires an .ics part with a timed DTSTART; the
 * summary names the appointment, falling back to the email subject.
 */
export function emailToAppointment(email: EmailMessage, timezone: string): EmailMapping {
  if (!email.icsText) {
    return { apply: false, reason: 'no calendar invite attached (not guessing a date from prose)' };
  }
  const ev = parseIcs(email.icsText, timezone);
  if (!ev) return { apply: false, reason: 'invite had no readable event' };
  if (!ev.startsAt) return { apply: false, reason: 'invite has no timed start (all-day or unparseable)' };

  const kind = (ev.summary ?? email.subject ?? '').trim();
  if (!kind) return { apply: false, reason: 'nothing to name the appointment' };

  const detail = ev.location?.trim() || undefined;
  // Prefer the invite UID for idempotency; fall back to the Gmail message id.
  const externalId = `email:${ev.uid ?? email.messageId}`;

  return {
    apply: true,
    input: {
      kind,
      startsAt: ev.startsAt,
      ...(detail ? { detail } : {}),
      source: 'email',
      confidence: 'observed',
      externalId,
    },
  };
}
