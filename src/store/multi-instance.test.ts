import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CareStore, RecordChangedError, type Persistence } from './store.ts';
import { DynamoPersistence } from './dynamo.ts';
import { fakeTable, type FakeTable } from './fake-table.ts';
import { createCareCircleServer } from '../mcp/server.ts';
import { createCareCircleApp } from '../http/app.ts';

/**
 * Two instances of the server share one table. Neither may answer from a record the other
 * has already changed, and neither may write over a record it has not seen: a stale write
 * is refused whole, and the instance reads the record again.
 */

let server: Server | undefined;
afterEach(() => server?.close());

async function instance(table: FakeTable): Promise<CareStore> {
  const store = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await store.init();
  return store;
}

async function family(store: CareStore): Promise<void> {
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h',
    name: 'Joseph',
    role: 'care_recipient',
    spokenAs: 'Daddy',
  });
  await store.addMember({
    id: 'm_tolu',
    householdId: 'h',
    name: 'Tolu',
    role: 'primary_caregiver',
  });
  await store.addMember({ id: 'm_funmi', householdId: 'h', name: 'Funmi', role: 'caregiver' });
  await store.createObligation({
    id: 'o_ride',
    householdId: 'h',
    what: 'Take Daddy to his eye check-up',
    consequence: 'medical',
    status: 'OPEN',
    ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_tolu', at: '2026-09-24T09:00:00Z' },
  } as never);
}

const note = (detail: string) => ({
  householdId: 'h',
  kind: 'note_added' as const,
  reportedBy: 'm_tolu',
  occurredAt: '2026-09-24T10:00:00Z',
  data: {},
  detail,
});

test('an instance sees what another wrote once it refreshes', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  const b = await instance(table);

  await a.appendEvent(note('Daddy slept well'));
  assert.equal(b.getCareState('h').events.length, 0, 'b has not looked yet');
  assert.equal(await b.refresh(), true);
  assert.equal(b.getCareState('h').events.at(-1)?.detail, 'Daddy slept well');
  assert.equal(await b.refresh(), false, 'nothing new: one small read, no reload');
});

test('a write made on a stale record is refused whole, and the instance reads the record again', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  const b = await instance(table);

  await a.transition('o_ride', 'h', 'ASSIGNED', 'm_funmi', { ownerId: 'm_funmi' });
  const rowsBefore = JSON.stringify([...table.rows.entries()]);

  // b still thinks the ride is open, and tries to take it for Tolu.
  await assert.rejects(
    b.transition('o_ride', 'h', 'ASSIGNED', 'm_tolu', { ownerId: 'm_tolu' }),
    RecordChangedError,
  );
  assert.equal(
    JSON.stringify([...table.rows.entries()]),
    rowsBefore,
    'nothing of the refused write landed',
  );
  assert.equal(
    b.getObligation('o_ride', 'h').ownerId,
    'm_funmi',
    'b now holds the record as it is: Funmi has the ride',
  );

  // And b can write again, on the record as it now is.
  await b.appendEvent(note('Tolu will ride along'));
  const c = await instance(table);
  assert.equal(c.getObligation('o_ride', 'h').ownerId, 'm_funmi');
  assert.equal(c.getCareState('h').events.at(-1)?.detail, 'Tolu will ride along');
});

test('a write that lands in the middle of a read is not half-seen: the read starts again', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  let scans = 0;
  table.onScan = () => {
    scans += 1;
    if (scans === 1) {
      // Another process commits between the reader's first version check and its scan.
      table.rows.set('HH#h|EVENT#late', {
        pk: 'HH#h',
        sk: 'EVENT#late',
        kind: 'EVENT',
        body: { ...note('arrived mid-read'), id: 'late', recordedAt: '2026-09-24T10:00:01Z' },
      });
      const v = table.rows.get('META|VERSION')!;
      table.rows.set('META|VERSION', { ...v, v: Number(v['v']) + 1 });
    }
  };
  const b = await instance(table);
  assert.equal(scans, 2, 'the scan was repeated');
  assert.equal(b.getCareState('h').events.at(-1)?.detail, 'arrived mid-read');
});

test('a save larger than one transaction goes in parts, each moving the version on', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  const before = Number(table.rows.get('META|VERSION')?.['v']);
  const b = await instance(table);
  for (let i = 0; i < 150; i += 1) await a.appendEvent(note(`note ${i}`));
  await b.refresh();
  const { removed } = await b.removeHousehold('h');
  assert.ok(removed > 99, `removed ${removed}`);
  assert.equal(
    Number(table.rows.get('META|VERSION')?.['v']),
    before + 150 + 2,
    'two transactions for the removal',
  );
  assert.deepEqual(
    [...table.rows.keys()].filter((k) => k.startsWith('HH#h|')),
    [],
  );
});

test('a non-person node survives a restart', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  await a.addEntity({
    id: 'e_clinic',
    householdId: 'h',
    type: 'service',
    name: 'Eye clinic',
  } as never);
  const b = await instance(table);
  assert.equal(b.getCareState('h').entities?.[0]?.name, 'Eye clinic');
});

test('a save that fails for any reason does not stay in memory as if it had landed', async () => {
  let saved = {
    households: [],
    members: [],
    events: [],
    obligations: [],
    medications: [],
    transitions: [],
    identities: [],
  } as never;
  let failNext = false;
  const flaky: Persistence = {
    load: async () => structuredClone(saved),
    save: async (s) => {
      if (failNext) throw new Error('disk full');
      saved = structuredClone(s) as never;
    },
  };
  const store = new CareStore(flaky);
  await store.init();
  await family(store);
  failNext = true;
  await assert.rejects(store.appendEvent(note('lost')), /disk full/);
  assert.equal(store.getCareState('h').events.length, 0, 'the unsaved note is not served');
});

test('the planner is told the record changed, never that its stale write was saved', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  const b = await instance(table);
  await a.transition('o_ride', 'h', 'ASSIGNED', 'm_funmi', { ownerId: 'm_funmi' });

  // A tool call on b with no refresh in front of it: the refusal has to reach the planner.
  const mcp = createCareCircleServer({ store: b, actorId: 'm_tolu' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  const client = new Client({ name: 'multi-instance-test', version: '1' });
  await client.connect(clientSide);
  await client.listTools();
  const out = await client.callTool({
    name: 'claim_obligation',
    arguments: { obligationId: 'o_ride' },
  });
  const text = (out.content as { text: string }[])[0]!.text;
  assert.equal(out.isError, true);
  assert.match(text, /changed the care record at the same moment, so this was not saved/);
  assert.equal(b.getObligation('o_ride', 'h').ownerId, 'm_funmi', 'Funmi keeps the ride');
});

test('over HTTP, every request reads the record fresh', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  const b = await instance(table);
  const app = createCareCircleApp({
    store: b,
    now: () => new Date('2026-09-24T12:00:00Z'),
    tokens: new Map([['tolu', 'm_tolu']]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;

  await a.appendEvent(note('Daddy sounded tired on the phone'));

  const client = new Client({ name: 'multi-instance-http', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: 'Bearer tolu' } },
    }),
  );
  try {
    await client.listTools();
    const out = await client.callTool({ name: 'get_care_summary', arguments: {} });
    assert.match((out.content as { text: string }[])[0]!.text, /Daddy sounded tired on the phone/);
  } finally {
    await client.close();
  }
});

test("only one instance holds the loops' lease, and another takes it when it lapses", async () => {
  // Two instances both running reminders would tell the family everything twice.
  const table = fakeTable();
  const a = await instance(table);
  const b = await instance(table);
  assert.equal(await a.lease('loops', 60_000), true);
  assert.equal(await b.lease('loops', 60_000), false, 'the second instance stays quiet');
  assert.equal(await a.lease('loops', 60_000), true, 'the holder renews it');

  const row = table.rows.get('META|LEASE#loops')!;
  row['until'] = Date.now() - 1; // the holder stopped renewing
  assert.equal(await b.lease('loops', 60_000), true, 'a lapsed lease is taken over');
  assert.equal(await a.lease('loops', 60_000), false);
});

test('a lease is not part of the care record', async () => {
  const table = fakeTable();
  const a = await instance(table);
  await family(a);
  await a.lease('loops', 60_000);
  const b = await instance(table);
  assert.deepEqual(
    b
      .getCareState('h')
      .members.map((m) => m.id)
      .sort(),
    ['m_dad', 'm_funmi', 'm_tolu'],
  );
  await b.appendEvent(note('after the lease') as never);
  assert.ok(table.rows.has('META|LEASE#loops'), 'a save does not remove it');
});

test('one process on its own always holds the lease', async () => {
  assert.equal(await new CareStore().lease('loops', 1), true);
});
