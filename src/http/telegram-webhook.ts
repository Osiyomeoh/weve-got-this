import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import {
  parseTelegramUpdate,
  parseTelegramTap,
  interpretReply,
  type TelegramInbound,
  type TelegramTap,
} from '../domain/telegram.js';
import { doseRecord } from '../domain/gaps.js';
import { clockTime } from '../domain/local-time.js';
import { can } from '../domain/auth.js';
import { telegramCall } from '../notify/telegram.js';
import { calendarToken } from '../domain/family-access.js';
import { sendTelegramMessage } from '../notify/telegram.js';
import { applyRequestResponse } from '../domain/request-response.js';
import { SeenEvents } from './ring-webhook.js';
import type { ChatReply } from './telegram-chat.js';
import { memberFromInvite, startPayload, welcome } from '../domain/telegram-invite.js';
import { NotFoundError } from '../store/store.js';
import {
  LANGUAGES,
  LANGUAGE_CODES,
  buttonLabel,
  isLanguageCode,
  languageNote,
  languageOf,
  medicineName,
  phrase,
  timeIn,
} from '../domain/language.js';
import type { LanguageCode } from '../domain/types.js';

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

function verifySecretToken(given: string | undefined, expected: string): boolean {
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
  /** Turn a voice note (Telegram file id) into text, in a Transcribe language ("es-US").
   *  Without it, voice notes get a polite "please type". */
  hear?: (fileId: string, languageCode: string) => Promise<string>;
  /** Say a reply back as a voice note, in a Polly voice, to someone who spoke to us. */
  speak?: (chatId: string, text: string, voice: string) => Promise<void>;
  /** The family calendar (a Telegram Mini App); `/calendar` opens it. */
  calendarUrl?: string;
}

/** Longer than this, and a voice note is asked to come in pieces: cost, and a clearer record. */
const MAX_VOICE_SECONDS = 120;

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
      await answer(
        msg.chatId,
        welcome(member, opts.store.getCareState(member.householdId), botUsername),
      );
    };
    if (!payload) {
      if (sender) {
        await greet(sender.memberId);
        return 'welcome-again';
      }
      await answer(
        msg.chatId,
        "Hi, I'm CareCircle. I help a family share the care of someone they love. To join your family's circle, tap the personal link they sent you.",
      );
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
      await answer(
        msg.chatId,
        "That link doesn't work any more. Ask whoever set up your family's circle for a new one.",
      );
      return 'invite-invalid';
    }
    if (sender && sender.memberId === member.id) {
      await greet(member.id);
      return 'welcome-again';
    }
    // Only a link the person made stops them becoming someone else. The deploy-time map
    // doesn't: that is how a person the demo named joins their own family.
    const own = opts.store.telegramLinkFor(msg.fromId);
    if (own) {
      const me = opts.store.getMember(own.memberId);
      await answer(
        msg.chatId,
        `This Telegram account is already connected as ${me.name}, so it can't also be ${member.name}.`,
      );
      return 'invite-for-someone-else';
    }
    if (linkedElsewhere(member.id, msg.fromId)) {
      await answer(
        msg.chatId,
        `${member.name} is already connected from another Telegram account. If that's not right, ask whoever set up your family's circle.`,
      );
      return 'invite-already-used';
    }
    await opts.store.linkTelegram({
      telegramId: msg.fromId,
      memberId: member.id,
      householdId: member.householdId,
      linkedAt: now().toISOString(),
    });
    await greet(member.id);
    if (opts.groupChatId && member.householdId === opts.householdId) {
      await answer(
        opts.groupChatId,
        `${member.name} has joined ${opts.store.getCareState(member.householdId).household.name} on Telegram.`,
      );
    }
    return 'linked';
  };

  const languageFor = (memberId: string) => {
    try {
      return languageOf(opts.store.getMember(memberId));
    } catch {
      return LANGUAGES.en;
    }
  };

  const hearVoice = async (
    msg: TelegramInbound,
    memberId: string,
  ): Promise<{ text: string } | { reply: string; status: string }> => {
    if (!opts.hear)
      return {
        reply: "I can't listen to voice notes yet. Could you type it for me?",
        status: 'voice-unsupported',
      };
    if ((msg.voice?.seconds ?? 0) > MAX_VOICE_SECONDS) {
      return {
        reply:
          'That voice note is a bit long for me. Could you send it in shorter pieces, under two minutes each?',
        status: 'voice-too-long',
      };
    }
    let text = '';
    // A language no speech service hears is heard as English, which is what they were told.
    try {
      text = (await opts.hear(msg.voice!.fileId, languageFor(memberId).hears ?? 'en-US')).trim();
    } catch {
      text = '';
    }
    return text
      ? { text }
      : {
          reply: "I couldn't make out that voice note. Could you say it again, or type it?",
          status: 'voice-unclear',
        };
  };

  const tg = (method: string, body: Record<string, unknown>) =>
    opts.botToken ? telegramCall(opts.botToken, method, body, fetchImpl) : Promise.resolve(false);

  // A tap on a reminder's button. Recorded as the person who tapped, with the same rules
  // as saying it: the person themselves, or someone who may log for others.
  const onTap = async (t: TelegramTap): Promise<string> => {
    const sender = whoIs(t.fromId);
    const ack = (text: string) =>
      tg('answerCallbackQuery', { callback_query_id: t.callbackId, text });
    if (!sender) {
      await ack("I don't know who you are in this circle yet.");
      return 'unknown-sender';
    }
    // "lang:<code>" - a choice from /language.
    if (t.data.startsWith('lang:')) {
      const code = t.data.slice(5);
      if (!isLanguageCode(code)) {
        await ack('');
        return 'tap-unknown';
      }
      await setLanguage(sender.memberId, sender.householdId, code, t.chatId, Number(t.messageId));
      await ack(LANGUAGES[code].native);
      return 'language-set';
    }
    // "dose:<medicationId>:<HH:MM>" - the time has a colon of its own.
    const [action, medId, ...rest] = t.data.split(':');
    const slot = rest.join(':');
    const state = opts.store.getCareState(sender.householdId);
    const med = state.medications.find((m) => m.id === medId);
    const me = state.members.find((m) => m.id === sender.memberId);
    if (!med || !me || !slot) {
      await ack('That reminder is out of date.');
      return 'tap-stale';
    }
    const tz = state.household.timezone;
    const lang = me.language;
    const at = (iso: string) => ({ own: timeIn(lang, iso, tz), en: clockTime(iso, tz) });
    // The medicine as this person's family calls it in their language; the English keeps the record's name.
    const called = medicineName(med, lang);
    if (action === 'dose') {
      if (me.id !== med.forMemberId && !can(me, 'log_others_event')) {
        await ack('Only the person or the family can record this.');
        return 'tap-refused';
      }
      const earlier = doseRecord(state, med.id, slot, now());
      if (earlier) {
        const when = at(earlier.occurredAt);
        const other = state.members.find((m) => m.id === earlier.reportedBy);
        const text =
          earlier.reportedBy === me.id
            ? phrase(lang, [
                'alreadyYou',
                { med: called, time: when.own },
                { med: med.name, time: when.en },
              ])
            : phrase(lang, [
                'alreadyBy',
                { med: called, time: when.own, by: other?.spokenAs ?? other?.name ?? 'someone' },
                { med: med.name, time: when.en, by: other?.spokenAs ?? other?.name ?? 'someone' },
              ]);
        await tg('editMessageText', { chat_id: t.chatId, message_id: Number(t.messageId), text });
        await ack('Already recorded');
        return 'tap-already';
      }
      const takenAt = now().toISOString();
      await opts.store.appendEvent({
        householdId: sender.householdId,
        kind: 'medication_taken',
        reportedBy: me.id,
        occurredAt: takenAt,
        source: 'telegram',
        confidence: 'reported',
        detail: `Tapped "Taken" on the ${med.name} reminder`,
        data: { medicationId: med.id, medicationName: med.name, aboutMemberId: med.forMemberId },
      });
      const when = at(takenAt);
      await tg('editMessageText', {
        chat_id: t.chatId,
        message_id: Number(t.messageId),
        text: phrase(lang, [
          'recorded',
          { med: called, time: when.own },
          { med: med.name, time: when.en },
        ]),
      });
      await ack('Recorded');
      return 'tap-taken';
    }
    if (action === 'snooze') {
      const again = new Date(now().getTime() + 15 * 60_000);
      const when = at(again.toISOString());
      await tg('editMessageText', {
        chat_id: t.chatId,
        message_id: Number(t.messageId),
        text: phrase(lang, [
          'snoozed',
          { med: called, time: when.own },
          { med: med.name, time: when.en },
        ]),
      });
      await ack('In 15 minutes');
      // Held in memory: a restart in the next 15 minutes loses this one repeat, not the record.
      setTimeout(() => {
        const later = opts.store.getCareState(sender.householdId);
        if (doseRecord(later, med.id, slot, new Date())) return;
        void tg('sendMessage', {
          chat_id: t.chatId,
          text: phrase(lang, ['repeat', { med: called }, { med: med.name }]),
          reply_markup: {
            inline_keyboard: [
              [
                { text: buttonLabel(lang, 'taken'), callback_data: `dose:${med.id}:${slot}` },
                { text: buttonLabel(lang, 'snooze'), callback_data: `snooze:${med.id}:${slot}` },
              ],
            ],
          },
        });
      }, 15 * 60_000).unref?.();
      return 'tap-snoozed';
    }
    await ack('');
    return 'tap-unknown';
  };

  // Choosing a language: said back in it, with what to expect from voice notes. The
  // message with the buttons becomes the answer, so the choice is visible where it was made.
  const setLanguage = async (
    memberId: string,
    householdId: string,
    code: LanguageCode,
    chatId: string,
    messageId?: number,
  ): Promise<void> => {
    await opts.store.setMemberPreference(memberId, householdId, { language: code });
    const text = `${phrase(code, ['languageSet', {}])}\n\n${languageNote(code)}`;
    if (messageId) await tg('editMessageText', { chat_id: chatId, message_id: messageId, text });
    else await answer(chatId, text);
  };

  // A few plain commands, answered without the model.
  const onCommand = async (
    msg: TelegramInbound,
    memberId: string,
    householdId: string,
  ): Promise<string | null> => {
    const cmd = msg.text.trim().toLowerCase();
    const lang = /^\/language(?:@\w+)?(?:\s+(.+))?$/.exec(cmd);
    if (lang) {
      const wanted = lang[1]?.trim();
      const code = wanted
        ? LANGUAGE_CODES.find(
            (c) =>
              c === wanted ||
              LANGUAGES[c].name.toLowerCase().startsWith(wanted) ||
              LANGUAGES[c].native.toLowerCase().startsWith(wanted),
          )
        : undefined;
      if (code) {
        await setLanguage(memberId, householdId, code, msg.chatId);
        return 'language-set';
      }
      const buttons = LANGUAGE_CODES.map((c) => ({
        text: LANGUAGES[c].native,
        callback_data: `lang:${c}`,
      }));
      const rows: { text: string; callback_data: string }[][] = [];
      for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3));
      await tg('sendMessage', {
        chat_id: msg.chatId,
        text:
          `Which language should I write to you in? Now: ${languageFor(memberId).native}.` +
          "\nMedicine names, people's names and times always stay exactly as the family wrote them.",
        reply_markup: { inline_keyboard: rows },
      });
      return 'language-menu';
    }
    if (/^\/reminders\s+(off|on)$/.test(cmd)) {
      const off = cmd.endsWith('off');
      await opts.store.setMemberPreference(memberId, householdId, {
        reminders: off ? 'off' : undefined,
      });
      await answer(
        msg.chatId,
        off
          ? 'Reminders are off for you. Type /reminders on to have them back.'
          : "Reminders are on: I'll remind you at dose times and before appointments, here in our private chat.",
      );
      return off ? 'reminders-off' : 'reminders-on';
    }
    if (/^\/(calendar|board)$/.test(cmd)) {
      if (!opts.calendarUrl) {
        await answer(msg.chatId, "The calendar isn't switched on yet.");
        return 'calendar-off';
      }
      if (!msg.isPrivate) {
        await answer(
          msg.chatId,
          'Open our private chat and type /calendar there: the calendar opens inside Telegram, just for you.',
        );
        return 'calendar-in-group';
      }
      // In Telegram it opens as a Mini App; the browser link is signed for this person
      // and lasts a week, so it can be kept as a bookmark on a laptop.
      const token = calendarToken(
        inviteSecret,
        memberId,
        new Date(now().getTime() + 7 * 86_400_000),
      );
      await tg('sendMessage', {
        chat_id: msg.chatId,
        text:
          'Here is the family calendar: everything coming up, who has what, and what nobody has taken yet. ' +
          "The browser link is just for you and lasts a week, so please don't forward it.",
        reply_markup: {
          inline_keyboard: [
            [{ text: '📅 Open the calendar', web_app: { url: opts.calendarUrl } }],
            [{ text: '🖥 Open in a browser', url: `${opts.calendarUrl}#t=${token}` }],
          ],
        },
      });
      return 'calendar';
    }
    return null;
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
    const tap = parseTelegramTap(req.body);
    if (tap) {
      const status = seen.admit(tap.updateId)
        ? await onTap(tap).catch((err: Error) => `error: ${err.message}`)
        : 'duplicate';
      res.status(200).json({ status: 'accepted', results: [{ updateId: tap.updateId, status }] });
      return;
    }
    for (let msg of parseTelegramUpdate(req.body)) {
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
        opts.log?.(
          `telegram: unmapped sender ${msg.fromId} (${msg.fromName ?? 'no name'}) in ${msg.isPrivate ? 'a private chat' : `group ${msg.chatId}`}`,
        );
        if (opts.groupChatId && msg.chatId === opts.groupChatId && !nudged.has(msg.fromId)) {
          nudged.add(msg.fromId);
          await answer(
            msg.chatId,
            `Hi${msg.fromName ? ` ${msg.fromName}` : ''}, I don't know who you are in this circle yet. Tap the personal link your family sent you, and I will.`,
          );
        }
        results.push({ updateId: msg.updateId, status: 'unknown-sender' });
        continue;
      }
      const { memberId, householdId } = sender;
      const talk = opts.chat && msg.addressedToBot ? opts.chat : null;

      // A voice note is heard only when it is for the bot: in a private chat, or a reply to
      // one of its messages. The family's own voice notes to each other are never listened to.
      let heard: string | null = null;
      if (msg.voice) {
        if (!msg.addressedToBot) {
          results.push({ updateId: msg.updateId, status: 'unparsed' });
          continue;
        }
        const said = await hearVoice(msg, memberId);
        if ('reply' in said) {
          await answer(msg.chatId, said.reply);
          results.push({ updateId: msg.updateId, status: said.status });
          continue;
        }
        heard = said.text;
        msg = { ...msg, text: heard };
      }
      const command = msg.voice ? null : await onCommand(msg, memberId, householdId);
      if (command) {
        results.push({ updateId: msg.updateId, status: command });
        continue;
      }
      // What we heard is shown back, so a misheard word is caught before it becomes the record.
      // Whoever spoke to us gets the answer spoken too.
      const language = languageFor(memberId);
      const reply = async (text: string): Promise<void> => {
        await answer(
          msg.chatId,
          heard ? `${phrase(language.code, ['heard', { text: heard }])}\n\n${text}` : text,
        );
        // Spoken back only in a voice that speaks their language; otherwise it stays written.
        if (heard && opts.speak && language.voice)
          await opts.speak(msg.chatId, text, language.voice).catch(() => undefined);
      };
      try {
        const intent = interpretReply(msg.text);
        if (intent) {
          const r = await applyRequestResponse(
            opts.store,
            {
              householdId,
              memberId,
              accepted: intent === 'accepted',
              note: msg.text,
              channel: 'telegram',
            },
            now(),
          );
          // A yes or no that answers an ask is exactly that, and nothing else. One that
          // answers nothing ("yes, I took my pills") is someone talking to CareCircle.
          if (r.ok || !talk) {
            // The bot answers where the reply came from, so the loop is visible: a "yes"
            // in the family group gets "that's yours now" in the family group.
            await reply(r.spoken);
            results.push({
              updateId: msg.updateId,
              status: r.ok ? intent : 'no-open-request',
              ...(r.obligationId ? { obligationId: r.obligationId } : {}),
            });
            continue;
          }
        }
        if (!talk) {
          // Not a yes or a no, and not meant for the bot - ordinary family chatter.
          results.push({ updateId: msg.updateId, status: 'unparsed' });
          continue;
        }
        await reply(await talk(memberId, msg.text));
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
