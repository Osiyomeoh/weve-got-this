import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInboundMessages, interpretReply, normalisePhone } from './whatsapp.ts';

const payload = (msgs: Array<Record<string, unknown>>): unknown => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages: msgs } }] }],
});

test('parseInboundMessages pulls text messages and ignores the rest', () => {
  const out = parseInboundMessages(
    payload([
      { from: '2348012345678', id: 'wamid.1', type: 'text', text: { body: 'Yes I can' } },
      { from: '2348099999999', id: 'wamid.2', type: 'image', image: { id: 'x' } }, // not text
      { from: '2348012345678', id: 'wamid.3', type: 'text', text: { body: '' } }, // empty
    ]),
  );
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { from: '2348012345678', text: 'Yes I can', messageId: 'wamid.1' });
});

test('parseInboundMessages tolerates a status-only callback (no messages)', () => {
  const out = parseInboundMessages({
    entry: [{ changes: [{ value: { statuses: [{ status: 'read' }] } }] }],
  });
  assert.deepEqual(out, []);
});

test('interpretReply reads a clear yes and a clear no, and only those', () => {
  assert.equal(interpretReply("Yes, I'll take it"), 'accepted');
  assert.equal(interpretReply('sure thing'), 'accepted');
  assert.equal(interpretReply('👍'), 'accepted');
  assert.equal(interpretReply("Sorry, I can't this week"), 'declined');
  assert.equal(interpretReply('no'), 'declined');
  // "no, I can't" contains no "yes" and must read as a decline, checked first.
  assert.equal(interpretReply("No, I can't"), 'declined');
  // Ambiguous stays null - the loop must not invent agreement.
  assert.equal(interpretReply('what time is it?'), null);
  assert.equal(interpretReply('maybe later'), null);
});

test('normalisePhone strips everything but digits so formats compare equal', () => {
  assert.equal(normalisePhone('+234 801 234 5678'), '2348012345678');
  assert.equal(normalisePhone('234-801-234-5678'), '2348012345678');
});
