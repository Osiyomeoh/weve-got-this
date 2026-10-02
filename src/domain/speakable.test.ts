import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakable, toolAnswer } from './speakable.ts';

test("the model's reasoning is never said", () => {
  assert.equal(
    speakable("<thinking>I need to inform Tolu about the missing records.</thinking> Here is the summary for Daddy today."),
    'Here is the summary for Daddy today.',
  );
  assert.equal(speakable('<Reasoning>first</Reasoning>One. <thinking>second</thinking>Two.'), 'One. Two.');
});

test('a reasoning tag left open is cut to the end', () => {
  assert.equal(speakable('Sure. <thinking>unfinished, and he missed'), 'Sure.');
});

test('answer wrappers are dropped and their words kept', () => {
  assert.equal(speakable('<response>There is no record yet.</response>'), 'There is no record yet.');
});

test('an ordinary reply is untouched, line breaks included', () => {
  const reply = "There's no record of Daddy's 8 PM eye drops yet.\nOn the record today: drops at 8:10 AM.";
  assert.equal(speakable(reply), reply);
  assert.equal(speakable('Use 2 < 3 drops'), 'Use 2 < 3 drops');
});

test("what the tools answered is said once each, in order, blanks dropped", () => {
  assert.equal(toolAnswer(['Logged.', ' ', 'Nothing else is due.', 'Logged.']), 'Logged. Nothing else is due.');
  assert.equal(toolAnswer([]), '');
});
