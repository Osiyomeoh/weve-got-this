import type { CareStore } from '../store/store.js';
import { applyAppointment } from '../domain/appointments.js';
import {
  calendarEventToAppointment,
  calendarIdempotencyKey,
  CALENDAR_REPORTER,
  CARECIRCLE_SOURCE,
  type GoogleCalendarEvent,
} from '../domain/calendar.js';
import { planCalendarWriteback } from '../domain/calendar-writeback.js';

/**
 * The Google Calendar connector: a real family calendar as a source of appointments.
 *
 * This is a real inbound integration, not a simulation. Given OAuth credentials for
 * a Google account, it reads the account's upcoming events and folds each one into
 * the care record through `applyAppointment` - the exact path a spoken appointment
 * takes. A calendar event therefore becomes an `observed` appointment with INFERRED,
 * human-confirmable proposals, never a fact the system asserts on its own.
 *
 * Structure keeps the network at the edges so the logic stays testable:
 *  - `refreshAccessToken` / `fetchUpcomingEvents` are the only functions that talk to
 *    Google;
 *  - `syncCalendarEvents` is pure over an array of already-fetched events (dedupe,
 *    map, apply) and is what the tests exercise;
 *  - `runGoogleCalendarSync` wires the two together for real use.
 */

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GoogleCalendarConfig extends GoogleCredentials {
  /** The calendar to read. 'primary' is the account's main calendar. */
  calendarId: string;
  /** The calendar to write owned/dated work back to. Defaults to `calendarId`. */
  writeCalendarId?: string;
  /** How far ahead to look, in days. Defaults to 30. */
  horizonDays?: number;
}

export interface SyncResult {
  fetched: number;
  applied: Array<{ eventId: string; kind: string; proposals: number; spoken: string }>;
  skipped: Array<{ key: string; reason: string }>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars';

/**
 * Read the connector's configuration from the environment, or null when it is not
 * configured - so the server and other tooling run untouched until a real Google
 * account is wired in. The refresh token is minted once via scripts/google-auth.ts.
 */
export function googleCalendarConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleCalendarConfig | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim();
  const refreshToken = env['GOOGLE_REFRESH_TOKEN']?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const horizon = Number(env['GOOGLE_CALENDAR_HORIZON_DAYS']);
  const writeCalendarId = env['GOOGLE_WRITE_CALENDAR_ID']?.trim();
  return {
    clientId,
    clientSecret,
    refreshToken,
    calendarId: env['GOOGLE_CALENDAR_ID']?.trim() || 'primary',
    ...(writeCalendarId ? { writeCalendarId } : {}),
    ...(Number.isFinite(horizon) && horizon > 0 ? { horizonDays: horizon } : {}),
  };
}

/**
 * Exchange a long-lived refresh token for a short-lived access token. This is the
 * standard OAuth 2.0 refresh grant - the refresh token is obtained once, out of
 * band (see scripts/google-auth.ts), and never leaves the server.
 */
export async function refreshAccessToken(creds: GoogleCredentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Google token refresh returned no access_token.');
  return json.access_token;
}

/**
 * Read upcoming events from a calendar. `singleEvents=true` expands recurring events
 * into individual instances, so each occurrence is its own appointment.
 */
export async function fetchUpcomingEvents(
  accessToken: string,
  calendarId: string,
  now: Date,
  horizonDays = 30,
): Promise<GoogleCalendarEvent[]> {
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + horizonDays * 86_400_000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const url = `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { items?: GoogleCalendarEvent[] };
  return json.items ?? [];
}

/**
 * Apply a batch of already-fetched calendar events to a household. Pure of the
 * network. De-duplicates against appointments already recorded from this calendar:
 * an event whose idempotency key (id + last-updated) is already on the record is
 * skipped, so re-polling is safe and only genuine edits re-apply.
 */
export async function syncCalendarEvents(
  store: CareStore,
  householdId: string,
  events: GoogleCalendarEvent[],
  now: Date,
  forMemberId?: string,
): Promise<SyncResult> {
  // Keys already applied, read from the append-only record itself - no separate
  // bookkeeping to drift out of sync.
  const seen = new Set<string>();
  for (const e of store.getCareState(householdId).events) {
    if (e.kind === 'appointment_scheduled') {
      const ext = e.data['externalId'];
      if (typeof ext === 'string') seen.add(ext);
    }
  }

  const result: SyncResult = { fetched: events.length, applied: [], skipped: [] };

  for (const event of events) {
    const key = calendarIdempotencyKey(event);
    if (!key) {
      result.skipped.push({ key: '(no id)', reason: 'event has no id to key on' });
      continue;
    }
    if (seen.has(key)) {
      result.skipped.push({ key, reason: 'already applied (unchanged)' });
      continue;
    }

    const mapping = calendarEventToAppointment(event);
    if (!mapping.apply) {
      result.skipped.push({ key, reason: mapping.reason });
      continue;
    }

    const applied = await applyAppointment(store, householdId, {
      ...mapping.input,
      // Store the idempotency key (id + updated) as the externalId so an unchanged
      // re-poll is recognised and an edited event re-applies.
      externalId: key,
      ...(forMemberId ? { forMemberId } : {}),
      reportedBy: CALENDAR_REPORTER,
    }, now);

    if (!applied.ok) {
      result.skipped.push({ key, reason: applied.spoken });
      continue;
    }
    seen.add(key);
    result.applied.push({
      eventId: applied.eventId,
      kind: mapping.input.kind,
      proposals: applied.proposals.length,
      spoken: applied.spoken,
    });
  }

  return result;
}

/** End-to-end real sync: refresh a token, read the calendar, apply the events. */
export async function runGoogleCalendarSync(
  store: CareStore,
  householdId: string,
  config: GoogleCalendarConfig,
  now: Date,
  forMemberId?: string,
): Promise<SyncResult> {
  const accessToken = await refreshAccessToken(config);
  const events = await fetchUpcomingEvents(
    accessToken, config.calendarId, now, config.horizonDays ?? 30,
  );
  return syncCalendarEvents(store, householdId, events, now, forMemberId);
}

// --- Write-back: CareCircle's committed state -> the shared calendar ----------

/**
 * List the events CareCircle previously wrote to a calendar, keyed by the
 * obligation each represents. Uses Google's private-extended-property filter so we
 * touch only our own events, never the family's other entries.
 */
export async function fetchCareCircleEvents(
  accessToken: string,
  calendarId: string,
): Promise<Map<string, { eventId: string; summary?: string; start?: string }>> {
  const params = new URLSearchParams({
    privateExtendedProperty: `carecircleSource=${CARECIRCLE_SOURCE}`,
    maxResults: '250',
    showDeleted: 'false',
  });
  const url = `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events?${params}`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar list (write-back) failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { items?: Array<GoogleCalendarEvent & { id?: string }> };
  const map = new Map<string, { eventId: string; summary?: string; start?: string }>();
  for (const item of json.items ?? []) {
    const oblId = item.extendedProperties?.private?.['carecircleObligationId'];
    if (item.id && oblId) {
      map.set(oblId, {
        eventId: item.id,
        ...(item.summary ? { summary: item.summary } : {}),
        ...(item.start?.dateTime ? { start: item.start.dateTime } : {}),
      });
    }
  }
  return map;
}

async function insertEvent(accessToken: string, calendarId: string, body: GoogleCalendarEvent): Promise<void> {
  const url = `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar insert failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleCalendarEvent): Promise<void> {
  const url = `${CALENDAR_API}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google Calendar patch failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

export interface WritebackResult {
  created: number;
  updated: number;
  unchanged: number;
}

/**
 * Reconcile a household's real, dated obligations onto the shared calendar: create
 * an event for each new one, patch the one whose owner or time changed, leave the
 * rest untouched. Idempotent, and safe to run alongside the inbound sync because
 * every event it writes is tagged so the inbound door skips it.
 */
export async function runCalendarWriteback(
  store: CareStore,
  householdId: string,
  config: GoogleCalendarConfig,
): Promise<WritebackResult> {
  const accessToken = await refreshAccessToken(config);
  const writeCalendarId = config.writeCalendarId ?? config.calendarId;

  const state = store.getCareState(householdId);
  const existing = await fetchCareCircleEvents(accessToken, writeCalendarId);
  const plan = planCalendarWriteback(state.obligations, state.members, existing);

  for (const c of plan.creates) await insertEvent(accessToken, writeCalendarId, c.body);
  for (const u of plan.updates) await patchEvent(accessToken, writeCalendarId, u.eventId, u.body);

  return {
    created: plan.creates.length,
    updated: plan.updates.length,
    // Everything already on the calendar that we did not need to touch.
    unchanged: Math.max(0, existing.size - plan.updates.length),
  };
}
