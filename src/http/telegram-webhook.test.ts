import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createTelegramWebhook, SECRET_TOKEN_HEADER } from './telegram-webhook.ts';

const HH = 'h1';
const SECRET = 'tg-secret';
const NOW = new Date('2026-10-14T14:00:00Z');
const store = new CareStore();

async function seed(): Promise<void> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({ id: 'm_mum', householdId: HH, name: 'Grace', role: 'care_recipient' });
  await store.addMember({
    id: 'm_renee',
    householdId: HH,
    name: 'Renee',
    role: 'family_caregiver',
  });
  const o = await store.createObligation({
    householdId: HH,
    what: 'Drive Grace to cardiology',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_mum', at: NOW.toISOString() },
    ownerId: null,
  });
  await store.transition(
    o.id,
    HH,
    'REQUESTED',
    'system:carecircle',
    {
      ownerId: null,
      request: { askedOfId: 'm_renee', askedById: 'system:carecircle', askedAt: NOW.toISOString() },
    },
    'asked',
  );
}
beforeEach(seed);

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const update = (
  chatId: number | string,
  text: string,
  updateId = 1,
  fromId?: number | string,
): unknown => ({
  update_id: updateId,
  message: {
    message_id: 10,
    chat: { id: chatId },
    text,
    ...(fromId !== undefined ? { from: { id: fromId } } : {}),
  },
});

function captureFetch(calls: Array<{ url: string; body: unknown }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
      text: async () => '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function postReq(body: unknown, token: string | undefined): Request {
  return {
    body,
    header: (n: string) => (n.toLowerCase() === SECRET_TOKEN_HEADER ? token : undefined),
  } as unknown as Request;
}

const handler = () =>
  createTelegramWebhook({
    store,
    secretToken: SECRET,
    memberByChat: new Map([['987654', 'm_renee']]),
    householdId: HH,
    now: () => NOW,
  });

test('an update with the wrong secret token is rejected before it touches the record', async () => {
  const res = mockRes();
  await handler()(postReq(update('987654', 'yes'), 'wrong'), res);
  assert.equal(res.statusCode, 401);
  assert.equal(store.getCareState(HH).obligations[0]!.status, 'REQUESTED'); // untouched
});

test('a valid "yes" from the asked member assigns them the obligation', async () => {
  const res = mockRes();
  await handler()(postReq(update('987654', "Yes, I'll take it"), SECRET), res);
  assert.equal(res.statusCode, 200);
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'ASSIGNED');
  assert.equal(o.ownerId, 'm_renee');
});

test('a reply from an unknown chat is acknowledged but acts on nothing', async () => {
  const res = mockRes();
  await handler()(postReq(update('111', 'yes'), SECRET), res);
  assert.equal(res.statusCode, 200);
  assert.equal(
    (res.body as { results: Array<{ status: string }> }).results[0]!.status,
    'unknown-sender',
  );
  assert.equal(store.getCareState(HH).obligations[0]!.status, 'REQUESTED');
});

test('a new face in the group is noted for the operator by id and first name, never what they said', async () => {
  const lines: string[] = [];
  const h = createTelegramWebhook({
    store,
    secretToken: SECRET,
    memberByChat: new Map([['987654', 'm_renee']]),
    householdId: HH,
    now: () => NOW,
    log: (l) => lines.push(l),
  });
  const res = mockRes();
  await h(
    postReq(
      {
        update_id: 7,
        message: {
          message_id: 3,
          chat: { id: -500, type: 'group' },
          from: { id: 4242, first_name: 'Ada' },
          text: 'hello everyone, my PIN is 1234',
        },
      },
      SECRET,
    ),
    res,
  );
  assert.deepEqual(lines, ['telegram: unmapped sender 4242 (Ada) in group -500']);
});

test('the bot answers in the chat the reply came from', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const h = createTelegramWebhook({
    store,
    secretToken: SECRET,
    botToken: 'bot:tok',
    fetchImpl: captureFetch(calls),
    memberByChat: new Map([['987654', 'm_renee']]),
    householdId: HH,
    now: () => NOW,
  });
  await h(postReq(update('987654', "Yes, I'll take it"), SECRET), mockRes());
  assert.equal(calls.length, 1, 'the bot posts one acknowledgement');
  assert.equal((calls[0]!.body as { chat_id: string }).chat_id, '987654');
  assert.match((calls[0]!.body as { text: string }).text, /yours now/);
});

test('a group reply is attributed to the sender, not the group chat', async () => {
  const res = mockRes();
  // chat is the group (-100…), the person answering is 987654 (Renee)
  await handler()(postReq(update('-100200300', 'yes', 1, 987654), SECRET), res);
  assert.equal(res.statusCode, 200);
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'ASSIGNED');
  assert.equal(o.ownerId, 'm_renee');
});

test('a redelivered update id is not acted on twice', async () => {
  const h = handler(); // one handler keeps one SeenEvents across calls
  await h(postReq(update('987654', 'no', 7), SECRET), mockRes());
  const afterFirst = store.getCareState(HH).events.length;
  const res2 = mockRes();
  await h(postReq(update('987654', 'no', 7), SECRET), res2);
  assert.equal(
    (res2.body as { results: Array<{ status: string }> }).results[0]!.status,
    'duplicate',
  );
  assert.equal(
    store.getCareState(HH).events.length,
    afterFirst,
    'no second event for a redelivery',
  );
});

// --- Talking to CareCircle, not only answering it ----------------------------

const dm = (text: string, updateId: number): unknown => ({
  update_id: updateId,
  message: { message_id: 20, chat: { id: 987654, type: 'private' }, from: { id: 987654 }, text },
});
const group = (text: string, updateId: number, replyToBot = false): unknown => ({
  update_id: updateId,
  message: {
    message_id: 30,
    chat: { id: -100200300, type: 'supergroup' },
    from: { id: 987654 },
    text,
    ...(replyToBot ? { reply_to_message: { from: { is_bot: true } } } : {}),
  },
});
function chatHandler(said: Array<{ memberId: string; text: string }>) {
  return createTelegramWebhook({
    store,
    secretToken: SECRET,
    botToken: 'bot-token',
    memberByChat: new Map([['987654', 'm_renee']]),
    householdId: HH,
    now: () => NOW,
    fetchImpl: captureFetch([]),
    chat: async (memberId, text) => {
      said.push({ memberId, text });
      return 'Got it.';
    },
  });
}

test('in a private chat, anything that is not an answer goes to CareCircle as that member', async () => {
  const said: Array<{ memberId: string; text: string }> = [];
  const res = mockRes();
  await chatHandler(said)(postReq(dm('I picked up the eye drops', 101), SECRET), res);
  assert.deepEqual(said, [{ memberId: 'm_renee', text: 'I picked up the eye drops' }]);
  assert.equal((res.body as { results: { status: string }[] }).results[0]!.status, 'chat');
});

test('family chatter in the group is left alone', async () => {
  const said: Array<{ memberId: string; text: string }> = [];
  await chatHandler(said)(postReq(group('who is cooking tonight?', 102), SECRET), mockRes());
  assert.deepEqual(said, []);
});

test('in the group, a message that mentions or replies to the bot is for CareCircle', async () => {
  const said: Array<{ memberId: string; text: string }> = [];
  await chatHandler(said)(
    postReq(group("@carecircle0111_bot how was Grace's day?", 103), SECRET),
    mockRes(),
  );
  await chatHandler(said)(postReq(group('what else is open?', 104, true), SECRET), mockRes());
  assert.deepEqual(
    said.map((s) => s.text),
    ["how was Grace's day?", 'what else is open?'],
  );
});

test('a yes that answers an ask is only that, and a yes that answers nothing is talk', async () => {
  const said: Array<{ memberId: string; text: string }> = [];
  const h = chatHandler(said);
  await h(postReq(dm('yes', 105), SECRET), mockRes());
  assert.equal(store.getCareState(HH).obligations[0]!.ownerId, 'm_renee');
  assert.deepEqual(said, []);
  await h(postReq(dm('yes, and I dropped the prescription off too', 106), SECRET), mockRes());
  assert.equal(said.length, 1);
});
