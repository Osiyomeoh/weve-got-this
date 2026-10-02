import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { detectCareGaps } from '../domain/gaps.ts';
import type { Notifier } from '../notify/notifier.ts';

/**
 * When care changes: the doctor stops the drops, the check-up moves, and the day
 * something goes wrong. Driven through the real SDK client with the clock pinned.
 */

let server: Server | undefined;
afterEach(() => server?.close());
const NOW = new Date('2026-09-24T09:00:00Z'); // 10 AM in Lagos, Thursday

async function family(opts: { broadcast?: boolean } = {}) {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'Dad care circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_sandra', householdId: 'h', name: 'Sandra', role: 'caregiver' });
  await store.addMedication({ id: 'med_drops', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad' });
  const sent: Array<{ to: string; message: string }> = [];
  const broadcasts: Array<{ recipients: string[]; message: string }> = [];
  const notifier: Notifier = {
    channel: 'telegram',
    deliver: async (i) => { sent.push({ to: i.to, message: i.message }); return { delivered: true, channel: 'telegram' }; },
    ...(opts.broadcast ? { broadcast: async (i: { recipients: { id: string; name: string }[]; message: string }) => {
      broadcasts.push({ recipients: i.recipients.map((r) => r.name), message: i.message });
      return { reached: i.recipients.map((r) => r.name) };
    } } : {}),
  };
  const app = createCareCircleApp({ store, notifier, now: () => NOW, tokens: new Map([['sam', 'm_sam'], ['dad', 'm_dad'], ['sandra', 'm_sandra']]) });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
  const call = async (token: string, name: string, args: Record<string, unknown>) => {
    const c = new Client({ name: 't', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(base), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    try {
      await c.listTools();
      const out = await c.callTool({ name, arguments: args });
      return { isError: out.isError === true, text: (out.content as { text: string }[]).map((p) => p.text).join(' ') };
    } finally { await c.close(); }
  };
  return { store, call, sent, broadcasts };
}

test('the doctor stops the drops: no more "no record" for them, and the record keeps the change', async () => {
  const { store, call } = await family();
  const r = await call('sandra', 'change_medication', { medicationName: 'eye drops', stopNow: true });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /^Done\. I've stopped Dad's eye drops\. I won't expect it any more/);
  const later = new Date('2026-09-24T21:30:00Z');
  assert.equal(detectCareGaps(store.getCareState('h'), { now: later }).filter((g) => /eye drops/.test(g.spoken)).length, 0);
  assert.equal(store.getCareState('h').events.at(-1)!.kind, 'medication_changed');
  assert.equal(store.getMedications('h').length, 1, 'never deleted');
});

test('new times, and a last day, in the family\'s own time', async () => {
  const { store, call } = await family();
  const r = await call('sam', 'change_medication', { medicationName: 'drops', times: ['09:00', '21:00'], until: '2026-10-07' });
  assert.match(r.text, /Dad's eye drops are now at 9 AM and 9 PM\. The last day is Wednesday 7 October; after that I won't expect it\./);
  const med = store.getMedications('h')[0]!;
  assert.deepEqual([med.times, med.until], [['09:00', '21:00'], '2026-10-07']);
  const after = new Date('2026-10-08T20:00:00Z');
  assert.equal(detectCareGaps(store.getCareState('h'), { now: after }).filter((g) => /eye drops/.test(g.spoken)).length, 0);
});

test('a medicine entered under the wrong name is corrected, and its doses stay with it', async () => {
  const { store, call } = await family();
  await store.appendEvent({
    householdId: 'h', kind: 'medication_taken', reportedBy: 'm_dad', occurredAt: '2026-09-24T07:05:00Z',
    source: 'voice', confidence: 'reported', detail: 'took the drops', data: { medicationId: 'med_drops', aboutMemberId: 'm_dad' },
  });
  const r = await call('sam', 'change_medication', { medicationName: 'eye drops', newName: 'pain medication' });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Dad's "eye drops" is now called pain medication; the doses already recorded stay with it\./);
  const meds = store.getMedications('h');
  assert.deepEqual(meds.map((m) => [m.id, m.name, m.stoppedAt]), [['med_drops', 'pain medication', undefined]], 'renamed in place, nothing stopped');
  assert.equal(store.getCareState('h').events.at(-1)!.data['renamedFrom'], 'eye drops');
  const morning = detectCareGaps(store.getCareState('h'), { now: new Date('2026-09-24T09:00:00Z') });
  assert.equal(morning.filter((g) => /pain medication/.test(g.spoken) && /8 AM/.test(g.spoken)).length, 0, 'the 8 AM dose is still on the record');
});

test('a rename onto a name already on the schedule is refused', async () => {
  const { store, call } = await family();
  await store.addMedication({ id: 'med_pain', householdId: 'h', name: 'pain medication', times: ['08:00'], forMemberId: 'm_dad' });
  const r = await call('sam', 'change_medication', { medicationName: 'eye drops', newName: 'Pain medication' });
  assert.match(r.text, /already a medication called/);
  assert.equal(store.getMedications('h').find((m) => m.id === 'med_drops')!.name, 'eye drops');
});

test('Dad can record a change to his own medicine', async () => {
  const { call } = await family();
  const r = await call('dad', 'change_medication', { medicationName: 'eye drops', times: ['09:00'] });
  assert.equal(r.isError, false, r.text);
});

test('the check-up moves: the ride moves with it, and whoever took the ride is told', async () => {
  const { store, call, sent } = await family();
  const booked = await call('sam', 'record_appointment', { kind: 'eye check-up', startsAt: '2026-10-01T10:00:00' });
  assert.equal(booked.isError, false, booked.text);
  const ride = store.getCareState('h').obligations.find((o) => /^Drive/.test(o.what))!;
  await store.transition(ride.id, 'h', 'ASSIGNED', 'm_sam', { ownerId: 'm_sandra' });
  const before = Date.parse(ride.dueAt!);

  const moved = await call('sam', 'change_appointment', { appointment: 'the eye check-up', newStartsAt: '2026-09-29T14:00:00' });
  assert.equal(moved.isError, false, moved.text);
  assert.match(moved.text, /^Done\. Dad's eye check-up is now Tuesday the 29th at 2 PM\. What was arranged for it moves too\. I've let Sandra know\./);
  const after = Date.parse(store.getCareState('h').obligations.find((o) => o.id === ride.id)!.dueAt!);
  assert.equal(after - before, -44 * 3_600_000, 'moved by the same 44 hours earlier');
  assert.match(sent.at(-1)!.message, /^Sam says Dad's eye check-up is now Tuesday the 29th at 2 PM, so "Drive Dad to .*" moves with it\.$/);

  const summary = await call('sam', 'get_care_summary', {});
  assert.match(summary.text, /Coming up: Dad's eye check-up Tuesday the 29th at 2 PM\./);
});

test('a cancelled appointment calls off what was arranged for it', async () => {
  const { store, call } = await family();
  await call('sam', 'record_appointment', { kind: 'eye check-up', startsAt: '2026-10-01T10:00:00' });
  const r = await call('sandra', 'change_appointment', { appointment: 'check-up', cancel: true });
  assert.match(r.text, /is cancelled\. What was arranged for it is called off\./);
  const live = store.getCareState('h').obligations.filter((o) => o.status !== 'DISMISSED' && o.status !== 'RESOLVED');
  assert.equal(live.length, 0);
  const summary = await call('sam', 'get_care_summary', {});
  assert.doesNotMatch(summary.text, /Coming up/);
});

test('an appointment that isn\'t there is not invented', async () => {
  const { call } = await family();
  const r = await call('sam', 'change_appointment', { appointment: 'dentist', cancel: true });
  assert.match(r.text, /There are no upcoming appointments on the record/);
});

test('an emergency reaches everyone at once, and says who to call where the family lives', async () => {
  const { store, call, broadcasts } = await family({ broadcast: true });
  const r = await call('dad', 'raise_urgent', { what: "I've fallen in the bathroom and I can't get up" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.text, "Call 112 now, or 767 in Lagos if this is an emergency. I've told Sam and Sandra.");
  assert.deepEqual(broadcasts[0]!.recipients, ['Sam', 'Sandra']);
  assert.match(broadcasts[0]!.message, /^URGENT from Dad: I've fallen in the bathroom and I can't get up\. Please call or go to them now\./);
  assert.equal(store.getCareState('h').events.at(-1)!.kind, 'urgent_raised');
});

test('without a broadcast channel, an emergency is still sent to each person', async () => {
  const { call, sent } = await family();
  const r = await call('sandra', 'raise_urgent', { what: 'Dad has chest pains', forMemberId: 'Dad' });
  assert.deepEqual(sent.map((s) => s.to), ['m_sam'], 'not the person it is about, not the sender');
  assert.match(r.text, /I've told Sam\./);
});

test('"Did I take my drops?" - Dad can see what is recorded today, and who recorded it', async () => {
  const { store, call } = await family();
  await store.appendEvent({
    householdId: 'h', kind: 'medication_taken', reportedBy: 'm_sandra', occurredAt: '2026-09-24T07:10:00.000Z',
    source: 'voice', confidence: 'reported', data: { medicationId: 'med_drops', medicationName: 'eye drops', aboutMemberId: 'm_dad' },
  });
  const r = await call('dad', 'get_shift_brief', {});
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /Recorded so far today: eye drops at 8:10 AM \(from Sandra\)\./);
});
