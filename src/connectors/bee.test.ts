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
  await store.addMember({ id: 'm_margaret', householdId: HH, name: 'Margaret', role: 'care_recipient', spokenAs: 'Mum' });
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
  const obl = state.obligations.find((o) => o.provenance.kind === 'INFERRED' && o.provenance.rule === 'bee:todo');
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
  const r = await syncBeeItems(store, HH, items({
    todos: [{ id: 't9', text: 'already handled', completed: true }], facts: [],
  }), NOW);
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
  assert.equal(beeConfigFromEnv({ BEE_API_BASE: 'https://api.bee.computer' } as NodeJS.ProcessEnv), null);
  const cfg = beeConfigFromEnv({ BEE_TOKEN: 'x', BEE_API_BASE: 'https://api.bee.computer/' } as NodeJS.ProcessEnv);
  assert.equal(cfg!.apiBase, 'https://api.bee.computer'); // trailing slash trimmed
});
