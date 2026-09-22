import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramUpdate, interpretReply } from './telegram.ts';

const update = (chatId: number | string, text: string, updateId = 1): unknown => ({
  update_id: updateId,
  message: { message_id: 10, chat: { id: chatId }, text },
});

test('parses a text message out of a Telegram update, chat id as a string', () => {
  const [m] = parseTelegramUpdate(update(123456, 'Yes I can'));
  assert.equal(m!.chatId, '123456');
  assert.equal(m!.text, 'Yes I can');
  assert.equal(m!.updateId, '1');
});

test('a non-message update (no text) carries no answer and is dropped', () => {
  assert.equal(parseTelegramUpdate({ update_id: 2, edited_message: { text: 'hi' } }).length, 0);
  assert.equal(parseTelegramUpdate({ update_id: 3, message: { chat: { id: 1 } } }).length, 0);
  assert.equal(parseTelegramUpdate({}).length, 0);
});

test('reply interpretation is the shared one - a decline reads as declined', () => {
  assert.equal(interpretReply("No, I can't"), 'declined');
  assert.equal(interpretReply("Yes, I'll take it"), 'accepted');
  assert.equal(interpretReply('maybe later?'), null);
});
