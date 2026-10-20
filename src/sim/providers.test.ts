import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BedrockRuntimeClient,
  type ConverseCommand,
  type ConverseCommandOutput,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { BedrockProvider, repairToolName } from './providers.ts';

const known = new Set(['get_care_summary', 'get_care_gaps']);

test('a known tool with markup after it is that tool', () => {
  assert.equal(repairToolName('get_care_summary', known), 'get_care_summary');
  assert.equal(repairToolName('get_care_summary" />', known), 'get_care_summary');
  assert.equal(repairToolName('get_care_gaps>', known), 'get_care_gaps');
});

test('any other name keeps only what Bedrock accepts, so it fails as an unknown tool', () => {
  assert.equal(repairToolName('<get summary>', known), 'getsummary');
  assert.equal(repairToolName('" />', known), 'unknown_tool');
});

test('the history carries the repaired name, so the next request is accepted', async (t) => {
  // Two model calls: the tool call Sonnet 4.5 was seen making, then an answer.
  const replies: ConverseCommandOutput[] = [
    {
      output: {
        message: {
          role: 'assistant',
          content: [{ toolUse: { toolUseId: 't1', name: 'get_care_summary" />', input: {} } }],
        },
      },
      stopReason: 'tool_use',
    } as ConverseCommandOutput,
    {
      output: { message: { role: 'assistant', content: [{ text: 'He is doing well.' }] } },
      stopReason: 'end_turn',
    } as ConverseCommandOutput,
  ];
  const sent: Message[][] = [];
  t.mock.method(BedrockRuntimeClient.prototype, 'send', async (command: ConverseCommand) => {
    sent.push(structuredClone(command.input.messages ?? []));
    return replies.shift();
  });

  const conversation = new BedrockProvider({ region: 'us-east-1', modelId: 'm' }).start('', [
    { name: 'get_care_summary', description: '', inputSchema: { type: 'object' } },
  ]);
  const first = await conversation.say('How is Daddy doing today?');
  assert.deepEqual(
    first.toolUses.map((u) => u.name),
    ['get_care_summary'],
  );
  const second = await conversation.report([
    { id: 't1', name: 'get_care_summary', text: '{}', isError: false },
  ]);
  assert.equal(second.text, 'He is doing well.');
  assert.equal(sent[1]![1]!.content![0]!.toolUse!.name, 'get_care_summary');
});
