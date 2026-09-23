import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { parseTelegramUpdate, interpretReply } from '../domain/telegram.js';
import { sendTelegramMessage } from '../notify/telegram.js';
import { applyRequestResponse } from '../domain/request-response.js';
import { SeenEvents } from './ring-webhook.js';
import type { ChatReply } from './telegram-chat.js';

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
  /** Telegram user id -> member id. Inverse of the outbound recipients map. In a
   *  group this is how we tell whose reply it is; in a DM the id is the same. */
  memberByChat: Map<string, string>;
  /** Which household these replies belong to. */
  householdId: string;
  /** The bot token, so the bot can post its answer back into the chat. Without it,
   *  replies are still acted on but the bot stays silent. */
  botToken?: string;
  seen?: SeenEvents;
  now?: () => Date;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Talking to CareCircle: anything that isn't an answer to an ask goes here, from a DM
   * or from a group message addressed to the bot. Without it, only yes/no is understood.
   */
  chat?: ChatReply;
  /** Where operator notes go (unmapped senders). Defaults to nothing. */
  log?: (line: string) => void;
}

export function createTelegramWebhook(opts: TelegramWebhookOptions) {
  const seen = opts.seen ?? new SeenEvents();
  const now = opts.now ?? (() => new Date());
  const fetchImpl = opts.fetchImpl ?? fetch;
  const byUser = new Map<string, string>();
  for (const [userId, memberId] of opts.memberByChat) byUser.set(String(userId), memberId);
  // Answer in the chat the message came from - the group if it was a group, the
  // person if it was a DM - so the acknowledgement lands where the family can see it.
  const answer = async (chatId: string, text: string): Promise<void> => {
    if (opts.botToken) await sendTelegramMessage(opts.botToken, chatId, text, fetchImpl);
  };

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
      const memberId = byUser.get(msg.fromId);
      if (!memberId) {
        // A stranger, or a group member we do not know: acknowledge to Telegram
        // (so it stops retrying) but stay silent in the chat and touch nothing. The ids go
        // to the server log - never the text - so the operator can map a family member
        // who says hello at any time, instead of holding a listening window open.
        opts.log?.(`telegram: unmapped sender ${msg.fromId} (${msg.fromName ?? 'no name'}) in ${msg.isPrivate ? 'a private chat' : `group ${msg.chatId}`}`);
        results.push({ updateId: msg.updateId, status: 'unknown-sender' });
        continue;
      }
      const talk = opts.chat && msg.addressedToBot ? opts.chat : null;
      try {
        const intent = interpretReply(msg.text);
        if (intent) {
          const r = await applyRequestResponse(
            opts.store,
            { householdId: opts.householdId, memberId, accepted: intent === 'accepted', note: msg.text, channel: 'telegram' },
            now(),
          );
          // A yes or no that answers an ask is exactly that, and nothing else. One that
          // answers nothing ("yes, I took my pills") is someone talking to CareCircle.
          if (r.ok || !talk) {
            // The bot answers where the reply came from, so the loop is visible: a "yes"
            // in the family group gets "that's yours now" in the family group.
            await answer(msg.chatId, r.spoken);
            results.push({ updateId: msg.updateId, status: r.ok ? intent : 'no-open-request', ...(r.obligationId ? { obligationId: r.obligationId } : {}) });
            continue;
          }
        }
        if (!talk) {
          // Not a yes or a no, and not meant for the bot - ordinary family chatter.
          results.push({ updateId: msg.updateId, status: 'unparsed' });
          continue;
        }
        await answer(msg.chatId, await talk(memberId, msg.text));
        results.push({ updateId: msg.updateId, status: 'chat' });
      } catch (err) {
        results.push({ updateId: msg.updateId, status: 'error', detail: (err as Error).message });
      }
    }

    // Always 200 once the token is good, so Telegram does not redeliver an update we
    // have already recorded a decision about.
    res.status(200).json({ status: 'accepted', results });
  };
}
