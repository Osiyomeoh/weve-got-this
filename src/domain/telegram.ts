/**
 * Adapter: the real Telegram Bot API update shape <-> what the app acts on.
 *
 * Telegram is a stand-in for WhatsApp as the *reply* channel of the delegation loop,
 * and a far lighter one to stand up: a bot token from @BotFather, no business
 * verification, no platform gate. The app asks a specific person to take a job on
 * (outbound, via the notifier); they answer "yes" or "I can't" in their own Telegram
 * chat with the bot (inbound, via the webhook). This module is the pure core of the
 * inbound half: reading Telegram's update payload and deciding what a reply means. The
 * network and the store live in the notifier and the webhook handler.
 *
 * The same two rules the wider system imposes on WhatsApp hold here, and the reply
 * interpretation is deliberately shared with WhatsApp (`interpretReply`), because how a
 * person answered must never change what their answer means:
 *  - A reply is only ever an answer to a request that was actually made. The webhook
 *    looks up the sender's own outstanding request; an unbidden "yes" matches nothing.
 *  - "no" is an answer, not a failure; an unparseable message is neither, and is left
 *    alone rather than guessed.
 *
 * Field names follow Telegram's documented webhook Update
 * (update_id + message{message_id, chat{id}, text}), read defensively.
 */

export { interpretReply, type ReplyIntent } from './whatsapp.js';

/** A single inbound text message, normalised away from Telegram's nesting. */
export interface TelegramInbound {
  /** The chat the message came from (a person in a DM, or the family group). */
  chatId: string;
  /** Who sent it - the person's own Telegram user id. In a DM this equals chatId;
   *  in a group it is how we tell one family member's reply from another's. */
  fromId: string;
  /** The sender's Telegram first name, for the operator mapping a new family member. */
  fromName?: string;
  /** The message text. For a voice note, empty until it has been transcribed. */
  text: string;
  /** A voice note: Telegram's file id, and how long it is. */
  voice?: { fileId: string; seconds: number };
  /** Telegram's update id, for idempotency. */
  updateId: string;
  /** A one-to-one chat with the bot, as opposed to the family group. */
  isPrivate: boolean;
  /** In a group: whether the message was meant for the bot - it @-mentions a bot, or
   *  replies to one. Family chatter that isn't is left alone. Always true in a DM. */
  addressedToBot: boolean;
}

interface TgUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    caption?: string;
    voice?: { file_id?: string; duration?: number };
    from?: { id?: number | string; first_name?: string };
    chat?: { id?: number | string; type?: string };
    reply_to_message?: { from?: { is_bot?: boolean } };
  };
}

/**
 * Pull the text message out of a webhook update. Telegram POSTs one Update per call,
 * but we return an array for symmetry with the WhatsApp handler's loop. Anything that
 * is not a person sending words - edited messages, joins, callbacks, media without a
 * caption - carries no answer and is ignored.
 */
export function parseTelegramUpdate(payload: unknown): TelegramInbound[] {
  const u = (payload ?? {}) as TgUpdate;
  const updateId = typeof u.update_id === 'number' ? String(u.update_id) : '';
  const chatRaw = u.message?.chat?.id;
  const chatId = chatRaw === undefined || chatRaw === null ? '' : String(chatRaw);
  const fromRaw = u.message?.from?.id;
  // In a DM Telegram still sends `from`, and it equals the chat; fall back to the
  // chat id so a payload without `from` (older fixtures, channel posts) still resolves.
  const fromId = fromRaw === undefined || fromRaw === null ? chatId : String(fromRaw);
  const raw = typeof u.message?.text === 'string' ? u.message.text.trim() : '';
  // Bot usernames always end in "bot", so a mention of one is a message for us. The
  // mention itself is not part of what the person said.
  const mention = /@\w*bot\b/i;
  const text = raw
    .replace(new RegExp(mention.source, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const v = u.message?.voice;
  const voice = v?.file_id ? { fileId: v.file_id, seconds: v.duration ?? 0 } : undefined;
  if (!updateId || !chatId || (!text && !voice)) return [];
  const isPrivate = u.message?.chat?.type === 'private';
  const addressedToBot =
    isPrivate || mention.test(raw) || u.message?.reply_to_message?.from?.is_bot === true;
  const fromName = u.message?.from?.first_name;
  return [
    {
      chatId,
      fromId,
      text,
      updateId,
      isPrivate,
      addressedToBot,
      ...(fromName ? { fromName } : {}),
      ...(voice ? { voice } : {}),
    },
  ];
}

/** A tap on one of the bot's buttons (a reminder's "Taken", say). */
export interface TelegramTap {
  updateId: string;
  callbackId: string;
  fromId: string;
  chatId: string;
  messageId: string;
  data: string;
}

export function parseTelegramTap(payload: unknown): TelegramTap | null {
  const u = (payload ?? {}) as {
    update_id?: number;
    callback_query?: {
      id?: string;
      data?: string;
      from?: { id?: number };
      message?: { message_id?: number; chat?: { id?: number } };
    };
  };
  const q = u.callback_query;
  if (
    typeof u.update_id !== 'number' ||
    !q?.id ||
    !q.data ||
    q.from?.id === undefined ||
    q.message?.chat?.id === undefined ||
    q.message.message_id === undefined
  )
    return null;
  return {
    updateId: String(u.update_id),
    callbackId: q.id,
    fromId: String(q.from.id),
    chatId: String(q.message.chat.id),
    messageId: String(q.message.message_id),
    data: q.data,
  };
}
