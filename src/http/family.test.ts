import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { CareStore } from '../store/store.ts';
import { createFamilyRoutes } from './family.ts';
import { calendarToken, memberFromCalendarToken, telegramUserFromInitData } from '../domain/family-access.ts';
import { calendarView } from '../domain/calendar-view.ts';
import { dueReminders } from '../domain/reminders.ts';

const BOT = '123:bot-token';
const SECRET = 'test-only-not-a-secret';
const NOW = new Date('2026-09-24T09:00:00Z'); // 10 AM, Thursday, Lagos

/** initData as Telegram signs it. */
function signedInitData(userId: number, authDate: number, token = BOT): string {
  const p = new URLSearchParams({ auth_date: String(authDate), query_id: 'q', user: JSON.stringify({ id: userId, first_name: 'Sam' }) });
  const check = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
}

async function family() {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'Dad care circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_sandra', householdId: 'h', name: 'Sandra', role: 'caregiver' });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad', since: '2026-09-20T00:00:00Z' });
  await store.linkTelegram({ telegramId: '555', memberId: 'm_sam', householdId: 'h', linkedAt: NOW.toISOString() });
  return store;
}

async function serve(store: CareStore) {
  const app = express();
  app.use(express.json());
  app.use(createFamilyRoutes({ store, botToken: BOT, secret: SECRET, demoHouseholdId: 'h', now: () => NOW }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, close: () => server.close() };
}

test('Telegram Mini App data is believed only when Telegram signed it, and only while fresh', () => {
  const now = NOW.getTime() / 1000;
  assert.deepEqual(telegramUserFromInitData(signedInitData(555, now), BOT, NOW), { id: '555', firstName: 'Sam' });
  assert.equal(telegramUserFromInitData(signedInitData(555, now, 'another-bot'), BOT, NOW), null, 'signed by another bot');
  assert.equal(telegramUserFromInitData(signedInitData(555, now).replace('555', '556'), BOT, NOW), null, 'tampered user');
  assert.equal(telegramUserFromInitData(signedInitData(555, now - 3 * 86400), BOT, NOW), null, 'stale');
});

test('a browser link is signed for one person and expires', () => {
  const t = calendarToken(SECRET, 'm_sam', new Date(NOW.getTime() + 3600_000));
  assert.equal(memberFromCalendarToken(SECRET, t, NOW), 'm_sam');
  assert.equal(memberFromCalendarToken('other', t, NOW), null);
  assert.equal(memberFromCalendarToken(SECRET, t, new Date(NOW.getTime() + 7200_000)), null, 'expired');
  const [body, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ m: 'm_dad', e: 9999999999 })).toString('base64url');
  assert.equal(memberFromCalendarToken(SECRET, `${forged}.${sig}`, NOW), null);
  assert.ok(body);
});

test('the calendar opens for a family member from Telegram, and acts as them', async () => {
  const store = await family();
  const { base, close } = await serve(store);
  try {
    const h = { 'x-telegram-init-data': signedInitData(555, NOW.getTime() / 1000), 'content-type': 'application/json' };
    const view = await (await fetch(`${base}/family/api/view?days=7`, { headers: h })).json() as { me: { name: string }; view: { days: { items: { title: string; status: string }[] }[] } };
    assert.equal(view.me.name, 'Sam');
    const today = view.view.days[0]!.items.map((i) => `${i.title}:${i.status}`);
    assert.deepEqual(today, ['eye drops:no-record', 'eye drops:upcoming']);

    const act = await (await fetch(`${base}/family/api/act`, { method: 'POST', headers: h, body: JSON.stringify({ tool: 'record_appointment', args: { kind: 'eye check-up', startsAt: '2026-09-26T10:00:00', forMemberId: 'Dad' } }) })).json() as { text: string; isError: boolean };
    assert.equal(act.isError, false, act.text);
    assert.equal(store.getCareState('h').events.at(-1)!.reportedBy, 'm_sam', 'recorded as the person signed in');

    const refused = await fetch(`${base}/family/api/act`, { method: 'POST', headers: h, body: JSON.stringify({ tool: 'remove_member', args: {} }) });
    assert.equal(refused.status, 400, 'only calendar actions');
  } finally { close(); }
});

test('strangers, unlinked Telegram users and the demo cannot change anything', async () => {
  const store = await family();
  const { base, close } = await serve(store);
  try {
    assert.equal((await fetch(`${base}/family/api/view`)).status, 401);
    const unlinked = await fetch(`${base}/family/api/view`, { headers: { 'x-telegram-init-data': signedInitData(999, NOW.getTime() / 1000) } });
    assert.equal(unlinked.status, 403);
    assert.equal((await fetch(`${base}/family/api/view?demo=1`)).status, 200);
    const demoWrite = await fetch(`${base}/family/api/act?demo=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'claim_obligation', args: { obligationId: 'x' } }) });
    assert.equal(demoWrite.status, 403);
    const page = await fetch(`${base}/family`);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  } finally { close(); }
});

test('the calendar shows nothing from before a medicine was on the schedule', async () => {
  const store = await family();
  const v = calendarView(store.getCareState('h'), NOW, 7, '2026-09-18');
  assert.equal(v.days[0]!.items.length, 0, 'the 18th is before it was added');
  assert.equal(v.days[2]!.items.filter((i) => i.kind === 'dose').length, 2, 'the 20th has both doses');
});

test('reminders: the dose at its time, privately, with buttons; never twice; off when asked', async () => {
  const store = await family();
  const at8 = new Date('2026-09-24T07:05:00Z'); // 8:05 AM Lagos
  const due = dueReminders(store.getCareState('h'), at8);
  assert.equal(due.length, 1);
  assert.equal(due[0]!.to, 'm_dad');
  assert.equal(due[0]!.text, "It's 8 AM: time for your eye drops.");
  assert.deepEqual(due[0]!.buttons![0]!.map((b) => b.data), ['dose:med:08:00', 'snooze:med:08:00']);

  await store.appendEvent({ householdId: 'h', kind: 'reminder_sent', reportedBy: 'system:carecircle', occurredAt: at8.toISOString(), source: 'system', confidence: 'confirmed', data: { key: due[0]!.key, to: 'm_dad' } });
  assert.equal(dueReminders(store.getCareState('h'), at8).length, 0, 'sent once');

  await store.setMemberPreference('m_dad', 'h', { reminders: 'off' });
  assert.equal(dueReminders(store.getCareState('h'), new Date('2026-09-24T19:05:00Z')).length, 0, 'off');
});

test('reminders: the evening before an appointment, to the person, the driver, and the coordinator if nobody has it', async () => {
  const store = await family();
  const appt = await store.appendEvent({ householdId: 'h', kind: 'appointment_scheduled', reportedBy: 'm_sam', occurredAt: '2026-09-25T09:00:00.000Z', source: 'voice', confidence: 'reported', data: { appointmentKind: 'eye check-up', forMemberId: 'm_dad' } });
  const ride = await store.createObligation({ householdId: 'h', what: 'Drive Dad to the eye clinic', status: 'OPEN', consequence: 'medical', provenance: { kind: 'CONFIRMED', byMemberId: 'm_sam', at: NOW.toISOString() }, ownerId: null, sourceEventId: appt.id, dueAt: '2026-09-25T08:15:00.000Z' });
  const evening = new Date('2026-09-24T18:30:00Z'); // 7:30 PM Lagos
  let due = dueReminders(store.getCareState('h'), evening).filter((r) => r.key.startsWith('appt'));
  assert.deepEqual(due.map((r) => r.to).sort(), ['m_dad', 'm_sam']);
  assert.match(due.find((r) => r.to === 'm_sam')!.text, /nobody has taken this on yet: Drive Dad to the eye clinic/);

  await store.transition(ride.id, 'h', 'ASSIGNED', 'm_sam', { ownerId: 'm_sandra' });
  due = dueReminders(store.getCareState('h'), evening).filter((r) => r.key.startsWith('appt'));
  assert.deepEqual(due.map((r) => r.to).sort(), ['m_dad', 'm_sandra']);
  assert.equal(due.find((r) => r.to === 'm_dad')!.text, 'Reminder: tomorrow at 10 AM, your eye check-up. Sandra is taking care of the ride.');
});
