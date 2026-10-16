/**
 * Personal Telegram invites for a real family's circle: one link per person, and a short
 * message to send them with it.
 *
 *   npm run telegram:invites                          the one household that isn't the demo
 *   npm run telegram:invites -- --household h_abc123  a particular household
 *
 * Each person taps their own link, taps Start, and the bot knows who they are and tells
 * them their part (src/domain/telegram-invite.ts). Nobody has to post in a window, and the
 * operator never copies ids into .env.
 *
 * Reads DynamoDB when CARECIRCLE_TABLE is set (with AWS_REGION and credentials), and the
 * local file store otherwise. Read-only. Needs TELEGRAM_WEBHOOK_SECRET, the secret the
 * live server signs invites with. Prints links, never the secret.
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { ROLE, inviteFor, inviteLink, recipientName } from '../src/domain/telegram-invite.ts';

const DEMO = 'h_margaret';
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const secret = process.env['TELEGRAM_WEBHOOK_SECRET']?.trim();
if (!secret) {
  console.error('TELEGRAM_WEBHOOK_SECRET is not set (put it in .env). Invites are signed with it.');
  process.exit(1);
}
const bot = process.env['TELEGRAM_BOT_USERNAME']?.trim() || 'carecircle0111_bot';

const table = process.env['CARECIRCLE_TABLE']?.trim();
const region = process.env['AWS_REGION']?.trim();
const store = new CareStore(
  table
    ? new DynamoPersistence({ tableName: table, ...(region ? { region } : {}) })
    : new FilePersistence(process.env['CARECIRCLE_DB'] ?? 'carecircle.db.json'),
);
await store.init();

const households = [...new Set(store.allMembers().map((m) => m.householdId))];
let householdId = flag('--household');
if (!householdId) {
  const real = households.filter((h) => h !== DEMO && !h.startsWith(`${DEMO}~`));
  if (real.length !== 1) {
    console.error(
      real.length === 0
        ? 'No household other than the demo one yet. Create the circle at /setup first, or pass --household.'
        : `More than one household; pick one with --household:\n${real.map((h) => `  ${h}  ${store.getCareState(h).household.name}`).join('\n')}`,
    );
    process.exit(1);
  }
  householdId = real[0]!;
}
if (!households.includes(householdId)) {
  console.error(`No household ${householdId}.`);
  process.exit(1);
}

const state = store.getCareState(householdId);
const them = recipientName(state);
console.log(`${state.household.name} (${householdId}), bot @${bot}\n`);

for (const m of state.members) {
  const linked = store.telegramLinkOf(m.id);
  const link = inviteLink(bot, inviteFor(secret, m.id));
  console.log(`== ${m.name}, ${ROLE[m.role]}${linked ? '  (already connected)' : ''}`);
  console.log(`   ${link}\n`);
  const why =
    m.role === 'care_recipient'
      ? 'to help us all keep track of your care, and you are part of it'
      : `to help us share ${them}'s care`;
  console.log(
    [
      `Hi ${m.name}, I've set up We've Got This ${why}. It works in Telegram.`,
      '',
      `1. Tap this link on your phone: ${link}`,
      "2. Telegram opens a chat with We've Got This. Tap Start.",
      '',
      "It will tell you what you can do. The link is just for you, so please don't forward it.",
    ]
      .map((l) => `   ${l}`)
      .join('\n'),
  );
  console.log('');
}
