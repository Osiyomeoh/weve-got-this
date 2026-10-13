import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFacts, parseTodos, beeTodoToProposal, beeFactToObservation } from './bee.ts';

test('parseTodos reads id/text/completed and normalises epoch-ms alarm_at to ISO', () => {
  const todos = parseTodos({
    todos: [
      {
        id: 't1',
        text: 'Pick up prescription Friday',
        completed: false,
        alarm_at: 1_760_000_000_000,
      },
      { id: 't2', title: 'Call the pharmacy', completed: true },
      { uuid: 't3', text: 'no id field but has uuid', completed: false },
      { text: 'no id at all - dropped' },
      'garbage',
    ],
  });
  assert.equal(todos.length, 3);
  assert.equal(todos[0]!.alarmAt, new Date(1_760_000_000_000).toISOString());
  assert.equal(todos[1]!.completed, true);
  assert.equal(todos[2]!.id, 't3');
});

test('parseFacts tolerates a bare array and alternate field names', () => {
  const facts = parseFacts([
    { id: 'f1', text: 'Her cardiology appointment is the 24th', confirmed: true },
    { uuid: 'f2', content: 'She prefers the morning aide', confirmed: false },
    { id: 'f3' }, // no text - dropped
  ]);
  assert.equal(facts.length, 2);
  assert.equal(facts[0]!.confirmed, true);
  assert.equal(facts[1]!.text, 'She prefers the morning aide');
});

test('an open todo becomes a logistical proposal - never medical, whatever it says', () => {
  const p = beeTodoToProposal(
    { id: 't1', text: 'She said her chest hurt, book the cardiologist', completed: false },
    'Mum',
  );
  assert.ok(p);
  // The one thing a microphone must not decide is that something is a medical emergency.
  assert.equal(p!.consequence, 'logistical');
  assert.match(p!.ask, /haven't confirmed|should I add/i);
  assert.match(p!.spoken, /Mum/);
});

test('a completed todo raises nothing - the door surfaces only what is still open', () => {
  assert.equal(beeTodoToProposal({ id: 't2', text: 'already done', completed: true }, 'Mum'), null);
});

test('a fact is kept as heard-unconfirmed, and says so in words', () => {
  const o = beeFactToObservation({ id: 'f1', text: 'She skipped lunch', confirmed: false }, 'Mum');
  assert.ok(o);
  assert.match(o!.spoken, /heard, unconfirmed/i);
  assert.match(o!.spoken, /She skipped lunch/);
});
