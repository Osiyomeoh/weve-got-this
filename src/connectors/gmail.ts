import type { CareStore } from '../store/store.js';
import { applyAppointment } from '../domain/appointments.js';
import { emailToAppointment, EMAIL_REPORTER, type EmailMessage } from '../domain/email.js';
import { refreshAccessToken, type GoogleCredentials } from './google-oauth.js';

/**
 * The Gmail connector: real appointment-confirmation emails as a source of appointments.
 *
 * A real inbound integration. It searches the account's mail for messages carrying a
 * calendar invite (.ics) and folds each into the care record through `applyAppointment`
 * - the same path a spoken appointment takes. It acts only on the invite's machine-
 * readable start (see domain/email.ts); it never guesses a date from email prose.
 *
 * Network at the edges, pure core:
 *  - `fetchInviteEmails` is the only function that talks to Gmail;
 *  - `syncEmailAppointments` is pure over already-fetched emails and is what tests hit;
 *  - `runGmailSync` wires them together.
 */

export interface GmailConfig extends GoogleCredentials {
  /**
   * Gmail search query selecting candidate messages. Defaults to invites from the
   * last 30 days. Narrow it to trusted senders in production, e.g.
   * `from:(mercyclinic.com OR walgreens.com) filename:ics`.
   */
  query?: string;
  /** Max messages to scan per run. Defaults to 25. */
  maxResults?: number;
}

export interface EmailSyncResult {
  fetched: number;
  applied: Array<{ eventId: string; kind: string; proposals: number; spoken: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const DEFAULT_QUERY = 'filename:ics newer_than:30d';

export function gmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GmailConfig | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim();
  const refreshToken = env['GOOGLE_REFRESH_TOKEN']?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const max = Number(env['GMAIL_MAX_RESULTS']);
  return {
    clientId,
    clientSecret,
    refreshToken,
    query: env['GMAIL_QUERY']?.trim() || DEFAULT_QUERY,
    ...(Number.isFinite(max) && max > 0 ? { maxResults: max } : {}),
  };
}

interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Depth-first search for the first calendar (.ics) part's decoded text. */
function findIcsText(part: GmailPart | undefined): string | undefined {
  if (!part) return undefined;
  const isCalendar = part.mimeType === 'text/calendar'
    || (part.filename ?? '').toLowerCase().endsWith('.ics');
  if (isCalendar && part.body?.data) return decodeBase64Url(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findIcsText(child);
    if (found) return found;
  }
  return undefined;
}

function headerValue(part: GmailPart | undefined, name: string): string | undefined {
  return (part?.headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value;
}

/** Fetch candidate emails and reduce each to the subset the door reads. */
export async function fetchInviteEmails(
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<EmailMessage[]> {
  const listUrl = `${GMAIL_API}?${new URLSearchParams({ q: query, maxResults: String(maxResults) })}`;
  const listRes = await fetch(listUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!listRes.ok) {
    const text = await listRes.text().catch(() => '');
    throw new Error(`Gmail list failed (${listRes.status}): ${text.slice(0, 300)}`);
  }
  const list = (await listRes.json()) as { messages?: Array<{ id?: string }> };

  const emails: EmailMessage[] = [];
  for (const ref of list.messages ?? []) {
    if (!ref.id) continue;
    const msgRes = await fetch(`${GMAIL_API}/${ref.id}?format=full`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!msgRes.ok) continue; // one unreadable message must not sink the batch
    const msg = (await msgRes.json()) as { id?: string; payload?: GmailPart };
    const icsText = findIcsText(msg.payload);
    const from = headerValue(msg.payload, 'From');
    const subject = headerValue(msg.payload, 'Subject');
    emails.push({
      messageId: msg.id ?? ref.id,
      ...(from ? { from } : {}),
      ...(subject ? { subject } : {}),
      ...(icsText ? { icsText } : {}),
    });
  }
  return emails;
}

/**
 * Apply a batch of already-fetched emails. Pure of the network. De-duplicates against
 * appointments already recorded from email (by the invite's externalId), so re-running
 * is safe and only a new invite creates work.
 */
export async function syncEmailAppointments(
  store: CareStore,
  householdId: string,
  emails: EmailMessage[],
  now: Date,
  forMemberId?: string,
): Promise<EmailSyncResult> {
  const seen = new Set<string>();
  for (const e of store.getCareState(householdId).events) {
    if (e.kind === 'appointment_scheduled') {
      const ext = e.data['externalId'];
      if (typeof ext === 'string') seen.add(ext);
    }
  }

  const result: EmailSyncResult = { fetched: emails.length, applied: [], skipped: [] };

  for (const email of emails) {
    const mapping = emailToAppointment(email, store.getCareState(householdId).household.timezone);
    if (!mapping.apply) {
      result.skipped.push({ id: email.messageId, reason: mapping.reason });
      continue;
    }
    if (mapping.input.externalId && seen.has(mapping.input.externalId)) {
      result.skipped.push({ id: email.messageId, reason: 'already applied (unchanged)' });
      continue;
    }

    const applied = await applyAppointment(store, householdId, {
      ...mapping.input,
      ...(forMemberId ? { forMemberId } : {}),
      reportedBy: EMAIL_REPORTER,
    }, now);

    if (!applied.ok) {
      result.skipped.push({ id: email.messageId, reason: applied.spoken });
      continue;
    }
    if (mapping.input.externalId) seen.add(mapping.input.externalId);
    result.applied.push({
      eventId: applied.eventId,
      kind: mapping.input.kind,
      proposals: applied.proposals.length,
      spoken: applied.spoken,
    });
  }

  return result;
}

/** End-to-end real sync: refresh a token, search Gmail, apply the invites. */
export async function runGmailSync(
  store: CareStore,
  householdId: string,
  config: GmailConfig,
  now: Date,
  forMemberId?: string,
): Promise<EmailSyncResult> {
  const accessToken = await refreshAccessToken(config);
  const emails = await fetchInviteEmails(accessToken, config.query ?? DEFAULT_QUERY, config.maxResults ?? 25);
  return syncEmailAppointments(store, householdId, emails, now, forMemberId);
}
