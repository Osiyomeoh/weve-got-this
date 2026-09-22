import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createWhatsAppWebhook, createWhatsAppVerify } from './whatsapp-webhook.ts';

const HH = 'h1';
const SECRET = 'app-secret';
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

function mockRes(): Response & { statusCode: number; body: unknown; text: string } {
  const res = {
    statusCode: 0, body: undefined as unknown, text: '',
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    send(payload: string) { this.text = payload; return this; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown; text: string };
}

const sign = (raw: Buffer): string => 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');

const inboundPayload = (from: string, body: string, id = 'wamid.1'): Buffer =>
  Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [{ from, id, type: 'text', text: { body } }] } }] }],
  }));

function postReq(raw: Buffer, sig: string | undefined): Request {
  return { body: raw, header: (n: string) => (n.toLowerCase() === 'x-hub-signature-256' ? sig : undefined) } as unknown as Request;
}

const handler = () => createWhatsAppWebhook({
  store, appSecret: SECRET, verifyToken: 'vt',
  memberByPhone: new Map([['+2348012345678', 'm_renee']]), householdId: HH, now: () => NOW,
});

test('GET verification echoes the challenge only for the right token', () => {
  const verify = createWhatsAppVerify({ verifyToken: 'vt' });
  const ok = mockRes();
  verify({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt', 'hub.challenge': '12345' } } as unknown as Request, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.text, '12345');

  const bad = mockRes();
  verify({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' } } as unknown as Request, bad);
  assert.equal(bad.statusCode, 403);
});

test('an unsigned body is rejected before it can touch the record', async () => {
  const raw = inboundPayload('+2348012345678', 'Yes I can');
  const res = mockRes();
  await handler()(postReq(raw, undefined), res);
  assert.equal(res.statusCode, 401);
  assert.equal(store.getCareState(HH).obligations[0]!.status, 'REQUESTED'); // untouched
});

test('a signed "yes" from the asked member assigns them the obligation', async () => {
  const raw = inboundPayload('+2348012345678', "Yes, I'll take it");
  const res = mockRes();
  await handler()(postReq(raw, sign(raw)), res);
  assert.equal(res.statusCode, 200);
  const o = store.getCareState(HH).obligations[0]!;
  assert.equal(o.status, 'ASSIGNED');
  assert.equal(o.ownerId, 'm_renee');
});

test('a signed reply from an unknown number is acknowledged but acts on nothing', async () => {
  const raw = inboundPayload('+19999999999', 'yes');
  const res = mockRes();
  await handler()(postReq(raw, sign(raw)), res);
  assert.equal(res.statusCode, 200);
  assert.equal((res.body as { results: Array<{ status: string }> }).results[0]!.status, 'unknown-sender');
  assert.equal(store.getCareState(HH).obligations[0]!.status, 'REQUESTED');
});

test('a redelivered message id is not acted on twice', async () => {
  const h = handler(); // one handler keeps one SeenEvents across calls
  const raw = inboundPayload('+2348012345678', 'no', 'wamid.dup');
  await h(postReq(raw, sign(raw)), mockRes());
  const afterFirst = store.getCareState(HH).events.length;
  const res2 = mockRes();
  await h(postReq(raw, sign(raw)), res2);
  assert.equal((res2.body as { results: Array<{ status: string }> }).results[0]!.status, 'duplicate');
  assert.equal(store.getCareState(HH).events.length, afterFirst, 'no second event for a redelivery');
});
