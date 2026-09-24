import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCareCircleServer } from '../mcp/server.ts';
import { CareStore } from '../store/store.ts';
import { createTelegramChat } from '../http/telegram-chat.ts';
import { traceFields } from '../obs/trace.ts';
import { SimulatedAlexa, type TurnTrace } from './host.ts';
import type { Conversation, ModelProvider, ToolUse, TurnOutput } from './providers.ts';

/**
 * A turn can be read step by step: which reply asked for which tool, what came back, and
 * where the time went - and the form that reaches a log carries none of the care.
 */

/** A planner that plays back a fixed list of replies, one per model call. */
class Scripted implements ModelProvider {
  readonly name = 'scripted';
  readonly modelId = 'scripted-1';
  constructor(private readonly replies: Array<ToolUse[] | string>) {}
  start(): Conversation {
    let i = 0;
    const next = async (): Promise<TurnOutput> => {
      const r = this.replies[Math.min(i, this.replies.length - 1)]!;
      i += 1;
      return typeof r === 'string' ? { text: r, toolUses: [] } : { text: '', toolUses: r };
    };
    return { say: next, report: next };
  }
}

async function dad(): Promise<CareStore> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Joseph', role: 'care_recipient', spokenAs: 'Daddy' });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad' });
  return store;
}

async function hostFor(store: CareStore, provider: ModelProvider, channel: 'voice' | 'chat' = 'voice'): Promise<SimulatedAlexa> {
  const server = createCareCircleServer({ store, actorId: 'm_dad' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'trace-test', version: '1' });
  await client.connect(clientSide);
  return SimulatedAlexa.over(client, provider, channel);
}

const logDose = (medicationName: string): ToolUse[] => [{ id: medicationName, name: 'log_care_event', input: { kind: 'medication_taken', medicationName } }];

test('each step is recorded: the name that matched nothing, then the call that worked', async () => {
  const store = await dad();
  const host = await hostFor(store, new Scripted([logDose('colírio'), logDose('eye drops'), "Got it, I've logged the eye drops."]));
  const { trace, spoken } = await host.say('Mo ti lo colírio mi');

  assert.equal(spoken, "Got it, I've logged the eye drops.");
  assert.equal(trace.outcome, 'answered');
  assert.equal(trace.model, 'scripted-1');
  assert.equal(trace.channel, 'voice');
  assert.equal(trace.steps.length, 3, 'three model replies: call, call again, answer');
  assert.equal(trace.steps[0]!.calls[0]!.isError, true, 'the first call came back with guidance');
  assert.match(trace.steps[0]!.calls[0]!.result, /is not a name on your schedule/);
  assert.equal(trace.steps[1]!.calls[0]!.isError, false);
  assert.deepEqual(trace.steps[2]!.calls, [], 'the last reply is the answer');
  assert.ok(trace.plannerMs + trace.toolMs <= trace.totalMs + 1, 'the parts add up to no more than the whole');

  assert.deepEqual(traceFields(trace).steps, ['log_care_event:guidance', 'log_care_event:ok', 'answer']);
});

test('a planner that never stops is cut off, and the trace says so', async () => {
  const host = await hostFor(await dad(), new Scripted([[{ id: 'g', name: 'get_shift_brief', input: {} }]]));
  const { trace, spoken } = await host.say('what is happening');
  assert.equal(trace.outcome, 'step_limit');
  assert.match(spoken, /got stuck/);
  assert.equal(trace.steps.length, 7, 'six rounds of tools on a voice turn, then the reply that was cut off');
  assert.equal(traceFields(trace).steps.at(-1), 'cut_off');
  assert.equal(traceFields(trace).calls, 6);
});

test('the logged form carries no care: no words said, no medicine, no names, no results', async () => {
  const host = await hostFor(await dad(), new Scripted([logDose('eye drops'), "Got it, I've logged the eye drops."]));
  const { trace } = await host.say('Daddy used his eye drops at eight');
  const logged = JSON.stringify(traceFields(trace));
  for (const secret of ['eye drops', 'Daddy', 'Joseph', 'at eight', 'logged', 'medication_taken']) {
    assert.ok(!logged.includes(secret), `"${secret}" reached the log line: ${logged}`);
  }
});

test('the Telegram chat logs every turn without the care, and hands the full trace to whoever asked', async () => {
  const store = await dad();
  const traces: TurnTrace[] = [];
  const chat = createTelegramChat({
    store, provider: new Scripted([logDose('eye drops'), 'Done.']),
    onTrace: (memberId, trace) => { assert.equal(memberId, 'm_dad'); traces.push(trace); },
  });

  const written: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => { written.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    assert.equal(await chat('m_dad', 'I used my eye drops'), 'Done.');
  } finally { process.stdout.write = write; }

  assert.equal(traces.length, 1);
  assert.equal(traces[0]!.channel, 'chat');
  assert.equal(traces[0]!.steps[0]!.calls[0]!.name, 'log_care_event');
  const line = written.find((w) => w.includes('chat turn'));
  assert.ok(line, `no trace line was logged: ${written.join('')}`);
  assert.match(line, /log_care_event:ok/);
  assert.ok(!line.includes('eye drops') && !line.includes('I used'), `the care reached the log: ${line}`);
});
