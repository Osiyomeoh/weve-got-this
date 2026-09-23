import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { CareStore } from '../store/store.ts';
import { createTelegramWebhook, SECRET_TOKEN_HEADER } from './telegram-webhook.ts';

/** Tapping a reminder's button, and the plain commands. */

const SECRET = 's';
async function setup() {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_musa', householdId: 'h', name: 'Musa', role: 'helper' });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00'], forMemberId: 'm_dad' });
  await store.linkTelegram({ telegramId: '10', memberId: 'm_dad', householdId: 'h', linkedAt: '2026-09-24T00:00:00Z' });
  await store.linkTelegram({ telegramId: '20', memberId: 'm_musa', householdId: 'h', linkedAt: '2026-09-24T00:00:00Z' });
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ method: String(url).split('/').pop()!, body: JSON.parse(String(init?.body)) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: {} }), text: async () => '' } as unknown as Response;
  }) as unknown as typeof fetch;
  const h = createTelegramWebhook({
    store, secretToken: SECRET, botToken: 'b', memberByChat: new Map(), householdId: 'h', fetchImpl,
    now: () => new Date('2026-09-24T07:06:00Z'), calendarUrl: 'https://example.test/family',
  });
  let n = 1;
  const send = async (body: Record<string, unknown>) => {
    const res = { status() { return this; }, json(b: unknown) { (this as { body?: unknown }).body = b; return this; } } as unknown as Response & { body: { results: Array<{ status: string }> } };
    await h({ body: { update_id: n++, ...body }, header: (k: string) => (k.toLowerCase() === SECRET_TOKEN_HEADER ? SECRET : undefined) } as unknown as Request, res);
    return res.body.results[0]!.status;
  };
  const tap = (from: number, data: string) => send({ callback_query: { id: 'cb', data, from: { id: from }, message: { message_id: 5, chat: { id: from } } } });
  const say = (from: number, text: string) => send({ message: { message_id: 1, chat: { id: from, type: 'private' }, from: { id: from }, text } });
  return { store, calls, tap, say };
}

test('tapping "Taken" records the dose as the person who tapped, once', async () => {
  const t = await setup();
  assert.equal(await t.tap(10, 'dose:med:08:00'), 'tap-taken');
  const e = t.store.getCareState('h').events.at(-1)!;
  assert.deepEqual([e.kind, e.reportedBy, e.source, e.data['medicationId']], ['medication_taken', 'm_dad', 'telegram', 'med']);
  assert.equal(t.calls.find((c) => c.method === 'editMessageText')!.body['text'], '✅ Recorded: eye drops at 8:06 AM.');

  assert.equal(await t.tap(10, 'dose:med:08:00'), 'tap-already');
  assert.equal(t.store.getCareState('h').events.filter((x) => x.kind === 'medication_taken').length, 1, 'no second dose');
});

test('a helper may record a dose for Dad by tapping; a stale or unknown tap changes nothing', async () => {
  const t = await setup();
  assert.equal(await t.tap(20, 'dose:med:08:00'), 'tap-taken');
  assert.equal(await t.tap(10, 'dose:gone:08:00'), 'tap-stale');
  assert.equal(await t.tap(99, 'dose:med:08:00'), 'unknown-sender');
});

test('/reminders off and on, and /calendar gives the Mini App and a personal browser link', async () => {
  const t = await setup();
  assert.equal(await t.say(10, '/reminders off'), 'reminders-off');
  assert.equal(t.store.getMember('m_dad').reminders, 'off');
  assert.equal(await t.say(10, '/reminders on'), 'reminders-on');
  assert.equal(t.store.getMember('m_dad').reminders, undefined);

  assert.equal(await t.say(10, '/calendar'), 'calendar');
  const msg = t.calls.filter((c) => c.method === 'sendMessage').at(-1)!.body as { reply_markup: { inline_keyboard: Array<Array<{ web_app?: { url: string }; url?: string }>> } };
  assert.equal(msg.reply_markup.inline_keyboard[0]![0]!.web_app!.url, 'https://example.test/family');
  assert.match(msg.reply_markup.inline_keyboard[1]![0]!.url!, /^https:\/\/example\.test\/family#t=[\w-]+\.[\w-]+$/, 'the token rides in the fragment, never to a server log');
});
