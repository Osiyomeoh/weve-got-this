import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppNotifier, whatsAppConfigFromEnv } from './whatsapp.ts';

function stubFetch(
  calls: Array<{ url: string; body: unknown }>,
  res: Partial<Response> & { json?: () => Promise<unknown> },
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: res.json ?? (async () => ({ messages: [{ id: 'wamid.sent' }] })),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test('delivers to the mapped phone and reports the message id', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const n = new WhatsAppNotifier({
    token: 't',
    phoneNumberId: '123',
    recipients: new Map([['m_renee', '+2348012345678']]),
    fetchImpl: stubFetch(calls, {}),
  });
  const r = await n.deliver({
    to: 'm_renee',
    toName: 'Renee',
    from: "We've Got This",
    message: 'Can you drive Thursday?',
  });
  assert.equal(r.delivered, true);
  assert.equal(r.channel, 'whatsapp');
  assert.equal(r.detail, 'wamid.sent');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /graph\.facebook\.com\/.*\/123\/messages/);
  assert.equal((calls[0]!.body as { to: string }).to, '+2348012345678');
});

test('a member with no number is not messaged, and says so honestly', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const n = new WhatsAppNotifier({
    token: 't',
    phoneNumberId: '123',
    recipients: new Map(),
    fetchImpl: stubFetch(calls, {}),
  });
  const r = await n.deliver({
    to: 'm_unknown',
    toName: 'X',
    from: "We've Got This",
    message: 'hi',
  });
  assert.equal(r.delivered, false);
  assert.equal(calls.length, 0, 'must not call the API for an unmapped member');
});

test('a send failure is reported, never thrown - the ask is already recorded', async () => {
  const n = new WhatsAppNotifier({
    token: 't',
    phoneNumberId: '123',
    recipients: new Map([['m_renee', '+234']]),
    fetchImpl: stubFetch([], { ok: false, status: 401 }),
  });
  const r = await n.deliver({
    to: 'm_renee',
    toName: 'Renee',
    from: "We've Got This",
    message: 'hi',
  });
  assert.equal(r.delivered, false);
  assert.match(r.detail ?? '', /401/);
});

test('config needs token, phone-number id and a valid recipients map', () => {
  assert.equal(
    whatsAppConfigFromEnv({
      WHATSAPP_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
    } as NodeJS.ProcessEnv),
    null,
  );
  assert.equal(
    whatsAppConfigFromEnv({
      WHATSAPP_TOKEN: 't',
      WHATSAPP_PHONE_NUMBER_ID: '1',
      WHATSAPP_RECIPIENTS: 'not json',
    } as NodeJS.ProcessEnv),
    null,
  );
  const c = whatsAppConfigFromEnv({
    WHATSAPP_TOKEN: 't',
    WHATSAPP_PHONE_NUMBER_ID: '1',
    WHATSAPP_RECIPIENTS: '{"m_renee":"+234"}',
  } as NodeJS.ProcessEnv);
  assert.equal(c!.recipients.get('m_renee'), '+234');
});
