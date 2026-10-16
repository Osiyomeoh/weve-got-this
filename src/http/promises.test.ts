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
import { PROMISES_HTML } from '../mcp/app/promises-card.ts';
import { APP_MIME_TYPE } from '../mcp/app/protocol.ts';
import { PROMISES_URI } from '../mcp/toolkit.ts';
import { blameIn } from '../domain/no-blame.ts';

/**
 * This week's promises, end to end through the real SDK client: an ask, a yes, an
 * "on my way" to a check-in, and a done, each heard back in the family's own words,
 * with the structured result checked against its declared schema as a host checks it.
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

async function connect(token: string): Promise<Client> {
  const c = new Client({ name: 'promises-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return c;
}

async function call(token: string, name: string, args: Record<string, unknown> = {}) {
  const c = await connect(token);
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

const nameOf = (id: string) => {
  const m = store.getMember(id);
  return m.spokenAs ?? m.name;
};

type Promise_ = { obligationId: string; stage: string; spoken: string; steps: { kind: string }[] };
const mine = (out: { structured: Record<string, unknown> }, id: string) =>
  (out.structured['promises'] as Promise_[]).find((p) => p.obligationId === id);

test('an ask, a yes, a "still on", a done: each heard back as the family said it', async () => {
  const o = await store.createObligation({
    householdId: 'h_margaret',
    what: 'Collect the new eye shield',
    consequence: 'medical',
    status: 'OPEN',
    ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_david', at: new Date().toISOString() },
    dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString(),
  });
  const helper = nameOf('m_renee');

  const ask = await call('david-token', 'request_owner', {
    obligationId: o.id,
    assigneeName: helper,
  });
  assert.equal(ask.isError, false, ask.text);
  const before = await call('david-token', 'get_promises');
  assert.equal(mine(before, o.id), undefined, 'an ask is not a promise');

  const yes = await call('renee-token', 'respond_to_request', {
    obligationId: o.id,
    accepted: true,
  });
  assert.equal(yes.isError, false, yes.text);
  const promised = await call('david-token', 'get_promises');
  assert.equal(promised.isError, false, promised.text);
  assert.equal(mine(promised, o.id)?.stage, 'promised');
  assert.match(
    mine(promised, o.id)!.spoken,
    new RegExp(`^${helper} said yes to collect the new eye shield, due `),
  );
  assert.match(promised.text, /promises? this week\./);

  const still = await call('renee-token', 'respond_to_request', {
    obligationId: o.id,
    accepted: true,
  });
  assert.equal(still.isError, false, still.text);
  const stillOn = await call('david-token', 'get_promises');
  assert.equal(mine(stillOn, o.id)?.stage, 'still_on');
  assert.match(mine(stillOn, o.id)!.spoken, /, and said it's still on at /);

  const done = await call('renee-token', 'resolve_obligation', { obligationId: o.id });
  assert.equal(done.isError, false, done.text);
  const after = await call('david-token', 'get_promises');
  const p = mine(after, o.id)!;
  assert.equal(p.stage, 'done');
  assert.deepEqual(
    p.steps.map((s) => s.kind),
    ['asked', 'yes', 'still_on', 'done'],
  );
  assert.equal(blameIn(after.text), null);
});

test('the whole family’s week is for caregivers, not a shift helper', async () => {
  const out = await call('aide-token', 'get_promises');
  assert.equal(out.isError, true, out.text);
});

test('on a host that can draw, the week renders as its own card', async () => {
  const c = await connect('david-token');
  try {
    const { tools } = await c.listTools();
    const tool = tools.find((t) => t.name === 'get_promises')!;
    assert.equal((tool._meta?.['ui'] as { resourceUri: string }).resourceUri, PROMISES_URI);
    assert.equal(tool.annotations?.readOnlyHint, true);
    const res = await c.readResource({ uri: PROMISES_URI });
    const content = res.contents[0] as { mimeType: string; text: string };
    assert.equal(content.mimeType, APP_MIME_TYPE);
    assert.equal(content.text, PROMISES_HTML);
    // Self-contained: nothing for a host to allowlist, nothing fetched from anywhere.
    assert.doesNotMatch(PROMISES_HTML, /https?:\/\/|<link\b|src=/);
    // Read-only: the card shows promises, it never makes one.
    assert.doesNotMatch(PROMISES_HTML, /claim_obligation|respond_to_request|resolve_obligation/);
  } finally {
    await c.close();
  }
});
