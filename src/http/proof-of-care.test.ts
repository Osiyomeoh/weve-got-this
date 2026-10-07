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
  assert.match(why.text, /It is resolved\./);
  assert.doesNotMatch(why.text, /owns it/, 'finished work is not "owned" by anyone');
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

test('closing finished work again says who closed it, and adds no second "done"', async () => {
  const now = Date.now();
  const o = await store.createObligation({
    householdId: 'h_margaret', what: 'Pick up the eye drops refill', consequence: 'medical',
    status: 'ASSIGNED', ownerId: 'm_aide',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: new Date(now - 86_400_000).toISOString() },
    dueAt: new Date(now - 20 * 60_000).toISOString(),
  });
  const first = await call('aide-token', 'resolve_obligation', { obligationId: o.id });
  assert.equal(first.isError, false, first.text);

  // Later, Tolu says "Musa says the pharmacy run is done" and the planner reaches for this tool.
  const again = await call('david-token', 'resolve_obligation', { obligationId: o.id });
  assert.equal(again.isError, false, again.text);
  assert.match(again.text, /^That's already done - Musa marked "Pick up the eye drops refill" done at /);
  const closes = store.getCareState('h_margaret').events.filter((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === o.id);
  assert.equal(closes.length, 1);
  assert.equal(closes[0]!.reportedBy, 'm_aide');
});

test('the agent\'s "still on?" shows on the household state as it was sent', async () => {
  // 2 PM in Lagos, so quiet hours cannot hold the check-in back whenever the suite runs.
  const at = new Date();
  at.setUTCHours(13, 0, 0, 0);
  const o = await store.createObligation({
    householdId: 'h_margaret', what: 'Pick up the eye drops refill', consequence: 'medical',
    status: 'ASSIGNED', ownerId: 'm_aide',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: new Date(at.getTime() - 86_400_000).toISOString() },
    dueAt: new Date(at.getTime() - 20 * 60_000).toISOString(),
  });
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)), now: () => at });
  const pinned = app.listen(0);
  await new Promise<void>((r) => pinned.once('listening', r));
  const c = new Client({ name: 'proof-of-care-test', version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(pinned.address() as AddressInfo).port}/mcp`), {
    requestInit: { headers: { Authorization: 'Bearer david-token' } },
  }));
  try {
    const run = await c.callTool({ name: 'run_care_agent', arguments: {} });
    assert.notEqual(run.isError, true);
    const res = await c.readResource({ uri: 'carecircle://household/state' });
    const state = JSON.parse((res.contents[0] as { text: string }).text) as { notifications: { from: string; to: string; message: string }[] };
    const checkIn = state.notifications.find((n) => n.to === 'Musa' && n.message.includes(o.what));
    assert.ok(checkIn, JSON.stringify(state.notifications));
    assert.equal(checkIn.from, 'CareCircle');
    assert.match(checkIn.message, /Still on\?/);
  } finally {
    await c.close();
    pinned.close();
  }
});
