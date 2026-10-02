import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { CareStore } from '../store/store.ts';
import { DynamoPersistence } from '../store/dynamo.ts';
import { fakeTable } from '../store/fake-table.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { BLAME } from '../domain/no-blame.ts';
import { createAgentRuntime, SESSION_HEADER, type InvocationReply } from './runtime.ts';
import { ScriptedModel, textIn, type Step } from './scripted-model.ts';

/**
 * The planner as AgentCore Runtime runs it: the HTTP contract (GET /ping, POST /invocations,
 * the session header), a seeded family, the real MCP server in-process, and a scripted model
 * in place of Bedrock. Half past nine in the evening in Lagos; the evening drops unrecorded.
 */

const NOW = new Date('2026-10-01T20:30:00Z');
const servers: Server[] = [];
afterEach(() => { for (const s of servers.splice(0)) s.close(); });

async function seeded(): Promise<CareStore> {
  const store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret', { now: NOW });
  return store;
}

async function runtime(store: CareStore, steps: Step[]) {
  const model = new ScriptedModel(steps);
  const server = createAgentRuntime({ store, model, now: () => NOW }).listen(0);
  servers.push(server);
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const invoke = async (body: unknown, session = 'session-0000000000000000000000000001') => {
    const res = await fetch(`${base}/invocations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SESSION_HEADER]: session },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as InvocationReply & { error?: string } };
  };
  return { base, model, invoke };
}

const echo: Step = (messages) => ({ say: textIn(messages.at(-1)) });

test('ping answers in the shape AgentCore expects', async () => {
  const { base } = await runtime(await seeded(), []);
  const body = await (await fetch(`${base}/ping`)).json() as { status: string; time_of_last_update: number };
  assert.equal(body.status, 'Healthy');
  assert.ok(Number.isInteger(body.time_of_last_update));
});

test('an invocation runs the real tools as the member speaking and returns what is spoken', async () => {
  const { invoke } = await runtime(await seeded(), [{ tool: 'get_care_summary' }, echo]);
  const { status, body } = await invoke({ prompt: 'How is Daddy doing today?', actorId: 'm_david' });
  assert.equal(status, 200);
  assert.equal(body.outcome, 'answered');
  assert.deepEqual(body.tools, [{ name: 'get_care_summary', isError: false }]);
  assert.match(body.spoken, /no record/i);
  assert.deepEqual(body.noBlame, { caught: [], corrected: false, replaced: false });
});

test('a reply that blames is never returned', async () => {
  const { invoke } = await runtime(await seeded(), [
    { tool: 'get_care_summary' },
    { say: 'Daddy missed his evening eye drops.' },
    { say: 'He forgot them, I am afraid.' },
  ]);
  const { body } = await invoke({ prompt: 'Did Daddy miss his evening drops?', actorId: 'm_david' });
  assert.doesNotMatch(body.spoken, BLAME);
  assert.deepEqual(body.noBlame, { caught: ['missed', 'forgot'], corrected: false, replaced: true });
});

test('a session keeps its conversation; another session starts its own', async () => {
  const { invoke, model } = await runtime(await seeded(), [
    { say: 'Hello David.' }, { say: 'Still here.' }, { say: 'Hello again.' },
  ]);
  await invoke({ prompt: 'Hi', actorId: 'm_david' }, 'session-a-00000000000000000000000000000');
  await invoke({ prompt: 'Are you there?', actorId: 'm_david' }, 'session-a-00000000000000000000000000000');
  await invoke({ prompt: 'Hi', actorId: 'm_david' }, 'session-b-00000000000000000000000000000');
  assert.equal(model.seen[1]?.length, 3, 'the second turn saw the first, and its reply');
  assert.equal(model.seen[2]?.length, 1, 'the new session saw only its own utterance');
});

test('two members on one session do not share a conversation', async () => {
  const { invoke, model } = await runtime(await seeded(), [{ say: 'Hello David.' }, { say: 'Hello Funmi.' }]);
  await invoke({ prompt: 'Hi', actorId: 'm_david' });
  await invoke({ prompt: 'Hi', actorId: 'm_renee' });
  assert.equal(model.seen[1]?.length, 1);
  assert.match(model.prompts[1] ?? '', /You are speaking with Funmi/);
});

test('bad requests are refused before any model call', async () => {
  const { invoke, model } = await runtime(await seeded(), []);
  assert.equal((await invoke({ actorId: 'm_david' })).status, 400);
  assert.equal((await invoke({ prompt: '   ', actorId: 'm_david' })).status, 400);
  assert.equal((await invoke({ prompt: 'x'.repeat(2_001), actorId: 'm_david' })).status, 400);
  assert.equal((await invoke({ prompt: 'Hi' })).status, 400);
  const unknown = await invoke({ prompt: 'Hi', actorId: 'm_nobody' });
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(unknown.body.error ?? '', /m_nobody/, 'the id is not echoed back');
  assert.equal(model.seen.length, 0);
});

test('a family written by another writer after start-up is read before the turn', async () => {
  const table = fakeTable();
  const mine = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await mine.init();
  const { invoke } = await runtime(mine, [{ say: 'Hello David.' }]);

  // The MCP server, or a script, writes the family after this runtime came up.
  const other = new CareStore(new DynamoPersistence({ tableName: 't', client: table.client }));
  await other.init();
  await seedDemoHousehold(other);

  const { status, body } = await invoke({ prompt: 'Hi', actorId: 'm_david' });
  assert.equal(status, 200, body.error);
  assert.equal(body.spoken, 'Hello David.');
});
