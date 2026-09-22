import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramUpdate, interpretReply } from './telegram.ts';

const update = (chatId: number | string, text: string, updateId = 1): unknown => ({
  update_id: updateId,
  message: { message_id: 10, chat: { id: chatId }, text },
});

test('parses a text message out of a Telegram update, ids as strings', () => {
  const [m] = parseTelegramUpdate(update(123456, 'Yes I can'));
  assert.equal(m!.chatId, '123456');
  assert.equal(m!.fromId, '123456'); // a DM: sender id falls back to the chat id
  assert.equal(m!.text, 'Yes I can');
  assert.equal(m!.updateId, '1');
});

test('in a group, the sender id is kept apart from the group chat id', () => {
  const [m] = parseTelegramUpdate({
    update_id: 5,
    message: { message_id: 11, chat: { id: -100200300 }, from: { id: 987654 }, text: 'yes' },
  });
  assert.equal(m!.chatId, '-100200300'); // the group
  assert.equal(m!.fromId, '987654');      // the person who answered
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
