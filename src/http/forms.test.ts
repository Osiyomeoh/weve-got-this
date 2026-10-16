import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernTransport,
} from '@modelcontextprotocol/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { DynamoPersistence } from '../store/dynamo.ts';
import { fakeTable, type FakeTable } from '../store/fake-table.ts';

/**
 * A yes that comes from the person, not the model (mcp/elicit.ts).
 *
 * On a client that can show a form, taking work on and saying yes to an ask are answered by
 * what the person presses there; the model's call only puts the question in front of them.
 * Both protocol eras: 2025-11-25 sends the form while the call is open; 2026-07-28 answers
 * input_required and believes the retry only with the state it signed. A client without
 * forms is answered exactly as before, and a no never waits on a form.
 */

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

const NOW = new Date('2026-10-16T12:00:00Z');
const TOKENS = new Map([
  ['tolu', 'm_tolu'],
  ['funmi', 'm_funmi'],
]);
const RIDE = 'obl_ride';

async function seeded(): Promise<FakeTable> {
  const table = fakeTable();
  const store = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await store.init();
  store.useClock(() => NOW);
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
    id: RIDE,
    householdId: 'h',
    what: 'Drive Daddy to the eye clinic',
    status: 'OPEN',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_tolu', at: NOW.toISOString() },
    ownerId: null,
    dueAt: '2026-10-17T09:00:00Z',
  });
  return table;
}

async function instance(table: FakeTable): Promise<{ url: string; store: CareStore }> {
  const store = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await store.init();
  const server = createCareCircleApp({ store, now: () => NOW, tokens: TOKENS }).listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`, store };
}

type Press = { action: 'accept'; content: { answer: 'yes' | 'no' } } | { action: 'cancel' };
const YES: Press = { action: 'accept', content: { answer: 'yes' } };
const NOT_NOW: Press = { action: 'accept', content: { answer: 'no' } };
const CLOSED: Press = { action: 'cancel' };

/** A 2025-11-25 client. With `press`, it can show forms and answers each one that way. */
async function legacy(url: string, token: string, press?: () => Press) {
  const shown: { message: string; choices: string[] }[] = [];
  const client = new Client(
    { name: 'forms-test', version: '1' },
    press ? { capabilities: { elicitation: { form: {} } } } : {},
  );
  if (press) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      const p = req.params as {
        message: string;
        requestedSchema: { properties: { answer: { oneOf: { title: string }[] } } };
      };
      shown.push({
        message: p.message,
        choices: p.requestedSchema.properties.answer.oneOf.map((c) => c.title),
      });
      return press();
    });
  }
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return { client, shown };
}

/** A 2026-07-28 client, each request to the next instance in turn. */
async function modern(urls: string[], token: string, press?: () => Press) {
  const shown: string[] = [];
  let n = 0;
  const client = new ModernClient(
    { name: 'forms-test', version: '1' },
    {
      versionNegotiation: { mode: 'auto' },
      ...(press ? { capabilities: { elicitation: { form: {} } } } : {}),
    },
  );
  if (press) {
    client.setRequestHandler('elicitation/create', async (req) => {
      shown.push((req.params as { message: string }).message);
      return press();
    });
  }
  await client.connect(
    new ModernTransport(new URL(urls[0]!), {
      fetch: (_input, init) => fetch(urls[n++ % urls.length]!, init),
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return { client, shown };
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const isError = (r: unknown) => (r as { isError?: boolean }).isError === true;

async function askFunmi(url: string): Promise<void> {
  const { client } = await legacy(url, 'tolu');
  const asked = await client.callTool({
    name: 'request_owner',
    arguments: { obligationId: RIDE, assigneeName: 'Funmi' },
  });
  assert.ok(!isError(asked), text(asked));
  await client.close();
}

test('2025-11-25: the yes to an ask is what the person presses on the form', async () => {
  const { url, store } = await instance(await seeded());
  await askFunmi(url);
  const { client, shown } = await legacy(url, 'funmi', () => YES);

  const r = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: true },
  });
  assert.match(text(r), /that's yours now/);
  assert.equal(shown.length, 1);
  assert.match(shown[0]!.message, /Tolu asked/);
  assert.match(shown[0]!.message, /Drive Daddy to the eye clinic/);
  assert.deepEqual(shown[0]!.choices, ["Yes, I'll do it", 'Not this time']);

  assert.equal(store.getObligation(RIDE, 'h').ownerId, 'm_funmi');
  await client.close();

  // The family's page of promises says whose hand the yes came from.
  const tolu = await legacy(url, 'tolu');
  const week = await tolu.client.callTool({ name: 'get_promises', arguments: {} });
  const steps = (
    week.structuredContent as { promises: { steps: { detail: string }[] }[] }
  ).promises[0]!.steps.map((s) => s.detail);
  assert.ok(steps.includes('Funmi pressed Yes at 1:00 PM.'), steps.join(' | '));
  await tolu.client.close();
});

test('2025-11-25: "Not this time" on the form is their own no, even though the model heard yes', async () => {
  const { url, store } = await instance(await seeded());
  await askFunmi(url);
  const { client } = await legacy(url, 'funmi', () => NOT_NOW);

  const r = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: true },
  });
  assert.match(text(r), /back with no owner/);
  const o = store.getObligation(RIDE, 'h');
  assert.equal(o.status, 'OPEN');
  assert.deepEqual(o.declinedBy, ['m_funmi']);
  await client.close();
});

test('2025-11-25: a form closed without an answer saves nothing, and the ask stays open', async () => {
  const { url, store } = await instance(await seeded());
  await askFunmi(url);
  const { client } = await legacy(url, 'funmi', () => CLOSED);

  const r = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: true },
  });
  assert.ok(isError(r));
  assert.match(text(r), /nothing was saved/);
  const o = store.getObligation(RIDE, 'h');
  assert.equal(o.status, 'REQUESTED');
  assert.equal(o.ownerId, null);
  await client.close();
});

test('2025-11-25: a no never waits on a form', async () => {
  const { url, store } = await instance(await seeded());
  await askFunmi(url);
  const { client, shown } = await legacy(url, 'funmi', () => YES);

  const r = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: false },
  });
  assert.match(text(r), /back with no owner/);
  assert.equal(shown.length, 0);
  assert.equal(store.getObligation(RIDE, 'h').status, 'OPEN');
  await client.close();
});

test('2025-11-25: taking work on is the Yes on the form; "Not now" leaves it open', async () => {
  const { url, store } = await instance(await seeded());
  let answer = NOT_NOW;
  const { client, shown } = await legacy(url, 'funmi', () => answer);

  const no = await client.callTool({ name: 'claim_obligation', arguments: { obligationId: RIDE } });
  assert.match(text(no), /still open/);
  assert.equal(store.getObligation(RIDE, 'h').ownerId, null);

  answer = YES;
  const yes = await client.callTool({
    name: 'claim_obligation',
    arguments: { obligationId: RIDE },
  });
  assert.match(text(yes), /is yours/);
  assert.equal(store.getObligation(RIDE, 'h').ownerId, 'm_funmi');
  assert.equal(shown.length, 2);
  assert.deepEqual(shown[0]!.choices, ["Yes, it's mine", 'Not now']);
  assert.equal(store.getTransitions(RIDE).at(-1)!.onForm, true);
  await client.close();
});

test('2025-11-25: "still on?" is answered on the form too, and "can\'t" hands it back', async () => {
  const { url, store } = await instance(await seeded());
  const spoken = await legacy(url, 'funmi');
  await spoken.client.callTool({ name: 'claim_obligation', arguments: { obligationId: RIDE } });
  await spoken.client.close();

  let answer = YES;
  const { client, shown } = await legacy(url, 'funmi', () => answer);
  const kept = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: true },
  });
  assert.match(text(kept), /stays with you/);
  assert.match(shown[0]!.message, /Is this still on\?/);
  assert.deepEqual(shown[0]!.choices, ['Yes, still on', "Can't make it after all"]);
  const stillOn = store.getCareState('h').events.find((e) => e.kind === 'request_answered');
  assert.equal(stillOn?.data['onForm'], true);

  answer = NOT_NOW;
  const back = await client.callTool({
    name: 'respond_to_request',
    arguments: { obligationId: RIDE, accepted: true },
  });
  assert.match(text(back), /back with no owner/);
  assert.equal(store.getObligation(RIDE, 'h').ownerId, null);
  await client.close();
});

test('2025-11-25: a client without forms is answered as before, in plain JSON', async () => {
  const { url, store } = await instance(await seeded());
  const { client } = await legacy(url, 'funmi');
  const r = await client.callTool({ name: 'claim_obligation', arguments: { obligationId: RIDE } });
  assert.match(text(r), /is yours/);
  assert.equal(store.getTransitions(RIDE).at(-1)!.onForm, undefined);
  await client.close();

  // Only a session whose client says it can show forms gets streamed answers.
  const init = (capabilities: object) =>
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer funmi',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities,
          clientInfo: { name: 'raw', version: '1' },
        },
      }),
    });
  const plain = await init({});
  assert.match(plain.headers.get('content-type') ?? '', /application\/json/);
  await plain.body?.cancel();
  const forms = await init({ elicitation: {} });
  assert.match(forms.headers.get('content-type') ?? '', /text\/event-stream/);
  await forms.body?.cancel();
});

test('2026-07-28: the form rides input_required, and the signed retry lands on either instance', async () => {
  const table = await seeded();
  const a = await instance(table);
  const b = await instance(table);
  const { client, shown } = await modern([a.url, b.url], 'funmi', () => YES);
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');

  const r = await client.callTool({ name: 'claim_obligation', arguments: { obligationId: RIDE } });
  assert.match(text(r), /is yours/);
  assert.equal(shown.length, 1);
  assert.match(shown[0]!, /Take this on\?/);
  await client.close();
});

test('2026-07-28: an answer the server never asked for is not believed', async () => {
  const { url, store } = await instance(await seeded());
  const { client } = await modern([url], 'funmi');
  // A client that claims forms on this one call, and sends a "yes" it was never asked for.
  const forged = await client.callTool(
    {
      name: 'claim_obligation',
      arguments: { obligationId: RIDE },
      inputResponses: { answer: YES },
      _meta: { 'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } } },
    } as never,
    { allowInputRequired: true } as never,
  );
  assert.equal((forged as { resultType?: string }).resultType, 'input_required');
  assert.equal(store.getObligation(RIDE, 'h').ownerId, null);

  // And one whose signed state was altered is refused outright.
  const state = (forged as { requestState: string }).requestState;
  const tampered = state.slice(0, -2) + (state.endsWith('A') ? 'BB' : 'AA');
  await assert.rejects(
    client.callTool(
      {
        name: 'claim_obligation',
        arguments: { obligationId: RIDE },
        inputResponses: { answer: YES },
        requestState: tampered,
        _meta: { 'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } } },
      } as never,
      { allowInputRequired: true } as never,
    ),
  );
  assert.equal(store.getObligation(RIDE, 'h').ownerId, null);
  await client.close();
});

test('2026-07-28: a client without forms is answered as before', async () => {
  const { url, store } = await instance(await seeded());
  const { client } = await modern([url], 'funmi');
  const r = await client.callTool({ name: 'claim_obligation', arguments: { obligationId: RIDE } });
  assert.match(text(r), /is yours/);
  assert.equal(store.getTransitions(RIDE).at(-1)!.onForm, undefined);
  await client.close();
});
