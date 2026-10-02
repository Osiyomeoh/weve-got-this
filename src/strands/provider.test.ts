import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrandsProvider } from './provider.ts';
import { ScriptedModel } from './scripted-model.ts';

const TOOLS = [
  { name: 'get_care_gaps', description: 'What is open.', inputSchema: { type: 'object', properties: {} } },
  { name: 'claim_obligation', description: 'Take something on.', inputSchema: { type: 'object', properties: { obligationId: { type: 'string' } } } },
];

test('the first reply is measured, its tool call reported and not run', async () => {
  const model = new ScriptedModel([{ tool: 'claim_obligation', input: { obligationId: 'o_ride' } }, { say: 'never reached' }]);
  const out = await new StrandsProvider(model).start('You are Alexa.', TOOLS).say('I can take Daddy on Thursday');
  assert.deepEqual(out.toolUses.map((u) => [u.name, u.input]), [['claim_obligation', { obligationId: 'o_ride' }]]);
  assert.equal(model.seen.length, 1, 'stopped after the first reply');
  assert.equal(model.prompts[0], 'You are Alexa.');
});

test('a reply with no tool is measured as no tool', async () => {
  const model = new ScriptedModel([{ say: 'Hello!' }]);
  const out = await new StrandsProvider(model).start('You are Alexa.', TOOLS).say('Hi');
  assert.deepEqual(out, { text: 'Hello!', toolUses: [] });
});

test('each case is its own conversation', async () => {
  const model = new ScriptedModel([{ tool: 'get_care_gaps' }, { tool: 'get_care_gaps' }]);
  const provider = new StrandsProvider(model);
  await provider.start('s', TOOLS).say('one');
  await provider.start('s', TOOLS).say('two');
  assert.equal(model.seen[1]?.length, 1, 'the second case saw only its own utterance');
});
