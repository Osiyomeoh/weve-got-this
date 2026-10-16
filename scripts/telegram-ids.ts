/**
 * Pilot helper: list who has spoken in the family's Telegram group, so each person can
 * be mapped to a member in TELEGRAM_RECIPIENTS.
 *
 * Telegram refuses getUpdates while a webhook is set (and a live webhook consumes every
 * message), so this removes the webhook, listens for up to LISTEN_SECONDS while people
 * post one message each in the group, then always re-registers the webhook with the same
 * secret. Start it, then ask everyone to say hello in the group. Ctrl+C ends early.
 *
 *   npm run telegram:ids
 *
 * Prints chat ids and names only. The bot token and webhook secret are never printed.
 */

const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
const secret = process.env['TELEGRAM_WEBHOOK_SECRET']?.trim();
const publicUrl = (
  process.env['CARECIRCLE_PUBLIC_URL'] ?? 'https://ypq2dfq2p7.us-east-1.awsapprunner.com'
)
  .trim()
  .replace(/\/+$/, '');

interface TgUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TgChat {
  id: number;
  type: string;
  title?: string;
}
interface TgUpdate {
  message?: { from?: TgUser; chat: TgChat; text?: string };
}

async function call(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? res.status}`);
  return json.result;
}

async function main(): Promise<void> {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set (put it in .env).');
  if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set (put it in .env).');

  const listenSeconds = Number(process.env['LISTEN_SECONDS'] ?? 120);
  let stop = false;
  process.on('SIGINT', () => {
    stop = true;
  });

  await call('deleteWebhook');
  try {
    console.log(
      `Listening ${listenSeconds}s - ask everyone to post one message in the group now.\n`,
    );
    const groups = new Map<number, string>();
    const people = new Map<number, string>();
    const deadline = Date.now() + listenSeconds * 1000;
    let offset = 0;
    while (!stop && Date.now() < deadline) {
      const wait = Math.max(1, Math.min(20, Math.ceil((deadline - Date.now()) / 1000)));
      const updates = (await call('getUpdates', { offset, timeout: wait })) as Array<
        TgUpdate & { update_id: number }
      >;
      for (const u of updates) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m) continue;
        if ((m.chat.type === 'group' || m.chat.type === 'supergroup') && !groups.has(m.chat.id)) {
          groups.set(m.chat.id, m.chat.title ?? '(untitled group)');
          console.log(`group   ${m.chat.id}  ${m.chat.title ?? '(untitled group)'}`);
        }
        if (m.from && !people.has(m.from.id)) {
          const name = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ');
          const label = `${name}${m.from.username ? ` (@${m.from.username})` : ''}`;
          people.set(m.from.id, label);
          console.log(`person  ${m.from.id}  ${label}`);
        }
      }
    }
    console.log(`\nFound ${groups.size} group(s), ${people.size} person(s).`);
    console.log('Group id -> TELEGRAM_GROUP_CHAT_ID. Person ids -> TELEGRAM_RECIPIENTS, e.g.');
    console.log('  TELEGRAM_RECIPIENTS={"m_<member>":"<person id>", ...}');
  } finally {
    await call('setWebhook', {
      url: `${publicUrl}/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    });
    console.log(`\nWebhook re-registered at ${publicUrl}/telegram/webhook`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
