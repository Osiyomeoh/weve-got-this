import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CareStore } from '../store/store.ts';
import { createCareCircleServer } from '../mcp/server.ts';
import { seedDemoHousehold } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { BLAME } from '../domain/no-blame.ts';
import { StrandsAlexa } from './host.ts';
import { STALE_NOTE } from '../sim/host.ts';
import { ONLY_THE_RECORD } from './no-blame.ts';
import type { Message } from '@strands-agents/sdk';
import { ScriptedModel, textIn, type Step } from './scripted-model.ts';

/**
 * The Strands planner against the real server: a seeded family, the real tools over MCP,
 * the Strands agent loop, and a scripted model in place of Bedrock so every turn is exact.
 * Half past nine in the evening in Lagos: Daddy's evening eye drops have no record.
 */

const NOW = new Date('2026-10-01T20:30:00Z');

async function planner(steps: Step[], actorId = 'm_david') {
  const store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret', { now: NOW });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createCareCircleServer({ store, actorId, now: () => NOW }).connect(serverSide);
  const model = new ScriptedModel(steps);
  const host = await StrandsAlexa.over(clientSide, { model, now: () => NOW });
  return { host, model, store };
}

/** Say back what the last tool said, as the prompt tells the model to. */
const echo: Step = (messages) => ({ say: textIn(messages.at(-1)) });
const corrected = (messages: Message[]) =>
  textIn(messages.at(-1)).includes("[We've Got This check");

test('the planner calls the real tools over MCP and speaks what they say', async () => {
  const { host } = await planner([{ tool: 'get_care_summary' }, echo]);
  try {
    const turn = await host.say('How is Daddy doing today?');
    assert.equal(turn.toolCalls[0]?.name, 'get_care_summary');
    assert.equal(turn.toolCalls[0]?.isError, false);
    assert.match(turn.spoken, /no record/i, 'the evening drops are spoken of as unrecorded');
    assert.doesNotMatch(turn.spoken, BLAME);
    assert.deepEqual(turn.noBlame, { caught: [], corrected: false, replaced: false });
    assert.equal(turn.trace.outcome, 'answered');
    assert.equal(turn.trace.steps.length, 2, 'one reply asked for the tool, one answered');
    assert.equal(turn.trace.steps[0]?.calls[0]?.name, 'get_care_summary');
  } finally {
    await host.close();
  }
});

test('the planner knows who is speaking and where the family lives, from the server', async () => {
  const { host, model } = await planner([{ say: 'Hello.' }], 'm_renee');
  try {
    await host.say('Hi');
    assert.equal(textIn(model.seen[0]?.[0]), 'Hi');
    const prompt = model.prompts[0] ?? '';
    assert.match(prompt, /You are speaking with Funmi, the caregiver in this household/);
    assert.match(prompt, /this household is in Africa\/Lagos/);
    assert.match(prompt, /Today is Thursday, October 1, 2026 at 9:30 PM/);
    assert.match(prompt, /Never say someone did not take a medication/);
  } finally {
    await host.close();
  }
});

test('a reply that says Daddy missed his drops is sent back, and the corrected one is spoken', async () => {
  const { host, model } = await planner([
    { tool: 'get_care_summary' },
    { say: 'Daddy missed his evening eye drops.' },
    (messages) =>
      corrected(messages)
        ? { say: "There's no record of Daddy's evening eye drops yet." }
        : { say: 'Daddy missed his evening eye drops.' },
    { say: 'You are welcome.' },
  ]);
  try {
    const turn = await host.say('Did Daddy take his evening drops?');
    assert.equal(turn.spoken, "There's no record of Daddy's evening eye drops yet.");
    assert.deepEqual(turn.noBlame, { caught: ['missed'], corrected: true, replaced: false });

    // Neither the blaming reply nor the correction is left in the conversation.
    await host.say('Thanks');
    const history = model.seen
      .at(-1)!
      .map((m) => textIn(m))
      .join('\n');
    assert.doesNotMatch(history, BLAME);
    assert.doesNotMatch(history, /We've Got This check/);
    assert.match(history, /no record of Daddy's evening eye drops yet/);
  } finally {
    await host.close();
  }
});

test('a model that blames twice is not asked a third time: what the tools said is spoken', async () => {
  const { host, model } = await planner([
    { tool: 'get_care_summary' },
    { say: 'He missed his drops tonight.' },
    { say: 'He forgot his evening drops.' },
    { say: 'He skipped them, I am sure.' },
  ]);
  try {
    const turn = await host.say('Did Daddy take his evening drops?');
    assert.deepEqual(turn.noBlame, {
      caught: ['missed', 'forgot'],
      corrected: false,
      replaced: true,
    });
    assert.equal(turn.spoken, turn.toolCalls[0]!.result, 'the summary, word for word');
    assert.match(turn.spoken, /no record/i);
    assert.doesNotMatch(turn.spoken, BLAME);
    assert.equal(
      model.seen.length,
      3,
      'the tool call, the first reply, the one retry: no third ask',
    );
  } finally {
    await host.close();
  }
});

test("a refused tool's words are for the model, so they are never the fallback", async () => {
  // Daddy cannot read the full record; the refusal tells the model which tool to call
  // instead, in words that would be wrong said aloud. Seen on Nova Pro: "Have I missed
  // anything today?" was answered with the refusal, instruction and all.
  const { host } = await planner(
    [{ tool: 'get_care_gaps' }, { say: 'You missed your drops.' }, { say: 'You forgot them.' }],
    'm_margaret',
  );
  try {
    const turn = await host.say('Have I missed anything today?');
    assert.equal(turn.toolCalls[0]!.isError, true);
    assert.equal(turn.noBlame.replaced, true);
    assert.equal(turn.spoken, ONLY_THE_RECORD);
  } finally {
    await host.close();
  }
});

test('with no tool result to fall back on, only what the record can say is spoken', async () => {
  const { host } = await planner([
    { say: "He didn't take his drops." },
    { say: "He hasn't taken them." },
  ]);
  try {
    const turn = await host.say('Did he take them?');
    assert.equal(turn.spoken, ONLY_THE_RECORD);
    assert.doesNotMatch(ONLY_THE_RECORD, BLAME);
    assert.deepEqual(turn.noBlame.caught, ["didn't take", "hasn't taken"]);
  } finally {
    await host.close();
  }
});

test("a model's inline reasoning is not spoken", async () => {
  const { host } = await planner([
    { tool: 'get_care_summary' },
    {
      say: "<thinking>I should read Tolu the summary.</thinking> There's no record of Daddy's evening eye drops yet.",
    },
  ]);
  try {
    const turn = await host.say('How is Daddy?');
    assert.equal(turn.spoken, "There's no record of Daddy's evening eye drops yet.");
  } finally {
    await host.close();
  }
});

test('a turn that changed the record is never answered with silence', async () => {
  const { host } = await planner(
    [
      { tool: 'log_care_event', input: { kind: 'medication_taken', medicationName: 'eye drops' } },
      { say: '<thinking>Logged it.</thinking>' },
    ],
    'm_margaret',
  );
  try {
    const turn = await host.say('Did I take my evening drops?');
    assert.equal(turn.spoken, turn.toolCalls[0]!.result);
    assert.match(turn.spoken, /logged/);
  } finally {
    await host.close();
  }
});

test('a tool called twice is said once when the reply falls back to it', async () => {
  const { host } = await planner([
    { tool: 'get_care_summary' },
    { tool: 'get_care_summary' },
    { say: 'He missed his drops tonight.' },
    { say: 'He forgot his evening drops.' },
  ]);
  try {
    const turn = await host.say('Who forgot to give Daddy his drops?');
    assert.equal(turn.noBlame.replaced, true);
    assert.equal(turn.toolCalls.length, 2);
    assert.equal(turn.spoken, turn.toolCalls[0]!.result);
  } finally {
    await host.close();
  }
});

test('the plugin resets every turn', async () => {
  const { host } = await planner([
    { say: 'He missed it.' },
    { say: 'There is no record of it.' },
    { say: 'Hello again.' },
  ]);
  try {
    assert.equal((await host.say('a')).noBlame.corrected, true);
    assert.deepEqual((await host.say('b')).noBlame, {
      caught: [],
      corrected: false,
      replaced: false,
    });
  } finally {
    await host.close();
  }
});

test('a model that never stops calling tools is cut off and says so', async () => {
  const { host } = await planner(Array.from({ length: 20 }, () => ({ tool: 'get_care_gaps' })));
  try {
    const turn = await host.say('What is open?');
    assert.equal(turn.trace.outcome, 'step_limit');
    assert.match(turn.spoken, /got stuck/);
    assert.ok(turn.toolCalls.length <= 7, `${turn.toolCalls.length} tool calls`);
  } finally {
    await host.close();
  }
});

test('a tool error is passed to the model as an error, and the turn goes on', async () => {
  const { host } = await planner([
    { tool: 'claim_obligation', input: { obligationId: 'o_nothing' } },
    echo,
  ]);
  try {
    const turn = await host.say('I will take that one');
    assert.equal(turn.toolCalls[0]?.isError, true);
    assert.ok(turn.spoken.length > 0);
    assert.doesNotMatch(turn.spoken, /undefined|\[object Object\]/);
  } finally {
    await host.close();
  }
});

test('every turn after the first tells the model the record may have changed', async () => {
  const { host, model } = await planner([{ say: 'Hello.' }, { say: 'Let me check again.' }]);
  try {
    await host.say('Hi');
    await host.say('Did Daddy use his drops?');
    assert.equal(textIn(model.seen[0]?.at(-1)), 'Hi', 'the first turn is sent as said');
    const second = textIn(model.seen[1]?.at(-1));
    assert.ok(second.startsWith(STALE_NOTE), 'the second turn carries the reminder');
    assert.match(second, /Did Daddy use his drops\?$/);
  } finally {
    await host.close();
  }
});
