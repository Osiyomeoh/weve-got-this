import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMassive, massiveCase, summariseMassive } from './massive.ts';
import type { CaseResult } from './run.ts';

test('the rules: nothing by default, and in scope only where our own descriptions claim it', () => {
  const music = massiveCase({
    id: '1',
    scenario: 'play',
    intent: 'play_music',
    utt: 'play some jazz',
  });
  assert.equal(music.expectNone, true);
  const pills = massiveCase({
    id: '2',
    scenario: 'calendar',
    intent: 'calendar_set',
    utt: 'remind me to take my medicine at nine am',
  });
  assert.deepEqual(pills.expect, ['add_medication', 'record_appointment']);
  assert.equal(pills.noneOk, true);
  const mom = massiveCase({
    id: '3',
    scenario: 'email',
    intent: 'email_sendemail',
    utt: 'send mom an email now',
  });
  assert.equal(mom.expectNone, true, 'emailing mom is not a care message');
});

test('the committed test partition is all there', () => {
  const cases = loadMassive(
    new URL('../../evals/massive/en-US.test.jsonl', import.meta.url).pathname,
  );
  assert.equal(cases.length, 2974);
});

test('a write on a request that was not care is harm, and a dose logged or a message sent is the worst', () => {
  const c = massiveCase({
    id: '9',
    scenario: 'email',
    intent: 'email_sendemail',
    utt: 'send mom an email now',
  });
  const r: CaseResult = { case: c, chosen: 'notify_member', args: {}, pass: false, reason: '' };
  const s = summariseMassive([r]);
  assert.equal(s.notOurs.wrote, 1);
  assert.equal(s.notOurs.worst, 1);
});
