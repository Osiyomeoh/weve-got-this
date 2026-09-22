/**
 * Adapter: the real WhatsApp Business Cloud API message shapes <-> what CareCircle acts on.
 *
 * WhatsApp is the *reply* channel of the delegation loop. CareCircle asks a specific
 * person to take a job on (outbound, via the notifier); they answer "yes" or "I can't"
 * on their own phone (inbound, via the webhook). This module is the pure core of the
 * inbound half: reading Meta's webhook payload and deciding what a reply means. The
 * network and the store live in the connector and the webhook handler.
 *
 * Two rules the wider system imposes here:
 *  - A reply is only ever an answer to a request that was actually made. An unbidden
 *    "yes" matches nothing and does nothing - the webhook looks up the sender's own
 *    outstanding request, and a message that answers no request is recorded as noise,
 *    never turned into an assignment.
 *  - "no" is an answer, not a failure. A decline is parsed as deliberately as an accept;
 *    silence (an unparseable message) is neither, and is left alone rather than guessed.
 *
 * Field names follow Meta's documented webhook contract
 * (entry[].changes[].value.messages[]), read defensively like the Ring adapter.
 */

/** A single inbound text message, normalised away from Meta's nesting. */
export interface WhatsAppInbound {
  /** The sender's phone in E.164 without '+', as WhatsApp sends it (e.g. "14155550100"). */
  from: string;
  /** The message text. */
  text: string;
  /** Meta's message id, for idempotency. */
  messageId: string;
}

/** What a reply means, or null when it answers neither way. */
export type ReplyIntent = 'accepted' | 'declined';

interface WaChange {
  value?: {
    messages?: Array<{
      from?: string;
      id?: string;
      type?: string;
      text?: { body?: string };
    }>;
  };
}
interface WaPayload {
  object?: string;
  entry?: Array<{ changes?: WaChange[] }>;
}

/**
 * Pull the text messages out of a webhook payload. Ignores everything that is not a
 * person sending words - status callbacks (delivered/read receipts), media, reactions -
 * because none of those is an answer to a request.
 */
export function parseInboundMessages(payload: unknown): WhatsAppInbound[] {
  const p = (payload ?? {}) as WaPayload;
  const out: WhatsAppInbound[] = [];
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        const from = typeof msg.from === 'string' ? msg.from.trim() : '';
        const text = typeof msg.text?.body === 'string' ? msg.text.body.trim() : '';
        const messageId = typeof msg.id === 'string' ? msg.id : '';
        // Only genuine text messages carry an answer.
        if ((msg.type ?? 'text') !== 'text') continue;
        if (!from || !text || !messageId) continue;
        out.push({ from, text, messageId });
      }
    }
  }
  return out;
}

const YES = /\b(yes|yeah|yep|yup|sure|ok(ay)?|will do|i'?ll (do|take)|i can|i've got|got it|of course|absolutely)\b/i;
const NO = /\b(no|nope|can'?t|cannot|sorry|not (this|able)|unable|won'?t|busy|afraid not|another time)\b/i;
// Thumb emoji are unambiguous and carry no word boundary, so they are matched apart
// from the bounded word regexes above.
const YES_EMOJI = '👍';
const NO_EMOJI = '👎';

/**
 * Decide what a reply means. Deliberately conservative: a message must clearly read as
 * an accept or a decline, and an ambiguous one returns null so the loop stays put
 * rather than inventing agreement. A decline is checked first, because "no, I can't"
 * contains no yes but must never be read as one.
 */
export function interpretReply(text: string): ReplyIntent | null {
  if (NO.test(text) || text.includes(NO_EMOJI)) return 'declined';
  if (YES.test(text) || text.includes(YES_EMOJI)) return 'accepted';
  return null;
}

/** Normalise a phone to comparable form: digits only (drops '+', spaces, dashes). */
export function normalisePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}
