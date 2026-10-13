import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore, NotFoundError } from './store.ts';
import { DynamoPersistence } from './dynamo.ts';
import { fakeTable } from './fake-table.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

/**
 * removeHousehold is how a family's "delete our data" is honoured and how the demo
 * household is re-seeded in production. Both only work if it touches exactly one
 * household, so these tests put a second, real-looking family next to the demo one and
 * check it survives unchanged - including through the DynamoDB diff that production
 * actually writes with.
 */

async function seedOtherFamily(store: CareStore): Promise<void> {
  await store.addHousehold({ id: 'h_other', name: 'another family', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_other_aunt',
    householdId: 'h_other',
    name: 'Aunty',
    role: 'primary_caregiver',
  });
  await store.mapIdentity({
    subject: 'sub-aunty',
    memberId: 'm_other_aunt',
    householdId: 'h_other',
  });
  const o = await store.createObligation({
    householdId: 'h_other',
    what: 'Collect blood pressure pills',
    consequence: 'medical',
    status: 'OPEN',
    ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_other_aunt', at: '2026-09-20T09:00:00Z' },
  });
  await store.transition(o.id, 'h_other', 'ASSIGNED', 'm_other_aunt', { ownerId: 'm_other_aunt' });
  await store.appendEvent({
    householdId: 'h_other',
    kind: 'note',
    reportedBy: 'm_other_aunt',
    occurredAt: '2026-09-20T09:00:00Z',
    data: {},
    detail: 'Pharmacy closes at 6',
  });
}

test('removing a household deletes everything it owns and nothing else', async () => {
  const store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  await seedOtherFamily(store);
  const other = structuredClone(store.getCareState('h_other'));

  const { removed } = await store.removeHousehold('h_margaret');
  assert.ok(removed > 0);
  assert.throws(() => store.getCareState('h_margaret'));
  assert.ok(!store.allMembers().some((m) => m.householdId === 'h_margaret'));
  assert.deepEqual(store.getCareState('h_other'), other);
  assert.equal(store.resolveIdentity('sub-aunty')?.memberId, 'm_other_aunt');
});

test('an unknown household is refused rather than silently doing nothing', async () => {
  const store = new CareStore();
  await assert.rejects(store.removeHousehold('h_nope'), NotFoundError);
});

test("production reset: re-seeding the demo household leaves another family's rows untouched", async () => {
  const { client, rows } = fakeTable();

  // Production as it stands: the demo household with stale state, plus a real family.
  const live = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await live.init();
  await seedDemoHousehold(live);
  await seedScenario(live, 'h_margaret', { now: new Date('2024-12-16T12:00:00Z') });
  await seedOtherFamily(live);
  await live.quiesce();

  const otherBefore = [...rows.entries()].filter(([k]) => k.startsWith('HH#h_other|'));
  const staleObligations = live.getCareState('h_margaret').obligations.map((o) => o.id);
  assert.ok(otherBefore.length > 0);

  // The reset script: load the table, drop and re-seed only the demo household.
  const script = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await script.init();
  await script.removeHousehold('h_margaret');
  await seedDemoHousehold(script);
  await seedScenario(script, 'h_margaret', { now: new Date('2026-09-23T12:00:00Z') });
  await script.quiesce();

  const otherAfter = [...rows.entries()].filter(([k]) => k.startsWith('HH#h_other|'));
  assert.deepEqual(
    otherAfter,
    otherBefore,
    "the other family's rows must be byte-for-byte unchanged",
  );

  const keys = [...rows.keys()].join('\n');
  for (const id of staleObligations)
    assert.ok(!keys.includes(id), `stale obligation ${id} should be gone`);

  // And the demo household reloads with fresh dates.
  const reloaded = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await reloaded.init();
  const due = reloaded
    .getCareState('h_margaret')
    .obligations.map((o) => o.dueAt)
    .filter(Boolean) as string[];
  assert.ok(due.length > 0);
  assert.ok(
    due.every((d) => d > '2026-09-23'),
    `expected fresh dates, got ${due.join(', ')}`,
  );
});
