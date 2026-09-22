import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { parseTelegramUpdate, interpretReply } from '../domain/telegram.js';
import { applyRequestResponse } from '../domain/request-response.js';
import { SeenEvents } from './ring-webhook.js';

/**
 * The Telegram webhook - the inbound half of the delegation loop's reply channel.
 *
 * Telegram does not sign the request body the way Meta does; instead, when you register
 * the webhook you give it a secret token, and Telegram echoes that token back on every
 * call in the `X-Telegram-Bot-Api-Secret-Token` header. That header IS the gate here,
 * compared in constant time - anyone can POST to a public URL, and a forged "yes" would
 * assign a family's medical errand, so an update without the right token is rejected
 * before it is parsed. The same two further refusals as the WhatsApp webhook hold:
 *   - a redelivered update id is acknowledged but not acted on twice;
 *   - a reply is only ever matched to the *sender's own* outstanding request, so a
 *     message answering nothing does nothing.
 *
 * The chat the reply came from is mapped to a member by the inverse of the outbound
 * recipients map (`TELEGRAM_RECIPIENTS`). A message from a chat we do not know is
 * acknowledged and ignored - we do not act on strangers.
 */

export const SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token';

export function verifySecretToken(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface TelegramWebhookOptions {
  store: CareStore;
  /** The secret token we set when registering the webhook, echoed by Telegram. */
  secretToken: string;
  /** chat id -> member id. Inverse of the outbound recipients map. */
  memberByChat: Map<string, string>;
  /** Which household these replies belong to. */
  householdId: string;
  seen?: SeenEvents;
  now?: () => Date;
}

export function createTelegramWebhook(opts: TelegramWebhookOptions) {
  const seen = opts.seen ?? new SeenEvents();
  const now = opts.now ?? (() => new Date());
  const byChat = new Map<string, string>();
  for (const [chatId, memberId] of opts.memberByChat) byChat.set(String(chatId), memberId);

  return async function handle(req: Request, res: Response): Promise<void> {
    if (!opts.secretToken) {
      res.status(503).json({ error: 'Telegram integration is not configured.' });
      return;
    }
    if (!verifySecretToken(req.header(SECRET_TOKEN_HEADER) ?? undefined, opts.secretToken)) {
      res.status(401).json({ error: 'Bad secret token.' });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const msg of parseTelegramUpdate(req.body)) {
      if (!seen.admit(msg.updateId)) {
        results.push({ updateId: msg.updateId, status: 'duplicate' });
        continue;
      }
      const memberId = byChat.get(msg.chatId);
      if (!memberId) {
        results.push({ updateId: msg.updateId, status: 'unknown-sender' });
        continue;
      }
      const intent = interpretReply(msg.text);
      if (!intent) {
        results.push({ updateId: msg.updateId, status: 'unparsed' });
        continue;
      }
      try {
        const r = await applyRequestResponse(
          opts.store,
          { householdId: opts.householdId, memberId, accepted: intent === 'accepted', note: msg.text, channel: 'telegram' },
          now(),
        );
        results.push({ updateId: msg.updateId, status: r.ok ? intent : 'no-open-request', ...(r.obligationId ? { obligationId: r.obligationId } : {}) });
      } catch (err) {
        results.push({ updateId: msg.updateId, status: 'error', detail: (err as Error).message });
      }
    }

    // Always 200 once the token is good, so Telegram does not redeliver an update we
    // have already recorded a decision about.
    res.status(200).json({ status: 'accepted', results });
  };
}
