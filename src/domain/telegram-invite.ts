import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CareState, Member } from './types.js';

/**
 * Joining a family's circle on Telegram, one person at a time.
 *
 * Each member gets a personal link, `t.me/<bot>?start=<invite>`. Tapping it opens a chat
 * with the bot and sends `/start <invite>`, which does the two things Telegram requires
 * and CareCircle needs in one tap: the person starts the bot (a bot may not message
 * anyone first), and says which member of the circle they are.
 *
 * The invite is signed, not stored: an HMAC of the member id under the webhook secret,
 * so only the operator can mint one, and nobody can make up an invite for someone else.
 * It is used once. When a member's Telegram is already linked, their invite
 * cannot move the link to a different account. A forwarded link can't take someone's
 * place in the circle.
 */

const SIG_LENGTH = 16;
// Telegram allows [A-Za-z0-9_-] in a start payload, at most 64 characters.
const PAYLOAD = /^[A-Za-z0-9_-]{17,64}$/;

function signature(secret: string, memberId: string): string {
  return createHmac('sha256', secret).update(`telegram-invite:${memberId}`).digest('hex').slice(0, SIG_LENGTH);
}

/** The start payload for a member's personal link. */
export function inviteFor(secret: string, memberId: string): string {
  const payload = signature(secret, memberId) + memberId;
  if (!PAYLOAD.test(payload)) throw new Error(`Member id ${memberId} can't be carried in a Telegram link.`);
  return payload;
}

/** The member an invite was minted for, or null if it wasn't minted with this secret. */
export function memberFromInvite(secret: string, payload: string): string | null {
  if (!secret || !PAYLOAD.test(payload)) return null;
  const given = Buffer.from(payload.slice(0, SIG_LENGTH));
  const memberId = payload.slice(SIG_LENGTH);
  const expected = Buffer.from(signature(secret, memberId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? memberId : null;
}

export function inviteLink(botUsername: string, invite: string): string {
  return `https://t.me/${botUsername}?start=${invite}`;
}

/** What `/start <payload>` carried, if the message is one. `@bot` mentions are already stripped. */
export function startPayload(text: string): string | null {
  const m = /^\/start(?:\s+(\S+))?\s*$/i.exec(text.trim());
  if (!m) return null;
  return m[1] ?? '';
}

/** The person the circle is for, as the family says it ("Daddy"). */
export function recipientName(state: CareState): string {
  const r = state.members.find((m) => m.role === 'care_recipient');
  return r?.spokenAs ?? r?.name ?? 'the person you care for';
}

export const ROLE: Record<Member['role'], string> = {
  care_recipient: 'the person this circle is for',
  primary_caregiver: 'the coordinator',
  caregiver: 'a caregiver',
  helper: 'a helper',
};

/**
 * The first thing a person reads after tapping their link: who they are here, and what
 * to do. It's written for the family, not for engineers, and keeps to what the
 * product actually does.
 */
export function welcome(member: Member, state: CareState, botUsername: string): string {
  const them = recipientName(state);
  const lines = [`Hi ${member.name}, you're now connected to ${state.household.name} as ${ROLE[member.role]}.`, ''];

  if (member.role === 'care_recipient') {
    lines.push(
      'This circle is here for you, and you are part of it. Tell me things in your own words:',
      '- "I\'ve taken my eye drops" and I\'ll write it down with the time.',
      '- "I have the clinic on Thursday at 10" and I\'ll add it, so the family can sort out who takes you.',
      '- "What\'s on today?" and I\'ll tell you.',
      'Your family sees what you record. If something isn\'t written down, I only ever say there is no record of it, never that you missed it.',
    );
  } else if (member.role === 'primary_caregiver') {
    lines.push(
      `You coordinate ${them}'s care. You can:`,
      '- Ask "What might fall through the cracks?" to see work nobody has taken on yet.',
      `- Say "Ask whoever's free to take ${them} to the check-up." I'll ask someone. Nothing becomes theirs until they say yes.`,
      `- Ask "How was ${them}'s day?" for what's been recorded.`,
    );
  } else if (member.role === 'caregiver') {
    lines.push(
      `When something for ${them} needs a person, I may ask you on Telegram. Reply "yes" to take it on, or "can't" and I'll ask someone else. Nothing becomes yours unless you say yes.`,
      '- Say "That\'s done" when you\'ve handled something, so it stops showing as open.',
      '- Ask "What needs doing?" to see what\'s open.',
    );
  } else {
    lines.push(
      'You\'ll see today\'s work and anything you have taken on.',
      '- Say "That\'s done" when you\'ve finished something.',
    );
  }

  if (member.livesAway) {
    lines.push('', `You live in ${member.livesAway}, so I won't ask you on my own for things that need someone there.`
      + (member.dailyUpdate ? ` You'll get a short update on ${them}'s day every evening.` : ''));
  }

  lines.push(
    '',
    `Talk to me here any time. In the family group I only answer when you mention @${botUsername} or reply to one of my messages. The rest of the chat is yours.`,
  );
  return lines.join('\n');
}
