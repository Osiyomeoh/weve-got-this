import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { makePkce, verifyToken, visitorOf } from './oauth.ts';
import { sandboxOf, sandboxSuffix, sweepSandboxes, AGENT_COPY_TTL_MS } from './sandbox.ts';
import { seedScenario } from '../demo/scenario.ts';
import { agentOf } from '../mcp/agent.ts';
import { runAgentAll } from '../domain/agent-runner.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';

/**
 * Bring your own agent.
 *
 * Judges are asked to try CareCircle with their own agent: Claude, ChatGPT, Cursor,
 * whatever they use. Each connection gets its own copy of the demo family, so one
 * judge's "yes, I'll drive him" never lands in another judge's story. A second agent
 * can join the same copy with its family code, and the record says which agent carried
 * each ask and each yes, beside the person who gave it.
 */

const SECRET = 'test-agent-copies-secret';
const ISSUER = 'http://localhost';
const REDIRECT = 'https://client.example/cb';
const store = new CareStore();
let clock = new Date();
let server: Server;
let base: string;

before(async () => {
  process.env['CARECIRCLE_OAUTH_SECRET'] = SECRET;
  process.env['CARECIRCLE_PUBLIC_URL'] = ISSUER;
  await store.reset();
  await seedDemoHousehold(store);
  const app = createCareCircleApp({
    store,
    tokens: new Map(Object.entries(DEMO_TOKENS)),
    now: () => clock,
  });
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
});

function authorizeUrl(params: Record<string, string>): string {
  const p = new URLSearchParams({
    client_id: 'any-agent',
    redirect_uri: REDIRECT,
    code_challenge_method: 'S256',
    state: 'st',
    ...params,
  });
  return `${base}/oauth/authorize?${p.toString()}`;
}

/** The whole OAuth dance, as any MCP client would do it. */
async function connect(
  member: string,
  opts: { family?: string; from?: string } = {},
): Promise<{ access: string; refresh: string; memberId: string }> {
  const { verifier, challenge } = makePkce();
  const res = await fetch(
    authorizeUrl({
      code_challenge: challenge,
      member,
      ...(opts.family ? { family: opts.family } : {}),
    }),
    { redirect: 'manual', headers: opts.from ? { 'x-forwarded-for': opts.from } : {} },
  );
  assert.equal(res.status, 302, `consent should redirect, got ${res.status}`);
  const code = new URL(res.headers.get('location')!).searchParams.get('code')!;
  const tok = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    }).toString(),
  });
  assert.equal(tok.status, 200);
  const json = (await tok.json()) as { access_token: string; refresh_token: string };
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    memberId: verifyToken(json.access_token, SECRET)!.sub,
  };
}

const householdOf = (memberId: string): string => store.getMember(memberId).householdId;

const HEADERS = (token: string, sessionId?: string) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  authorization: `Bearer ${token}`,
  ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
});

/** A 2025-11-25 session, opened by a client that names itself `agent`. */
async function session(token: string, agent: string) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: HEADERS(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: agent, version: '1.0' },
      },
    }),
  });
  const id = res.headers.get('mcp-session-id')!;
  await res.text();
  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: HEADERS(token, id),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: HEADERS(token, id),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Math.floor(Math.random() * 1e6),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const body = JSON.parse(await r.text());
    return {
      spoken: (body?.result?.content?.[0]?.text ?? '') as string,
      data: (body?.result?.structuredContent ?? {}) as any,
    };
  };
}

/** The unowned eye check-up ride every copy starts with. */
async function theRide(call: Awaited<ReturnType<typeof session>>): Promise<string> {
  const gaps = (await call('get_care_gaps')).data.gaps ?? [];
  const ride = gaps.find((g: any) => /eye check-up/i.test(g.spoken) && g.obligationId);
  assert.ok(ride, 'every copy should start with the unowned ride');
  return ride.obligationId;
}

test("two agents that connect get two families: one's yes never reaches the other", async () => {
  const a = await connect('m_renee');
  const b = await connect('m_renee');
  assert.notEqual(householdOf(a.memberId), householdOf(b.memberId));
  assert.equal(sandboxOf(householdOf(a.memberId))?.kind, 'agent');

  const inA = await session(a.access, 'claude-ai');
  const inB = await session(b.access, 'openai-mcp');
  const rideA = await theRide(inA);
  await inA('claim_obligation', { obligationId: rideA });
  assert.equal(store.getObligation(rideA, householdOf(a.memberId)).ownerId, a.memberId);

  // In the other family the same ride is still nobody's, waiting for its own story.
  const rideB = await theRide(inB);
  assert.notEqual(rideA, rideB);
  assert.equal(store.getObligation(rideB, householdOf(b.memberId)).ownerId, null);
  // And the shared demo family was never touched.
  assert.ok(store.getCareState('h_margaret').obligations.every((o) => o.ownerId !== a.memberId));
});

test("a second agent joins the first one's family with its code, and the trail names both agents", async () => {
  // Tolu connects Claude. get_started tells him his family's code.
  const tolu = await connect('m_david');
  const asTolu = await session(tolu.access, 'claude-ai');
  const started = await asTolu('get_started');
  const code = started.data.familyCode as string;
  assert.match(code, /^[0-9a-f]{8}$/);
  assert.match(started.spoken, new RegExp(`family code ${code}`));

  // Funmi connects ChatGPT to the same family with it.
  const funmi = await connect('m_renee', { family: code });
  assert.equal(householdOf(funmi.memberId), householdOf(tolu.memberId));
  const asFunmi = await session(funmi.access, 'openai-mcp');

  // Tolu, in Claude, asks Funmi. She hears it in ChatGPT, with the agent it came through.
  const ride = await theRide(asTolu);
  await asTolu('request_owner', { obligationId: ride, assigneeName: 'Funmi' });
  const asked = await asFunmi('get_my_requests');
  assert.match(asked.spoken, /Tolu asked, through Claude, if you can/);
  assert.equal(asked.data.requests[0].via, 'Claude');

  // Her yes, from ChatGPT, is what makes it hers, and the trail keeps both agents.
  await asFunmi('respond_to_request', { obligationId: ride, accepted: true });
  assert.equal(store.getObligation(ride, householdOf(tolu.memberId)).ownerId, funmi.memberId);
  const trail = (await asTolu('get_provenance', { obligationId: ride })).spoken;
  assert.match(trail, /Tolu, through Claude, asked for someone to take this on/);
  assert.match(trail, /Funmi, through ChatGPT, took it on/);
});

test('a family code that names no family is refused, and the page says why', async () => {
  const { challenge } = makePkce();
  const res = await fetch(
    authorizeUrl({ code_challenge: challenge, member: 'm_renee', family: '00000000' }),
    { redirect: 'manual' },
  );
  assert.equal(res.status, 400);
  assert.match(await res.text(), /No family has that code/);
});

test('the consent page says each connection gets its own family, and offers the code', async () => {
  const { challenge } = makePkce();
  const page = await (await fetch(authorizeUrl({ code_challenge: challenge }))).text();
  assert.match(page, /your own copy of a demo family/);
  assert.match(page, /name="family"/);
  // The PKCE challenge rides along in the join form too, or joining would break the flow.
  assert.match(page, new RegExp(`name="code_challenge" value="${challenge}"`));
});

test('nothing issued for a copy outlives it', async () => {
  const started = clock;
  try {
    const c = await connect('m_renee');
    const created = sandboxOf(householdOf(c.memberId))!.createdAt;
    const ends = Math.floor((created + AGENT_COPY_TTL_MS) / 1000);
    assert.ok(verifyToken(c.refresh, SECRET)!.exp <= ends, 'refresh token ends with the copy');

    // A month on, the copy has ended: refreshing is refused so the client signs in again.
    clock = new Date(created + AGENT_COPY_TTL_MS + 60_000);
    const res = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refresh }),
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_grant');
  } finally {
    clock = started;
  }
});

test('a script cannot fill the table: new families are limited per visitor', async () => {
  const from = '198.51.100.7, 203.0.113.50';
  for (let i = 0; i < 12; i++) await connect('m_aide', { from });
  const { challenge } = makePkce();
  const refused = await fetch(authorizeUrl({ code_challenge: challenge, member: 'm_aide' }), {
    redirect: 'manual',
    headers: { 'x-forwarded-for': from },
  });
  assert.equal(refused.status, 429);
  // Somebody else is not held up by it.
  await connect('m_aide', { from: '198.51.100.8' });
});

test('on 2026-07-28 too, a record says which agent carried it', async () => {
  const c = await connect('m_margaret');
  const client = new ModernClient(
    { name: 'claude-ai', version: '1' },
    { versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(
    new ModernTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${c.access}` } },
    }),
  );
  try {
    assert.equal(client.getProtocolEra(), 'modern');
    await client.callTool({
      name: 'add_note',
      arguments: { note: 'Slept well after the drops.' },
    });
    const note = store
      .getCareState(householdOf(c.memberId))
      .events.find((e) => e.detail === 'Slept well after the drops.');
    assert.equal(note?.via, 'Claude');
    assert.equal(note?.reportedBy, c.memberId, 'the agent rides beside the person, never as them');
  } finally {
    await client.close();
  }
});

test('a console sweep never removes an agent family, nor the other way round', async () => {
  const s = new CareStore();
  await s.reset();
  const long = new Date(Date.now() - 2 * 86_400_000);
  for (const kind of ['console', 'agent'] as const) {
    const suffix = sandboxSuffix(long, kind);
    await seedDemoHousehold(s, { suffix });
    await seedScenario(s, `h_margaret${suffix}`, { suffix, now: long });
  }
  // Console copies last hours: a day-old one goes, the agent's stays.
  await sweepSandboxes(s, { ttlMs: 12 * 3600_000, keepAtMost: 200, now: new Date() });
  assert.deepEqual(
    s.householdIds().map((id) => sandboxOf(id)?.kind),
    ['agent'],
  );
});

test("CareCircle does its legwork in an agent's family, not in a console story or an ended copy", async () => {
  const s = new CareStore();
  await s.reset();
  await seedDemoHousehold(s);
  const now = new Date();
  const made: Record<string, string> = {};
  for (const [name, at, kind] of [
    ['console', now, 'console'],
    ['agent', now, 'agent'],
    ['ended', new Date(now.getTime() - AGENT_COPY_TTL_MS - 60_000), 'agent'],
  ] as const) {
    const suffix = sandboxSuffix(at, kind);
    await seedDemoHousehold(s, { suffix });
    await seedScenario(s, `h_margaret${suffix}`, { suffix, now: at, refillDueTonight: true });
    made[name] = `h_margaret${suffix}`;
  }
  const runs = await runAgentAll({ store: s, notifier: new RecordOnlyNotifier(), now: () => now });
  const ran = runs.map((r) => r.householdId).sort();
  // The console's story runs its own pass when its day gets there; an ended copy is left be.
  assert.deepEqual(ran, ['h_margaret', made['agent']!].sort());
});

test('agents are named as people know them, and only those we know', () => {
  const seen = (name: string, title?: string) => agentOf({ name, ...(title ? { title } : {}) });
  assert.equal(seen('claude-ai'), 'Claude');
  assert.equal(seen('claude-code'), 'Claude Code');
  assert.equal(seen('openai-mcp'), 'ChatGPT');
  assert.equal(seen('cursor-vscode'), 'Cursor');
  assert.equal(seen('Visual Studio Code'), 'VS Code');
  assert.equal(seen('mcp-inspector'), 'MCP Inspector');
  assert.equal(seen('Kiro'), 'Kiro');
  // Our own clients, and anything unrecognised, carry no label rather than a made-up one.
  assert.equal(seen('carecircle-telegram'), null);
  assert.equal(seen('alexa-plus-simulator'), null);
  assert.equal(seen('loop'), null);
  assert.equal(agentOf(undefined), null);
});

test('a visitor is the last public address a proxy saw, never one the client wrote', () => {
  const req = (xff?: string, socket = '10.0.0.9') => ({
    header: (h: string) => (h.toLowerCase() === 'x-forwarded-for' ? xff : undefined),
    socket: { remoteAddress: socket },
  });
  assert.equal(visitorOf(req('1.2.3.4, 203.0.113.50')), '203.0.113.50');
  // Our own proxies' private addresses are skipped.
  assert.equal(visitorOf(req('203.0.113.50, 10.1.2.3')), '203.0.113.50');
  // Straight from this machine: development, never limited.
  assert.equal(visitorOf(req(undefined, '::1')), null);
  assert.equal(visitorOf(req(undefined, '127.0.0.1')), null);
});
