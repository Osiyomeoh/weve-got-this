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
  await store.addMember({ id: 'm_renee', householdId: HH, name: 'Renee', role: 'family_caregiver' });
  const o = await store.createObligation({
    householdId: HH, what: 'Drive Grace to cardiology', status: 'OPEN', consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_mum', at: NOW.toISOString() }, ownerId: null,
  });
  await store.transition(o.id, HH, 'REQUESTED', 'system:carecircle',
    { ownerId: null, request: { askedOfId: 'm_renee', askedById: 'system:carecircle', askedAt: NOW.toISOString() } }, 'asked');
}
beforeEach(seed);

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const update = (chatId: number | string, text: string, updateId = 1, fromId?: number | string): unknown => ({
  update_id: updateId,
  message: { message_id: 10, chat: { id: chatId }, text, ...(fromId !== undefined ? { from: { id: fromId } } : {}) },
});

function captureFetch(calls: Array<{ url: string; body: unknown }>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
}

function postReq(body: unknown, token: string | undefined): Request {
  return { body, header: (n: string) => (n.toLowerCase() === SECRET_TOKEN_HEADER ? token : undefined) } as unknown as Request;
}

const handler = () => createTelegramWebhook({
  store, secretToken: SECRET,
  memberByChat: new Map([['987654', 'm_renee']]), householdId: HH, now: () => NOW,
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
  assert.equal((res.body as { results: Array<{ status: string }> }).results[0]!.status, 'unknown-sender');
  assert.equal(store.getCareState(HH).obligations[0]!.status, 'REQUESTED');
});

test('the bot answers in the chat the reply came from', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const h = createTelegramWebhook({
    store, secretToken: SECRET, botToken: 'bot:tok', fetchImpl: captureFetch(calls),
    memberByChat: new Map([['987654', 'm_renee']]), householdId: HH, now: () => NOW,
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
  assert.equal((res2.body as { results: Array<{ status: string }> }).results[0]!.status, 'duplicate');
  assert.equal(store.getCareState(HH).events.length, afterFirst, 'no second event for a redelivery');
});
