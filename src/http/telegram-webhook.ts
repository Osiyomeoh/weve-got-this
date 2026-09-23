import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { parseTelegramUpdate, interpretReply, type TelegramInbound } from '../domain/telegram.js';
import { sendTelegramMessage } from '../notify/telegram.js';
import { applyRequestResponse } from '../domain/request-response.js';
import { SeenEvents } from './ring-webhook.js';
import type { ChatReply } from './telegram-chat.js';
import { memberFromInvite, startPayload, welcome } from '../domain/telegram-invite.js';
import { NotFoundError } from '../store/store.js';

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
  /** Signs personal invite links (see domain/telegram-invite). Defaults to the secret token. */
  inviteSecret?: string;
  /** The bot's @username, for the welcome message. */
  botUsername?: string;
  /** The family group this door serves: joins are announced there, and a new face there is
   *  pointed to their invite. Other groups never hear from the bot unprompted. */
  groupChatId?: string;
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

  const inviteSecret = opts.inviteSecret ?? opts.secretToken;
  const botUsername = opts.botUsername ?? 'the bot';
  const nudged = new Set<string>();

  // Who sent this. A link the person made themselves, by tapping their own invite, wins
  // over the deploy-time map, so a person the demo map once named can still join their
  // real family's circle.
  const whoIs = (fromId: string): { memberId: string; householdId: string } | null => {
    const link = opts.store.telegramLinkFor(fromId);
    if (link) return { memberId: link.memberId, householdId: link.householdId };
    const mapped = byUser.get(fromId);
    return mapped ? { memberId: mapped, householdId: opts.householdId } : null;
  };
  const linkedElsewhere = (memberId: string, fromId: string): boolean => {
    for (const [userId, m] of byUser) if (m === memberId && userId !== fromId) return true;
    const link = opts.store.telegramLinkOf(memberId);
    return !!link && link.telegramId !== fromId;
  };

  // `/start`, with or without an invite. Only ever acted on in a private chat: an invite
  // link always opens one, and an invite pasted into a group would be seen by everyone.
  const onStart = async (msg: TelegramInbound, payload: string): Promise<string> => {
    if (!msg.isPrivate) return 'start-in-group';
    const sender = whoIs(msg.fromId);
    const greet = async (memberId: string): Promise<void> => {
      const member = opts.store.getMember(memberId);
      await answer(msg.chatId, welcome(member, opts.store.getCareState(member.householdId), botUsername));
    };
    if (!payload) {
      if (sender) { await greet(sender.memberId); return 'welcome-again'; }
      await answer(msg.chatId, "Hi, I'm CareCircle. I help a family share the care of someone they love. To join your family's circle, tap the personal link they sent you.");
      return 'start-without-invite';
    }
    const memberId = memberFromInvite(inviteSecret, payload);
    let member;
    try {
      member = memberId ? opts.store.getMember(memberId) : null;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      member = null;
    }
    if (!member) {
      await answer(msg.chatId, "That link doesn't work any more. Ask whoever set up your family's circle for a new one.");
      return 'invite-invalid';
    }
    if (sender && sender.memberId === member.id) { await greet(member.id); return 'welcome-again'; }
    // Only a link the person made stops them becoming someone else. The deploy-time map
    // doesn't: that is how a person the demo named joins their own family.
    const own = opts.store.telegramLinkFor(msg.fromId);
    if (own) {
      const me = opts.store.getMember(own.memberId);
      await answer(msg.chatId, `This Telegram account is already connected as ${me.name}, so it can't also be ${member.name}.`);
      return 'invite-for-someone-else';
    }
    if (linkedElsewhere(member.id, msg.fromId)) {
      await answer(msg.chatId, `${member.name} is already connected from another Telegram account. If that's not right, ask whoever set up your family's circle.`);
      return 'invite-already-used';
    }
    await opts.store.linkTelegram({ telegramId: msg.fromId, memberId: member.id, householdId: member.householdId, linkedAt: now().toISOString() });
    await greet(member.id);
    if (opts.groupChatId && member.householdId === opts.householdId) {
      await answer(opts.groupChatId, `${member.name} has joined ${opts.store.getCareState(member.householdId).household.name} on Telegram.`);
    }
    return 'linked';
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
      const start = startPayload(msg.text);
      if (start !== null) {
        results.push({ updateId: msg.updateId, status: await onStart(msg, start) });
        continue;
      }
      const sender = whoIs(msg.fromId);
      if (!sender) {
        // A stranger, or a group member we do not know: acknowledge to Telegram
        // (so it stops retrying) and touch nothing. The ids go to the server log - never
        // the text - so the operator can see who still needs an invite. In the family's
        // own group, a new face is pointed to their invite once; anywhere else, silence.
        opts.log?.(`telegram: unmapped sender ${msg.fromId} (${msg.fromName ?? 'no name'}) in ${msg.isPrivate ? 'a private chat' : `group ${msg.chatId}`}`);
        if (opts.groupChatId && msg.chatId === opts.groupChatId && !nudged.has(msg.fromId)) {
          nudged.add(msg.fromId);
          await answer(msg.chatId, `Hi${msg.fromName ? ` ${msg.fromName}` : ''}, I don't know who you are in this circle yet. Tap the personal link your family sent you, and I will.`);
        }
        results.push({ updateId: msg.updateId, status: 'unknown-sender' });
        continue;
      }
      const { memberId, householdId } = sender;
      const talk = opts.chat && msg.addressedToBot ? opts.chat : null;
      try {
        const intent = interpretReply(msg.text);
        if (intent) {
          const r = await applyRequestResponse(
            opts.store,
            { householdId, memberId, accepted: intent === 'accepted', note: msg.text, channel: 'telegram' },
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
