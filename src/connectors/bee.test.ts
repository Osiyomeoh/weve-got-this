import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { syncBeeItems } from './bee.ts';
import { beeConfigFromEnv } from './bee.ts';
import type { BeeItems } from '../domain/bee.ts';

const HH = 'h1';
const NOW = new Date('2026-10-14T14:00:00Z');
const store = new CareStore();

async function seed(): Promise<void> {
  await store.reset();
  await store.addHousehold({ id: HH, name: 'circle', timezone: 'America/New_York' });
  await store.addMember({
    id: 'm_margaret',
    householdId: HH,
    name: 'Margaret',
    role: 'care_recipient',
    spokenAs: 'Mum',
  });
}
beforeEach(seed);

const items = (over: Partial<BeeItems> = {}): BeeItems => ({
  facts: over.facts ?? [{ id: 'f1', text: 'She prefers the morning aide', confirmed: false }],
  todos: over.todos ?? [{ id: 't1', text: 'Pick up prescription Friday', completed: false }],
});

test('a bee todo enters as a PROPOSED, INFERRED obligation - never asserted work', async () => {
  const r = await syncBeeItems(store, HH, items(), NOW);
  assert.equal(r.proposed.length, 1);

  const state = store.getCareState(HH);
  const obl = state.obligations.find(
    (o) => o.provenance.kind === 'INFERRED' && o.provenance.rule === 'bee:todo',
  );
  assert.ok(obl, 'the todo should have produced an INFERRED obligation');
  // The whole trust thesis: a thing Bee heard is heard, not known.
  assert.equal(obl!.status, 'PROPOSED');
  assert.equal(obl!.ownerId, null);
  assert.equal(obl!.consequence, 'logistical');
  // Its source event is a bee-attributed observation, observed and no higher.
  const ev = state.events.find((e) => e.id === obl!.sourceEventId);
  assert.equal(ev!.source, 'bee');
  assert.equal(ev!.confidence, 'observed');
  assert.equal(ev!.reportedBy, 'device:bee');
});

test('a bee fact is recorded as an observation and creates no obligation', async () => {
  const r = await syncBeeItems(store, HH, items({ todos: [] }), NOW);
  assert.equal(r.observed.length, 1);
  assert.equal(r.proposed.length, 0);
  const state = store.getCareState(HH);
  assert.equal(state.obligations.length, 0, 'a fact must never manufacture work');
  const ev = state.events.find((e) => e.data['beeKind'] === 'fact');
  assert.equal(ev!.source, 'bee');
  assert.equal(ev!.confidence, 'observed');
});

test('a completed todo is skipped, not re-proposed', async () => {
  const r = await syncBeeItems(
    store,
    HH,
    items({
      todos: [{ id: 't9', text: 'already handled', completed: true }],
      facts: [],
    }),
    NOW,
  );
  assert.equal(r.proposed.length, 0);
  assert.equal(r.skipped.find((s) => s.id === 't9')?.reason, 'completed or empty');
});

test('re-running the same pull creates nothing (idempotent by bee id)', async () => {
  await syncBeeItems(store, HH, items(), NOW);
  const before = store.getCareState(HH);
  const r2 = await syncBeeItems(store, HH, items(), NOW);
  assert.equal(r2.proposed.length, 0);
  assert.equal(r2.observed.length, 0);
  assert.equal(store.getCareState(HH).obligations.length, before.obligations.length);
  assert.equal(store.getCareState(HH).events.length, before.events.length);
});

test('config needs both a token and an explicit API base (no guessed host)', () => {
  assert.equal(beeConfigFromEnv({ BEE_TOKEN: 'x' } as NodeJS.ProcessEnv), null);
  assert.equal(
    beeConfigFromEnv({ BEE_API_BASE: 'https://api.bee.computer' } as NodeJS.ProcessEnv),
    null,
  );
  const cfg = beeConfigFromEnv({
    BEE_TOKEN: 'x',
    BEE_API_BASE: 'https://api.bee.computer/',
  } as NodeJS.ProcessEnv);
  assert.equal(cfg!.apiBase, 'https://api.bee.computer'); // trailing slash trimmed
});

// ---- reminders CareCircle puts in their Bee ----------------------------------

import { sendDueReminders } from '../domain/reminders.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';

test('at dose time the reminder goes into their Bee; ticked done, the dose is on the record as theirs', async () => {
  await store.addMedication({
    id: 'med',
    householdId: HH,
    name: 'eye drops',
    times: ['10:00'],
    forMemberId: 'm_margaret',
    since: '2026-10-01T00:00:00Z',
  });
  const sent: { text: string; alarmAt: string }[] = [];
  const bee = {
    config: { token: 't', apiBase: 'https://bee.test' },
    memberId: 'm_margaret',
    create: async (_c: unknown, todo: { text: string; alarmAt: string }) => {
      sent.push(todo);
      return 'bee-1';
    },
  };
  // 10:05 in New York.
  const at = new Date('2026-10-14T14:05:00Z');
  await sendDueReminders({ store, notifier: new RecordOnlyNotifier(), bee, now: at });
  await sendDueReminders({ store, notifier: new RecordOnlyNotifier(), bee, now: at });
  assert.equal(sent.length, 1, 'one reminder, however many ticks');
  assert.match(sent[0]!.text, /eye drops/);

  // Still open in Bee: nothing recorded, and it is not mistaken for something Bee overheard.
  let r = await syncBeeItems(
    store,
    HH,
    items({ facts: [], todos: [{ id: 'bee-1', text: sent[0]!.text, completed: false }] }),
    at,
  );
  assert.equal(r.proposed.length, 0);
  assert.equal(r.taken.length, 0);

  r = await syncBeeItems(
    store,
    HH,
    items({ facts: [], todos: [{ id: 'bee-1', text: sent[0]!.text, completed: true }] }),
    new Date('2026-10-14T14:09:00Z'),
  );
  assert.equal(r.taken.length, 1);
  const taken = store.getCareState(HH).events.filter((e) => e.kind === 'medication_taken');
  assert.equal(taken.length, 1);
  assert.equal(taken[0]!.reportedBy, 'm_margaret');
  assert.equal(taken[0]!.source, 'bee');

  // A second sync changes nothing.
  r = await syncBeeItems(
    store,
    HH,
    items({ facts: [], todos: [{ id: 'bee-1', text: sent[0]!.text, completed: true }] }),
    new Date('2026-10-14T14:12:00Z'),
  );
  assert.equal(
    store.getCareState(HH).events.filter((e) => e.kind === 'medication_taken').length,
    1,
  );
});

test('the Bee reminder goes only to the member whose Bee it is', async () => {
  await store.addMember({ id: 'm_son', householdId: HH, name: 'Sam', role: 'primary_caregiver' });
  await store.addMedication({
    id: 'med',
    householdId: HH,
    name: 'eye drops',
    times: ['10:00'],
    forMemberId: 'm_margaret',
    since: '2026-10-01T00:00:00Z',
  });
  let calls = 0;
  const bee = {
    config: { token: 't', apiBase: 'https://bee.test' },
    memberId: 'm_son',
    create: async () => {
      calls += 1;
      return 'x';
    },
  };
  await sendDueReminders({
    store,
    notifier: new RecordOnlyNotifier(),
    bee,
    now: new Date('2026-10-14T14:05:00Z'),
  });
  assert.equal(calls, 0);
});
