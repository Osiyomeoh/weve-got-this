import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from './rooms.ts';

test('a guest takes a free person, and their words reach the host once', () => {
  const rooms = new Rooms();
  const code = rooms.open('host');
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(rooms.open('host'), code, 'the same host keeps one room');
  assert.deepEqual(rooms.post(code, 'host', { caption: 'morning' }, 'tolu'), { seats: {}, inbox: [] });

  assert.equal(rooms.seat(code, 'g1', 'tolu'), 'seat-taken', 'the host\'s own person');
  assert.equal(rooms.seat(code, 'g1', 'musa'), true);
  assert.equal(rooms.seat(code, 'g2', 'musa'), 'seat-taken');
  assert.deepEqual(rooms.view(code.toLowerCase(), 'g1'), { feed: { caption: 'morning' }, taken: ['musa', 'tolu'], mine: 'musa' });

  assert.equal(rooms.send(code, 'g2', { text: 'hi' }), 'no-seat');
  assert.equal(rooms.send(code, 'g1', { text: '  Yes, I\'ll do it.  ' }), true);
  assert.equal(rooms.send(code, 'g1', { key: 'ok' }), true);
  assert.equal(rooms.send(code, 'g1', { key: 'power' }), 'bad-message');
  assert.equal(rooms.send(code, 'g1', { text: 'x'.repeat(501) }), 'bad-message');

  assert.deepEqual(rooms.post(code, 'host', null, 'tolu'), {
    seats: { musa: true }, inbox: [{ who: 'musa', text: 'Yes, I\'ll do it.' }, { who: 'musa', key: 'ok' }],
  });
  assert.deepEqual((rooms.post(code, 'host', null, 'tolu') as { inbox: unknown[] }).inbox, [], 'drained');
  assert.equal(rooms.post(code, 'someone-else', null, null), 'not-host');
  assert.equal(rooms.post(code, 'host', { big: 'x'.repeat(20_000) }, null), 'too-big');
});

test('taking another person lets the first go; the host choosing a seat bumps its guest', () => {
  const rooms = new Rooms();
  const code = rooms.open('host');
  rooms.seat(code, 'g1', 'musa');
  rooms.seat(code, 'g1', 'daddy');
  assert.deepEqual((rooms.view(code, 'g1') as { taken: string[] }).taken, ['daddy']);
  rooms.post(code, 'host', null, 'daddy');
  assert.equal((rooms.view(code, 'g1') as { mine: string | null }).mine, null);
});

test('rooms expire when the host goes quiet, and stay bounded', () => {
  let now = 0;
  const rooms = new Rooms({ limit: 2, ttlMs: 1000, now: () => now });
  const a = rooms.open('a');
  now = 10;
  rooms.open('b');
  rooms.open('c');
  assert.equal(rooms.view(a, 'g'), 'no-room', 'the idlest room made way');
  now = 5000;
  assert.equal(rooms.view(rooms.open('d'), 'g') !== 'no-room', true);
  assert.equal(rooms.post(a, 'a', null, null), 'no-room');
});
