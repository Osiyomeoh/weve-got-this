/**
 * Point the Telegram bot at the server, after a deploy:
 *
 *   npm run telegram:webhook
 *
 *  - the webhook, for messages and button taps (a reminder's "Taken", a /language choice);
 *  - the chat's menu button, which opens the family calendar as a Mini App;
 *  - the command list Telegram shows when someone types "/".
 *
 * Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and CARECIRCLE_PUBLIC_URL from .env.
 * Prints what it set and what Telegram reports back; never the token or the secret.
 */
const token = process.env['TELEGRAM_BOT_TOKEN']?.trim();
const secret = process.env['TELEGRAM_WEBHOOK_SECRET']?.trim();
const publicUrl = (
  process.env['CARECIRCLE_PUBLIC_URL'] ?? 'https://ypq2dfq2p7.us-east-1.awsapprunner.com'
)
  .trim()
  .replace(/\/+$/, '');

async function call(method: string, body?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set (put it in .env).');
if (!secret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set (put it in .env).');

await call('setWebhook', {
  url: `${publicUrl}/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
});
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Calendar', web_app: { url: `${publicUrl}/family` } },
});
await call('setMyCommands', {
  commands: [
    {
      command: 'calendar',
      description: 'The family calendar: who has what, and what nobody has yet',
    },
    { command: 'language', description: 'Choose the language I write to you in' },
    { command: 'reminders', description: '/reminders off or /reminders on' },
  ],
});

const info = (await call('getWebhookInfo')) as {
  url: string;
  allowed_updates?: string[];
  pending_update_count: number;
  last_error_message?: string;
};
console.log(`webhook          ${info.url}`);
console.log(`allowed updates  ${(info.allowed_updates ?? ['(all)']).join(', ')}`);
console.log(`pending updates  ${info.pending_update_count}`);
if (info.last_error_message) console.log(`last error       ${info.last_error_message}`);
console.log(`menu button      Calendar -> ${publicUrl}/family`);
console.log('commands         /calendar /language /reminders');
