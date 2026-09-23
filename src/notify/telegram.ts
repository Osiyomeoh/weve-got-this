import type { Notifier, DeliveryResult } from './notifier.js';

/**
 * Delivering a message to a member over the Telegram Bot API.
 *
 * The outbound half of the Telegram door, and the reason Telegram is worth having: it
 * is the same delegation-loop reply channel as WhatsApp, but a bot token from
 * @BotFather stands it up in a minute with no business verification. It sits behind the
 * same `Notifier` seam as WhatsApp/SNS/record-only, so the request flow is identical
 * whether or not it is configured - and, like the others, a send failure is reported,
 * never thrown: the ask is already safely in the care record.
 *
 * Members are mapped to Telegram chat ids by an explicit env map
 * (`TELEGRAM_RECIPIENTS`), not a field on the person - a chat id is contact data we
 * take in deliberately for exactly the people who started a chat with the bot, and a
 * member with no mapping simply is not messaged (`delivered: false`), never guessed at.
 * (A person must message the bot first; Telegram will not let a bot open a chat.)
 */

export interface TelegramConfig {
  /** The bot token from @BotFather (e.g. "123456:ABC-DEF..."). */
  token: string;
  /** member id -> Telegram user/chat id (numeric, carried as a string). */
  recipients: Map<string, string>;
  /** Optional family group chat id: when set, asks post to the group (naming the
   *  person) so the whole circle sees the loop, instead of a private message. */
  groupChatId?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function telegramConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env['TELEGRAM_BOT_TOKEN']?.trim();
  const rawMap = env['TELEGRAM_RECIPIENTS']?.trim();
  if (!token || !rawMap) return null;
  let recipients: Map<string, string>;
  try {
    recipients = new Map(Object.entries(JSON.parse(rawMap) as Record<string, string>));
  } catch {
    return null; // a malformed map is a misconfiguration, not a reason to send blind
  }
  const groupChatId = env['TELEGRAM_GROUP_CHAT_ID']?.trim();
  return { token, recipients, ...(groupChatId ? { groupChatId } : {}) };
}

/**
 * Post one message to a chat via the Bot API. Shared by the notifier (asks) and the
 * webhook (acknowledgements), so a reply is answered in the same place it arrived.
 * Returns success and the new message id, or a reason - it never throws.
 */
export async function sendTelegramMessage(
  token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; id?: string; detail?: string }> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, detail: `send failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const json = (await res.json().catch(() => ({}))) as { result?: { message_id?: number } };
    const id = json.result?.message_id;
    return { ok: true, ...(id !== undefined ? { id: String(id) } : {}) };
  } catch (err) {
    return { ok: false, detail: `send failed: ${(err as Error).message}` };
  }
}

export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  readonly #cfg: TelegramConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: TelegramConfig) {
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async deliver(input: { to: string; toName: string; from: string; message: string }): Promise<DeliveryResult> {
    // Group mode: post the ask into the family group, naming the person, so the
    // whole circle sees who was asked and can watch the answer come back.
    //
    // Only for people mapped to this family. One server holds many households
    // (sign-ups, per-visitor demo sandboxes, a real pilot family), and the group is
    // one real family's chat: an unmapped member belongs to someone else's circle, and
    // posting their care into this group would leak it. A member must be mapped anyway
    // for their reply to be recognised, so requiring it costs the family nothing.
    const chatId = this.#cfg.recipients.get(input.to);
    if (!chatId) {
      // Honest: we did not message someone we have no chat with.
      return { delivered: false, channel: 'telegram', detail: 'no Telegram chat for this member' };
    }
    if (this.#cfg.groupChatId) {
      const text = `${input.toName}, ${input.message}`;
      const r = await sendTelegramMessage(this.#cfg.token, this.#cfg.groupChatId, text, this.#fetch);
      return r.ok
        ? { delivered: true, channel: 'telegram', ...(r.id ? { detail: r.id } : {}) }
        : { delivered: false, channel: 'telegram', ...(r.detail ? { detail: r.detail } : {}) };
    }
    const r = await sendTelegramMessage(this.#cfg.token, chatId, input.message, this.#fetch);
    return r.ok
      ? { delivered: true, channel: 'telegram', ...(r.id ? { detail: r.id } : {}) }
      : { delivered: false, channel: 'telegram', ...(r.detail ? { detail: r.detail } : {}) };
  }
}
