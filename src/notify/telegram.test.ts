import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramNotifier, telegramConfigFromEnv } from './telegram.ts';

function stubFetch(calls: Array<{ url: string; body: unknown }>, res: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: res.json ?? (async () => ({ ok: true, result: { message_id: 42 } })),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test('delivers to the mapped chat and reports the message id', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const n = new TelegramNotifier({
    token: '123:ABC', recipients: new Map([['m_renee', '987654']]), fetchImpl: stubFetch(calls, {}),
  });
  const r = await n.deliver({ to: 'm_renee', toName: 'Renee', from: 'CareCircle', message: 'Can you drive Thursday?' });
  assert.equal(r.delivered, true);
  assert.equal(r.channel, 'telegram');
  assert.equal(r.detail, '42');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /api\.telegram\.org\/bot123:ABC\/sendMessage/);
  assert.equal((calls[0]!.body as { chat_id: string }).chat_id, '987654');
});

test('in group mode the ask posts to the group, naming the person', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const n = new TelegramNotifier({
    token: 't', recipients: new Map([['m_renee', '987654']]), groupChatId: '-100200300',
    fetchImpl: stubFetch(calls, {}),
  });
  const r = await n.deliver({ to: 'm_renee', toName: 'Renee', from: 'David', message: 'can you take this on?' });
  assert.equal(r.delivered, true);
  assert.equal(calls.length, 1);
  assert.equal((calls[0]!.body as { chat_id: string }).chat_id, '-100200300'); // the group, not the DM
  assert.match((calls[0]!.body as { text: string }).text, /^Renee, /);          // named for the group
});

test('a member with no chat is not messaged, and says so honestly', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const n = new TelegramNotifier({ token: 't', recipients: new Map(), fetchImpl: stubFetch(calls, {}) });
  const r = await n.deliver({ to: 'm_unknown', toName: 'X', from: 'CareCircle', message: 'hi' });
  assert.equal(r.delivered, false);
  assert.equal(calls.length, 0, 'must not call the API for an unmapped member');
});

test('a send failure is reported, never thrown - the ask is already recorded', async () => {
  const n = new TelegramNotifier({
    token: 't', recipients: new Map([['m_renee', '1']]), fetchImpl: stubFetch([], { ok: false, status: 403 }),
  });
  const r = await n.deliver({ to: 'm_renee', toName: 'Renee', from: 'CareCircle', message: 'hi' });
  assert.equal(r.delivered, false);
  assert.match(r.detail ?? '', /403/);
});

test('config needs a bot token and a valid recipients map', () => {
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't' } as NodeJS.ProcessEnv), null);
  assert.equal(telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_RECIPIENTS: 'not json' } as NodeJS.ProcessEnv), null);
  const c = telegramConfigFromEnv({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_RECIPIENTS: '{"m_renee":"987"}' } as NodeJS.ProcessEnv);
  assert.equal(c!.recipients.get('m_renee'), '987');
});
