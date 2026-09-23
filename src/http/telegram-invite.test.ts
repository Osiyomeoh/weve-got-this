import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createTelegramWebhook, SECRET_TOKEN_HEADER } from './telegram-webhook.ts';
import { inviteFor, memberFromInvite, startPayload, welcome } from '../domain/telegram-invite.ts';
import { staticTokens } from './identity.ts';

/**
 * Joining the circle by tapping a personal link. The family's own names come from
 * /setup; these are test names.
 */

const SECRET = 'tg-secret';
const HH = 'h_fam';
const GROUP = '-500';
let store: CareStore;

beforeEach(async () => {
  store = new CareStore();
  await store.addHousehold({ id: HH, name: "Dad's care circle", timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: HH, name: 'Walter', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_ann', householdId: HH, name: 'Ann', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_ben', householdId: HH, name: 'Ben', role: 'caregiver', livesAway: 'London', dailyUpdate: true });
});

function harness() {
  const sent: Array<{ chat_id: string; text: string }> = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  const lines: string[] = [];
  const h = createTelegramWebhook({
    store, secretToken: SECRET, botToken: 'bot', memberByChat: new Map(), householdId: HH,
    now: () => new Date('2026-09-24T10:00:00Z'), fetchImpl, botUsername: 'carecircle_test_bot',
    groupChatId: GROUP, log: (l) => lines.push(l),
  });
  let update = 1;
  const post = async (from: number, text: string, chat: { id: number; type: string } = { id: from, type: 'private' }, name = 'Someone') => {
    const res = {
      statusCode: 0, body: undefined as unknown,
      status(c: number) { this.statusCode = c; return this; },
      json(p: unknown) { this.body = p; return this; },
    };
    const req = {
      body: { update_id: update++, message: { message_id: 1, chat, from: { id: from, first_name: name }, text } },
      header: (n: string) => (n.toLowerCase() === SECRET_TOKEN_HEADER ? SECRET : undefined),
    } as unknown as Request;
    await h(req, res as unknown as Response);
    return (res.body as { results: Array<{ status: string }> }).results[0]!.status;
  };
  return { sent, lines, post };
}

test('tapping your link connects you, tells you your part, and tells the family group', async () => {
  const { sent, post } = harness();
  assert.equal(await post(111, `/start ${inviteFor(SECRET, 'm_dad')}`), 'linked');
  assert.equal(store.telegramLinkFor('111')?.memberId, 'm_dad');

  const hello = sent.find((m) => m.chat_id === '111')!.text;
  assert.match(hello, /^Hi Walter, you're now connected to Dad's care circle as the person this circle is for\./);
  assert.match(hello, /never that you missed it/);
  assert.deepEqual(sent.find((m) => m.chat_id === GROUP), { chat_id: GROUP, text: "Walter has joined Dad's care circle on Telegram." });
});

test('once connected, what you say is yours: a "yes" in the group answers your own ask', async () => {
  const { post } = harness();
  await post(222, `/start ${inviteFor(SECRET, 'm_ann')}`);
  const o = await store.createObligation({
    householdId: HH, what: 'Pick up the eye drops', status: 'OPEN', consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_dad', at: '2026-09-24T09:00:00Z' }, ownerId: null,
  });
  await store.transition(o.id, HH, 'REQUESTED', 'system:carecircle',
    { ownerId: null, request: { askedOfId: 'm_ann', askedById: 'system:carecircle', askedAt: '2026-09-24T09:30:00Z' } }, 'asked');
  assert.equal(await post(222, 'yes', { id: Number(GROUP), type: 'group' }), 'accepted');
  assert.equal(store.getCareState(HH).obligations[0]!.ownerId, 'm_ann');
});

test('family abroad hear that they get the evening update and are not asked for rides', async () => {
  const { sent, post } = harness();
  await post(333, `/start ${inviteFor(SECRET, 'm_ben')}`);
  const hello = sent.find((m) => m.chat_id === '333')!.text;
  assert.match(hello, /You live in London, so I won't ask you on my own for things that need someone there\. You'll get a short update on Dad's day every evening\./);
});

test('attack: a forwarded link can\'t take someone\'s place in the circle', async () => {
  const { sent, post } = harness();
  const dads = inviteFor(SECRET, 'm_dad');
  await post(111, `/start ${dads}`);
  assert.equal(await post(999, `/start ${dads}`), 'invite-already-used');
  assert.equal(store.telegramLinkFor('999'), undefined);
  assert.equal(store.telegramLinkOf('m_dad')?.telegramId, '111');
  assert.match(sent.at(-1)!.text, /Walter is already connected from another Telegram account/);
});

test('attack: an invite can\'t be made up, and one account can\'t be two people', async () => {
  const { post } = harness();
  assert.equal(await post(444, '/start 0000000000000000m_dad'), 'invite-invalid');
  assert.equal(await post(444, `/start ${inviteFor('another-secret', 'm_dad')}`), 'invite-invalid');
  await post(444, `/start ${inviteFor(SECRET, 'm_ann')}`);
  assert.equal(await post(444, `/start ${inviteFor(SECRET, 'm_ben')}`), 'invite-for-someone-else');
  assert.equal(store.telegramLinkOf('m_ben'), undefined);
});

test('attack: an invite pasted in a group is not acted on', async () => {
  const { post } = harness();
  assert.equal(await post(555, `/start ${inviteFor(SECRET, 'm_dad')}`, { id: Number(GROUP), type: 'group' }), 'start-in-group');
  assert.equal(store.telegramLinkFor('555'), undefined);
});

test('attack: a linked Telegram id is never a login token', async () => {
  const { post } = harness();
  await post(111, `/start ${inviteFor(SECRET, 'm_dad')}`);
  const resolver = staticTokens(new Map(), (subject) => store.resolveIdentity(subject)?.memberId ?? null, false);
  for (const token of ['111', 'telegram:111']) {
    const req = { header: (n: string) => (n.toLowerCase() === 'authorization' ? `Bearer ${token}` : undefined), headers: { authorization: `Bearer ${token}` } } as unknown as Request;
    assert.equal(resolver.resolve(req), null);
  }
});

test('a new face in the family group is pointed to their link once; strangers elsewhere hear nothing', async () => {
  const { sent, post, lines } = harness();
  await post(666, 'hello all', { id: Number(GROUP), type: 'group' }, 'Chidi');
  await post(666, 'hello again', { id: Number(GROUP), type: 'group' }, 'Chidi');
  await post(777, 'hi', { id: -900, type: 'group' }, 'Stranger');
  const nudges = sent.filter((m) => /Tap the personal link/.test(m.text));
  assert.deepEqual(nudges, [{ chat_id: GROUP, text: "Hi Chidi, I don't know who you are in this circle yet. Tap the personal link your family sent you, and I will." }]);
  assert.equal(lines.length, 3, 'every unknown sender is still noted for the operator');
});

test('/start without an invite explains what to do; with one you already used, you get your welcome again', async () => {
  const { sent, post } = harness();
  assert.equal(await post(888, '/start'), 'start-without-invite');
  assert.match(sent.at(-1)!.text, /tap the personal link they sent you/);
  await post(888, `/start ${inviteFor(SECRET, 'm_ann')}`);
  assert.equal(await post(888, '/start'), 'welcome-again');
  assert.match(sent.at(-1)!.text, /^Hi Ann, you're now connected .* as the coordinator\./);
});

test('removing a member, or the household, removes their Telegram link', async () => {
  const { post } = harness();
  await post(333, `/start ${inviteFor(SECRET, 'm_ben')}`);
  await store.removeMember(HH, 'm_ben');
  assert.equal(store.telegramLinkFor('333'), undefined);
  await post(111, `/start ${inviteFor(SECRET, 'm_dad')}`);
  await store.removeHousehold(HH);
  assert.equal(store.telegramLinkFor('111'), undefined);
});

test('invite helpers', () => {
  const inv = inviteFor(SECRET, 'm_0c9a5f7e-3a51-4c43-9d7e-2b1f4b6f0e11');
  assert.ok(inv.length <= 64 && /^[A-Za-z0-9_-]+$/.test(inv), 'fits a Telegram start payload');
  assert.equal(memberFromInvite(SECRET, inv), 'm_0c9a5f7e-3a51-4c43-9d7e-2b1f4b6f0e11');
  assert.equal(memberFromInvite('', inv), null);
  assert.equal(startPayload('/start abc'), 'abc');
  assert.equal(startPayload('/start'), '');
  assert.equal(startPayload('start me up'), null);
  assert.match(welcome(store.getMember('m_ann'), store.getCareState(HH), 'b'), /Ask whoever's free to take Dad to the check-up/);
});

test('someone the demo map already names can still join their real family by invite', async () => {
  const sent: Array<{ chat_id: string; text: string }> = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  await store.addHousehold({ id: 'h_demo', name: 'Demo', timezone: 'UTC' });
  await store.addMember({ id: 'm_demo', householdId: 'h_demo', name: 'Demo person', role: 'caregiver' });
  const h = createTelegramWebhook({
    store, secretToken: SECRET, botToken: 'bot', memberByChat: new Map([['222', 'm_demo']]), householdId: 'h_demo', fetchImpl,
  });
  const res = { status() { return this; }, json() { return this; } } as unknown as Response;
  const req = (text: string) => ({
    body: { update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, chat: { id: 222, type: 'private' }, from: { id: 222 }, text } },
    header: (n: string) => (n.toLowerCase() === SECRET_TOKEN_HEADER ? SECRET : undefined),
  }) as unknown as Request;
  await h(req(`/start ${inviteFor(SECRET, 'm_ann')}`), res);
  assert.equal(store.telegramLinkFor('222')?.memberId, 'm_ann');
  await h(req('/start'), res);
  assert.match(sent.at(-1)!.text, /^Hi Ann/);
});
