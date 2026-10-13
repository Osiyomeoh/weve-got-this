import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CareStore } from './store.ts';
import { DynamoPersistence } from './dynamo.ts';
import { fakeTable, type FakeTable } from './fake-table.ts';
import { createCareCircleServer } from '../mcp/server.ts';

/**
 * The family on several phones at once, each request on whichever instance of the server
 * picks it up, all sharing one table. Random batches of requests run at the same moment:
 * notes, check-ins and claims on the one ride nobody has yet. Whatever the interleaving:
 *
 *  - one owner:    at most one person is ever told the ride is theirs, and it is they who hold it
 *  - nothing lost: every note the family was told was added is in the record, exactly once
 *  - nothing false: a note the family was told was not saved is not in the record
 *  - one record:   every instance, once it reads again, holds what a new instance reads
 *  - a true history: each change of the ride starts from the status the last one left
 *
 * WRITER_RUNS sets the families (default 150).
 */

const RUNS = Number(process.env.WRITER_RUNS ?? 150);
const MEMBERS = ['m_dad', 'm_tolu', 'm_funmi', 'm_kunle'];

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
  await store.addMember({ id: 'm_kunle', householdId: 'h', name: 'Kunle', role: 'caregiver' });
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

type Op = { on: number; by: string; refresh: boolean; what: 'note' | 'check_in' | 'claim' };
const op = (instances: number): fc.Arbitrary<Op> =>
  fc.record({
    on: fc.integer({ min: 0, max: instances - 1 }),
    by: fc.constantFrom(...MEMBERS),
    // Over HTTP every request reads the record first; over a held session it may not.
    refresh: fc.boolean(),
    what: fc.constantFrom('note' as const, 'check_in' as const, 'claim' as const),
  });
const plan = fc.integer({ min: 2, max: 4 }).chain((n) =>
  fc.record({
    instances: fc.constant(n),
    batches: fc.array(fc.array(op(n), { minLength: 1, maxLength: 5 }), {
      minLength: 1,
      maxLength: 6,
    }),
  }),
);

test('many writers on many instances: one owner, nothing lost, nothing false, one record', async (t) => {
  let requests = 0;
  let refused = 0;
  await fc.assert(
    fc.asyncProperty(plan, async ({ instances, batches }) => {
      const table = fakeTable();
      const stores: CareStore[] = [];
      for (let i = 0; i < instances; i++) {
        if (i === 0) {
          const first = await instance(table);
          await family(first);
          stores.push(first);
        } else stores.push(await instance(table));
      }
      const clients = new Map<string, Client>();
      const client = async (on: number, by: string) => {
        const key = `${on}:${by}`;
        if (!clients.has(key)) {
          const [c, s] = InMemoryTransport.createLinkedPair();
          await createCareCircleServer({ store: stores[on]!, actorId: by }).connect(s);
          const cl = new Client({ name: 'writers', version: '1' });
          await cl.connect(c);
          clients.set(key, cl);
        }
        return clients.get(key)!;
      };

      const told = { added: [] as string[], notSaved: [] as string[], ownedBy: new Set<string>() };
      let n = 0;
      try {
        for (const batch of batches) {
          await Promise.all(
            batch.map(async (o) => {
              const tag = `w${n++}`;
              const c = await client(o.on, o.by);
              if (o.refresh) await stores[o.on]!.refresh();
              const call =
                o.what === 'claim'
                  ? { name: 'claim_obligation', arguments: { obligationId: 'o_ride' } }
                  : o.what === 'note'
                    ? { name: 'add_note', arguments: { note: `note ${tag}` } }
                    : {
                        name: 'log_care_event',
                        arguments: { kind: 'check_in', detail: `note ${tag}` },
                      };
              const out = await c.callTool(call);
              requests++;
              const text = (out.content as { text: string }[]).map((p) => p.text).join(' ');
              if (/changed the care record at the same moment, so this was not saved/.test(text)) {
                refused++;
                if (o.what !== 'claim') told.notSaved.push(`note ${tag}`);
              } else if (o.what === 'claim' && /is yours\.$/.test(text)) told.ownedBy.add(o.by);
              else if (o.what !== 'claim' && out.isError !== true) told.added.push(`note ${tag}`);
            }),
          );
        }

        const truth = await instance(table);
        const state = truth.getCareState('h');
        const details = state.events.map((e) => e.detail);
        assert.ok(told.ownedBy.size <= 1, `told it was theirs: ${[...told.ownedBy].join(', ')}`);
        assert.equal(truth.getObligation('o_ride', 'h').ownerId, [...told.ownedBy][0] ?? null);
        for (const d of told.added)
          assert.equal(details.filter((x) => x === d).length, 1, `"${d}" should be there once`);
        for (const d of told.notSaved)
          assert.ok(!details.includes(d), `"${d}" was refused but is in the record`);
        assert.equal(
          details.filter((d) => d?.startsWith('note w')).length,
          told.added.length,
          'nothing else landed',
        );

        const history = truth.getTransitions('o_ride');
        history.reduce((status, tr) => {
          assert.equal(tr.from, status, 'each change starts where the last ended');
          return tr.to;
        }, 'OPEN');
        const expected = JSON.stringify(state);
        for (const s of stores) {
          await s.refresh();
          assert.equal(
            JSON.stringify(s.getCareState('h')),
            expected,
            'an instance, read again, holds the record',
          );
        }
      } finally {
        for (const c of clients.values()) await c.close();
      }
    }),
    { numRuns: RUNS },
  );
  t.diagnostic(`${requests} requests, ${refused} refused as stale and said so`);
  assert.ok(refused > 0, 'the races happened: some writes were made on a stale record');
});
