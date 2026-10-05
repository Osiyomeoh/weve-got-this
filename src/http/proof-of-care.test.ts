import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

/**
 * Proof of care, end to end through the real SDK client: a ride is closed while the
 * doorbell had seen activity near its time, and both the reply and "how do we know?"
 * carry that evidence beside the person's word.
 */

let store: CareStore;
let server: Server;
let base: string;

beforeEach(async () => {
  store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});
afterEach(() => server?.close());

async function call(token: string, name: string, args: Record<string, unknown>) {
  const c = new Client({ name: 'proof-of-care-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  try {
    await c.listTools(); // so the SDK validates structured output, as a host does
    const out = await c.callTool({ name, arguments: args });
    return {
      isError: out.isError === true,
      text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
      structured: (out.structuredContent ?? {}) as Record<string, unknown>,
    };
  } finally {
    await c.close();
  }
}

test('closing a ride records what the doorbell saw, and "how do we know?" says it', async () => {
  const now = Date.now();
  const o = await store.createObligation({
    householdId: 'h_margaret', what: 'Drive Daddy to the pharmacy', consequence: 'medical',
    status: 'ASSIGNED', ownerId: 'm_david',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: new Date(now - 86_400_000).toISOString() },
    dueAt: new Date(now - 20 * 60_000).toISOString(),
  });
  const at = new Date(now - 25 * 60_000).toISOString();
  const ring = await store.appendEvent({
    householdId: 'h_margaret', kind: 'external_signal', reportedBy: 'device:ring', occurredAt: at,
    source: 'ring', confidence: 'observed', data: { source: 'ring', signalKind: 'motion' },
  });

  const done = await call('david-token', 'resolve_obligation', { obligationId: o.id });
  assert.equal(done.isError, false, done.text);
  assert.match(done.text, /The doorbell also saw activity at the door at/);
  const closed = store.getCareState('h_margaret').events.find((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === o.id)!;
  assert.deepEqual(closed.derivedFrom, [ring.id]);

  const why = await call('david-token', 'get_provenance', { obligationId: o.id });
  assert.equal(why.isError, false, why.text);
  assert.match(why.text, /Around then the doorbell saw activity at the door at .* not proof on its own/);
});

test('"can\'t make it after all" from the owner hands the work back; "on my way" keeps it', async () => {
  const o = await store.createObligation({
    householdId: 'h_margaret', what: 'Drive Daddy to the pharmacy', consequence: 'medical',
    status: 'ASSIGNED', ownerId: 'm_david',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: new Date().toISOString() },
    dueAt: new Date(Date.now() - 20 * 60_000).toISOString(),
  });
  const still = await call('david-token', 'respond_to_request', { obligationId: o.id, accepted: true });
  assert.match(still.text, /stays with you/);

  const other = await call('renee-token', 'respond_to_request', { obligationId: o.id, accepted: false });
  assert.equal(store.getCareState('h_margaret').obligations.find((x) => x.id === o.id)!.ownerId, 'm_david',
    'nobody hands back someone else\'s work');
  assert.match(other.text, /Nobody has an outstanding request/);

  const cant = await call('david-token', 'respond_to_request', { obligationId: o.id, accepted: false, note: 'car broke down' });
  assert.equal(cant.isError, false, cant.text);
  const after = store.getCareState('h_margaret').obligations.find((x) => x.id === o.id)!;
  assert.equal(after.status, 'OPEN');
  assert.equal(after.ownerId, null);
  assert.deepEqual(after.declinedBy, ['m_david']);
});
