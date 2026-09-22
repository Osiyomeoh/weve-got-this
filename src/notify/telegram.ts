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
  /** member id -> Telegram chat id (numeric, carried as a string). */
  recipients: Map<string, string>;
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
  return { token, recipients };
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
    const chatId = this.#cfg.recipients.get(input.to);
    if (!chatId) {
      // Honest: we did not message someone we have no chat with.
      return { delivered: false, channel: 'telegram', detail: 'no Telegram chat for this member' };
    }
    try {
      const res = await this.#fetch(
        `https://api.telegram.org/bot${this.#cfg.token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: input.message }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { delivered: false, channel: 'telegram', detail: `send failed (${res.status}): ${text.slice(0, 200)}` };
      }
      const json = (await res.json().catch(() => ({}))) as { result?: { message_id?: number } };
      const id = json.result?.message_id;
      return { delivered: true, channel: 'telegram', ...(id !== undefined ? { detail: String(id) } : {}) };
    } catch (err) {
      return { delivered: false, channel: 'telegram', detail: `send failed: ${(err as Error).message}` };
    }
  }
}
