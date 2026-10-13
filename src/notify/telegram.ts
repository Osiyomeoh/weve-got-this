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
 * Members can also link themselves by tapping their personal invite (see
 * domain/telegram-invite); `linked` looks those up in the care record.
 */

export interface TelegramConfig {
  /** The bot token from @BotFather (e.g. "123456:ABC-DEF..."). */
  token: string;
  /** member id -> Telegram user/chat id (numeric, carried as a string). */
  recipients: Map<string, string>;
  /** Optional family group chat id: when set, asks post to the group (naming the
   *  person) so the whole circle sees the loop, instead of a private message. */
  groupChatId?: string;
  /** The household the group belongs to. Only its members' asks are posted there. */
  groupHouseholdId?: string;
  /** A member's self-linked Telegram account, from the care record. */
  linked?: (memberId: string) => { telegramId: string; householdId: string } | undefined;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function telegramConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  linked?: TelegramConfig['linked'],
): TelegramConfig | null {
  const token = env['TELEGRAM_BOT_TOKEN']?.trim();
  const rawMap = env['TELEGRAM_RECIPIENTS']?.trim();
  // With invites, a circle can be reachable before anyone is in the deploy-time map.
  if (!token || (!rawMap && !linked)) return null;
  let recipients = new Map<string, string>();
  if (rawMap) {
    try {
      recipients = new Map(Object.entries(JSON.parse(rawMap) as Record<string, string>));
    } catch {
      return null; // a malformed map is a misconfiguration, not a reason to send blind
    }
  }
  const groupChatId = env['TELEGRAM_GROUP_CHAT_ID']?.trim();
  const groupHouseholdId = env['TELEGRAM_HOUSEHOLD_ID']?.trim();
  return {
    token,
    recipients,
    ...(groupChatId ? { groupChatId } : {}),
    ...(groupHouseholdId ? { groupHouseholdId } : {}),
    ...(linked ? { linked } : {}),
  };
}

/**
 * Post one message to a chat via the Bot API. Shared by the notifier (asks) and the
 * webhook (acknowledgements), so a reply is answered in the same place it arrived.
 * Returns success and the new message id, or a reason - it never throws.
 */
export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
  replyMarkup?: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; detail?: string }> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
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

/** Call any Bot API method; reports, never throws. */
export async function telegramCall(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Download a file a person sent (a voice note), by Telegram file id. */
export async function downloadTelegramFile(
  token: string,
  fileId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  const meta = await fetchImpl(`https://api.telegram.org/bot${token}/getFile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const path = ((await meta.json()) as { result?: { file_path?: string } }).result?.file_path;
  if (!path) throw new Error('Telegram did not return the file.');
  const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${path}`);
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Send a voice note (MP3 is accepted by sendVoice). Reports, never throws. */
export async function sendTelegramVoice(
  token: string,
  chatId: string,
  audio: Buffer,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const form = new FormData();
    form.set('chat_id', chatId);
    form.set('voice', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), 'reply.mp3');
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendVoice`, {
      method: 'POST',
      body: form,
    });
    return res.ok ? { ok: true } : { ok: false, detail: `sendVoice failed (${res.status})` };
  } catch (err) {
    return { ok: false, detail: `sendVoice failed: ${(err as Error).message}` };
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

  async direct(input: {
    to: string;
    text: string;
    buttons?: { text: string; data: string }[][];
  }): Promise<DeliveryResult> {
    const chatId = this.#cfg.recipients.get(input.to) ?? this.#cfg.linked?.(input.to)?.telegramId;
    if (!chatId)
      return { delivered: false, channel: 'telegram', detail: 'no Telegram chat for this member' };
    const markup = input.buttons
      ? {
          inline_keyboard: input.buttons.map((row) =>
            row.map((b) => ({ text: b.text, callback_data: b.data })),
          ),
        }
      : undefined;
    const r = await sendTelegramMessage(this.#cfg.token, chatId, input.text, this.#fetch, markup);
    return r.ok
      ? { delivered: true, channel: 'telegram', ...(r.id ? { detail: r.id } : {}) }
      : { delivered: false, channel: 'telegram', ...(r.detail ? { detail: r.detail } : {}) };
  }

  async broadcast(input: {
    householdId: string;
    recipients: { id: string; name: string }[];
    message: string;
  }): Promise<{ reached: string[] }> {
    const reached: string[] = [];
    for (const r of input.recipients) {
      const chatId = this.#cfg.recipients.get(r.id) ?? this.#cfg.linked?.(r.id)?.telegramId;
      if (!chatId) continue;
      const sent = await sendTelegramMessage(this.#cfg.token, chatId, input.message, this.#fetch);
      if (sent.ok) reached.push(r.name);
    }
    if (this.#cfg.groupChatId && this.#cfg.groupHouseholdId === input.householdId) {
      await sendTelegramMessage(this.#cfg.token, this.#cfg.groupChatId, input.message, this.#fetch);
    }
    return { reached };
  }

  async deliver(input: {
    to: string;
    toName: string;
    from: string;
    message: string;
  }): Promise<DeliveryResult> {
    // Group mode: post the ask into the family group, naming the person, so the
    // whole circle sees who was asked and can watch the answer come back.
    //
    // Only for people mapped to this family. One server holds many households
    // (sign-ups, per-visitor demo sandboxes, a real pilot family), and the group is
    // one real family's chat: an unmapped member belongs to someone else's circle, and
    // posting their care into this group would leak it. A member must be mapped anyway
    // for their reply to be recognised, so requiring it costs the family nothing.
    //
    // A member who linked themselves by invite is posted to the group only when they
    // belong to the group's household; anyone else linked is messaged privately.
    const mapped = this.#cfg.recipients.get(input.to);
    const linked = mapped ? undefined : this.#cfg.linked?.(input.to);
    const chatId = mapped ?? linked?.telegramId;
    if (!chatId) {
      // Honest: we did not message someone we have no chat with.
      return { delivered: false, channel: 'telegram', detail: 'no Telegram chat for this member' };
    }
    const groupIsTheirs =
      mapped !== undefined ||
      (!!linked &&
        !!this.#cfg.groupHouseholdId &&
        linked.householdId === this.#cfg.groupHouseholdId);
    if (this.#cfg.groupChatId && groupIsTheirs) {
      const text = `${input.toName}, ${input.message}`;
      const r = await sendTelegramMessage(
        this.#cfg.token,
        this.#cfg.groupChatId,
        text,
        this.#fetch,
      );
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
