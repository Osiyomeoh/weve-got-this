import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { createTelegramChat } from './telegram-chat.ts';
import type { Conversation, ModelProvider, ToolResult, TurnOutput } from '../sim/providers.ts';

/** A planner that logs a dose on the first turn, then says what the tool said. */
class ScriptedProvider implements ModelProvider {
  readonly name = 'scripted';
  readonly modelId = 'scripted';
  start(): Conversation {
    return {
      say: async (): Promise<TurnOutput> => ({
        text: '', toolUses: [{ id: 't1', name: 'log_care_event', input: { kind: 'medication_taken', medicationName: 'eye drops' } }],
      }),
      report: async (results: ToolResult[]): Promise<TurnOutput> => ({ text: results[0]!.text, toolUses: [] }),
    };
  }
}

test('a Telegram message is recorded as the member Telegram says sent it', async () => {
  const store = new CareStore();
  await store.addHousehold({ id: 'h1', name: 'circle', timezone: 'Africa/Lagos' });
  await store.addMember({ id: 'm_dad', householdId: 'h1', name: 'Joseph', role: 'care_recipient', spokenAs: 'Daddy' });
  await store.addMedication({ id: 'med_eye', householdId: 'h1', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad' });

  const chat = createTelegramChat({ store, provider: new ScriptedProvider() });
  const reply = await chat('m_dad', 'I used my eye drops');

  const logged = store.getCareState('h1').events.find((e) => e.kind === 'medication_taken')!;
  assert.equal(logged.reportedBy, 'm_dad');
  assert.equal(logged.data['medicationId'], 'med_eye');
  assert.match(reply, /eye drops/i);
});
