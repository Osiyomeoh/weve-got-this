import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { composeDailyUpdate, dueDailyUpdates, sendDailyUpdates } from './daily-update.ts';
import { candidatesFor } from './delegation.ts';
import type { DeliveryResult, Notifier } from '../notify/notifier.ts';

const H = 'h_margaret';
// 21:30 in Lagos on a Wednesday: after the evening dose and its grace hour.
const EVENING = new Date('2026-09-23T20:30:00Z');
const AFTERNOON = new Date('2026-09-23T15:00:00Z');

async function family(now = EVENING): Promise<CareStore> {
  const store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, H, { now });
  return store;
}

class FakeNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  sent: { to: string; message: string }[] = [];
  constructor(private readonly works = true) {}
  async deliver(input: { to: string; message: string }): Promise<DeliveryResult> {
    if (!this.works) return { delivered: false, channel: 'telegram', detail: 'network down' };
    this.sent.push({ to: input.to, message: input.message });
    return { delivered: true, channel: 'telegram' };
  }
}

test('the evening update says what the record says, and never "missed"', async () => {
  const text = composeDailyUpdate((await family()).getCareState(H), EVENING);
  assert.match(text, /^Daddy's evening update - Wednesday 23 September\./);
  assert.match(text, /- eye drops, 08:00: Daddy logged it themselves/);
  assert.match(text, /- eye drops, 20:00: no record yet/);
  assert.match(text, /- supplement, 08:00: Daddy logged it themselves/);
  assert.match(text, /Pick up Daddy's eye drops refill \(today\): nobody has taken this on yet/);
  assert.match(text, /Take Daddy to his eye check-up \(tomorrow\): nobody has taken this on yet/);
  assert.match(text, /Funmi: Daddy asked who is taking him on Thursday\./);
  assert.match(text, /"No record" means nobody logged it - not that it didn't happen\./);
  assert.doesNotMatch(text, /missed|didn't take|did not take|forgot/i);
});

test('a dose someone else logged says who logged it', async () => {
  const store = await family();
  await store.appendEvent({
    householdId: H, kind: 'medication_taken', reportedBy: 'm_aide',
    occurredAt: '2026-09-23T19:05:00Z', source: 'voice', confidence: 'reported',
    data: { medicationId: 'med_heart', aboutMemberId: 'm_margaret' },
  });
  assert.match(composeDailyUpdate(store.getCareState(H), EVENING), /- eye drops, 20:00: Musa logged it for Daddy/);
});

test('a dose whose time has not come says so, rather than "no record"', async () => {
  const text = composeDailyUpdate((await family(AFTERNOON)).getCareState(H), AFTERNOON);
  assert.match(text, /- eye drops, 20:00: not due yet/);
});

test('the update is due in the evening, only to people who asked for it', async () => {
  const store = await family();
  assert.deepEqual(dueDailyUpdates(store.getCareState(H), AFTERNOON), []);
  assert.deepEqual(dueDailyUpdates(store.getCareState(H), EVENING).map((m) => m.name), ['Kunle']);
});

test('it goes out once a day, and is in the care log', async () => {
  const store = await family();
  const notifier = new FakeNotifier();
  assert.equal(await sendDailyUpdates({ store, notifier }, EVENING), 1);
  assert.equal(await sendDailyUpdates({ store, notifier }, new Date(EVENING.getTime() + 15 * 60_000)), 0);
  assert.deepEqual(notifier.sent.map((s) => s.to), ['m_kunle']);
  const logged = store.getCareState(H).events.filter((e) => e.data['update'] === 'daily');
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.data['localDate'], '2026-09-23');
});

test('a failed delivery is not recorded, so the next tick tries again', async () => {
  const store = await family();
  assert.equal(await sendDailyUpdates({ store, notifier: new FakeNotifier(false) }, EVENING), 0);
  const notifier = new FakeNotifier();
  assert.equal(await sendDailyUpdates({ store, notifier }, EVENING), 1);
});

test('the brother in London is never picked automatically for a ride', async () => {
  const s = (await family()).getCareState(H);
  const ride = s.obligations.find((o) => o.what === 'Take Daddy to his eye check-up')!;
  // Family before paid help would otherwise put Kunle ahead of Musa.
  assert.deepEqual(candidatesFor(ride, s, { askerId: 'm_david' }).map((c) => c.name), ['Funmi', 'Musa']);
});
