import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { sandboxCreatedAt, sandboxSuffix, sweepSandboxes } from './sandbox.ts';

/**
 * Per-visitor sandboxes. Judges try the live demo at the same time; each must get the
 * story from the start, and no judge's actions may reach another judge, the real demo
 * household, or a real family.
 */

const KEY = 'test-sandbox-key';
const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  process.env['CARECIRCLE_OAUTH_SECRET'] = 'test-oauth-secret';
  process.env['CARECIRCLE_PUBLIC_URL'] = 'http://localhost';
  process.env['CARECIRCLE_SANDBOX_KEY'] = KEY;
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  delete process.env['CARECIRCLE_OAUTH_SECRET'];
  delete process.env['CARECIRCLE_PUBLIC_URL'];
  delete process.env['CARECIRCLE_SANDBOX_KEY'];
});

async function create(key = KEY, body?: object): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/sandbox`, {
    method: 'POST', headers: { 'x-sandbox-key': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

/** Open an MCP session with a bearer token and call one tool. */
async function callTool(token: string, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  const parse = async (r: Response) => {
    const t = await r.text();
    const line = t.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : t);
  };
  const init = await fetch(`${base}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }),
  });
  assert.equal(init.status, 200);
  headers['mcp-session-id'] = init.headers.get('mcp-session-id')!;
  await init.text();
  await fetch(`${base}/mcp`, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  const out = await parse(await fetch(`${base}/mcp`, { method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) }));
  return out.result;
}

test('without the key, nobody can create a sandbox', async () => {
  assert.equal((await create('wrong')).status, 401);
  assert.equal((await create('')).status, 401);
});

test('a sandbox is a fresh copy of the demo story, reachable with its own tokens', async () => {
  const { status, json } = await create();
  assert.equal(status, 201);
  assert.match(json.householdId, /^h_margaret~/);
  assert.deepEqual(Object.keys(json.tokens).sort(), ['m_aide', 'm_david', 'm_kunle', 'm_margaret', 'm_renee']);

  const gaps = await callTool(json.tokens.m_david, 'get_care_gaps');
  assert.match(gaps.content[0].text, /Take Daddy to his eye check-up/);
  assert.ok(gaps.structuredContent.gaps.every((g: { obligationId?: string }) =>
    !g.obligationId || store.getObligation(g.obligationId, json.householdId)));
});

test('a copy for the 3D world leaves the morning eye drops for the visitor to log', async () => {
  const eyeDrops = (hh: string) => store.getCareState(hh).events
    .filter((e) => e.kind === 'medication_taken' && (e.data as { medicationName?: string }).medicationName === 'eye drops');
  const usual = (await create()).json;
  assert.equal(eyeDrops(usual.householdId).length, 1, 'the console copy has the 8:10 dose');
  const world = (await create(KEY, { liveMorning: true })).json;
  assert.equal(eyeDrops(world.householdId).length, 0, 'the world copy does not: Daddy logs it at 7:42');
  assert.ok(store.getCareState(world.householdId).events.some((e) => e.kind === 'medication_taken'),
    'the supplement is still there, so the morning is not reported as missed');
});

test('one judge taking the ride does not take it for the next judge, or the real demo', async () => {
  const a = (await create()).json;
  const b = (await create()).json;

  const gapsA = await callTool(a.tokens.m_renee, 'get_care_gaps');
  const ride = gapsA.structuredContent.gaps.find((g: { spoken: string }) => /eye check-up/.test(g.spoken));
  await callTool(a.tokens.m_renee, 'claim_obligation', { obligationId: ride.obligationId });

  const rideIn = (hh: string) => store.getCareState(hh).obligations.find((o) => /eye check-up/.test(o.what))!;
  assert.equal(rideIn(a.householdId).ownerId, `m_renee${a.suffix}`);
  assert.equal(rideIn(b.householdId).ownerId, null, 'the next judge still sees it unowned');
  assert.equal(rideIn('h_margaret').ownerId, null, 'the real demo household is untouched');
});

test('attack: a sandbox token cannot act on another household\'s obligation', async () => {
  const a = (await create()).json;
  const real = store.getCareState('h_margaret').obligations.find((o) => /eye check-up/.test(o.what))!;
  await callTool(a.tokens.m_renee, 'claim_obligation', { obligationId: real.id });
  assert.equal(store.getObligation(real.id, 'h_margaret').ownerId, null);
});

test('the sweeper removes only expired sandboxes, oldest first at the cap, never a real household', async () => {
  const s = new CareStore();
  await seedDemoHousehold(s);
  await s.addHousehold({ id: 'h_real_family', name: 'real', timezone: 'Africa/Lagos' });
  const t0 = new Date('2026-09-23T00:00:00Z');
  const make = async (at: Date) => {
    const suffix = sandboxSuffix(at);
    await seedDemoHousehold(s, { suffix });
    return `h_margaret${suffix}`;
  };
  const old = await make(t0);
  const mid = await make(new Date(t0.getTime() + 3600_000));
  const fresh = await make(new Date(t0.getTime() + 2 * 3600_000));
  assert.ok(sandboxCreatedAt(old)! < sandboxCreatedAt(fresh)!);

  // 13h after t0 with a 12h TTL: only the oldest has expired.
  await sweepSandboxes(s, { ttlMs: 12 * 3600_000, keepAtMost: 10, now: new Date(t0.getTime() + 13 * 3600_000) });
  assert.deepEqual(s.householdIds().sort(), ['h_margaret', 'h_real_family', fresh, mid].sort());

  // At a cap of one, the older live copy goes and the newest stays.
  await sweepSandboxes(s, { ttlMs: 12 * 3600_000, keepAtMost: 1, now: new Date(t0.getTime() + 3 * 3600_000) });
  assert.deepEqual(s.householdIds().sort(), ['h_margaret', 'h_real_family', fresh].sort());
});

test('a real household id is never mistaken for a sandbox', () => {
  assert.equal(sandboxCreatedAt('h_margaret'), null);
  assert.equal(sandboxCreatedAt('h_0c7a1c1e-2b1d-4c5e-9a55-1f1e2d3c4b5a'), null);
  assert.equal(sandboxCreatedAt('h_other~abc-12345678'), null, 'only copies of the demo household');
});
