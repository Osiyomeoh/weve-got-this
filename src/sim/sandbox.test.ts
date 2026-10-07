import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, toSandbox, fromSandbox, isVisitorId, newVisitorId, VisitorSandboxes, type SandboxGrant } from './sandbox.ts';

const SFX = '~mfx1a2b-0badc0de';

test('logical ids in arguments gain the suffix; everything else is left alone', () => {
  const args = { memberId: 'm_renee', note: 'm_renee can drive', ids: ['m_david', 'obl_1'], n: 3, nested: { who: 'm_aide' } };
  assert.deepEqual(toSandbox(args, SFX), {
    memberId: `m_renee${SFX}`, note: 'm_renee can drive', ids: [`m_david${SFX}`, 'obl_1'], n: 3, nested: { who: `m_aide${SFX}` },
  });
  assert.deepEqual(toSandbox(args, ''), args, 'no suffix: the shared demo, untouched');
});

test('the suffix is stripped from everything that comes back', () => {
  const out = { structured: { ownerId: `m_renee${SFX}`, householdId: `h_margaret${SFX}` }, result: 'Renee has it.' };
  assert.deepEqual(fromSandbox(out, SFX), { structured: { ownerId: 'm_renee', householdId: 'h_margaret' }, result: 'Renee has it.' });
});

test('a round trip returns the ids the UI started with', () => {
  const args = { memberId: 'm_david' };
  assert.deepEqual(fromSandbox(toSandbox(args, SFX), SFX), args);
});

test('cookies parse, and only well-formed visitor ids are accepted', () => {
  assert.deepEqual(parseCookies('a=1; cc_visitor=abc%20d; bad; =x'), { a: '1', cc_visitor: 'abc d' });
  assert.ok(isVisitorId(newVisitorId()));
  assert.ok(!isVisitorId('../../etc'));
  assert.ok(!isVisitorId(undefined));
});

test('a visitor gets one copy even when the page fires requests at once', async () => {
  let made = 0;
  const grant = (): SandboxGrant => ({ suffix: `~s${++made}-00000000`, tokens: {}, expiresAt: Date.now() + 3600_000 });
  const s = new VisitorSandboxes({ create: async () => grant() });
  const [a, b, c] = await Promise.all([s.get('v1'), s.get('v1'), s.get('v1')]);
  assert.equal(made, 1);
  assert.equal(a, b); assert.equal(b, c);
  assert.notEqual((await s.get('v2')).suffix, a.suffix, 'another visitor, another copy');
});

test('an expiring copy is replaced, and "start over" gives a fresh one', async () => {
  let now = 0; let made = 0;
  const s = new VisitorSandboxes({
    now: () => now,
    create: async () => ({ suffix: `~s${++made}-00000000`, tokens: {}, expiresAt: now + 3600_000 }),
  });
  const first = await s.get('v');
  now = 3600_000 - 30_000; // inside the last minute
  assert.notEqual((await s.get('v')).suffix, first.suffix);
  const before = await s.get('v');
  s.forget('v');
  assert.notEqual((await s.get('v')).suffix, before.suffix);
});

test('"start over" can ask for the next copy to be made differently, once', async () => {
  const kinds: unknown[] = [];
  const s = new VisitorSandboxes({ create: async (kind) => { kinds.push(kind); return { suffix: `~s${kinds.length}-00000000`, tokens: {}, expiresAt: Date.now() + 3600_000 }; } });
  await s.get('v');
  s.forget('v', { liveMorning: true });
  await s.get('v');
  s.forget('v');
  await s.get('v');
  assert.deepEqual(kinds, [{}, { liveMorning: true }, {}]);
});

test('memory is bounded: the least recently used visitor is dropped first', async () => {
  let made = 0;
  const s = new VisitorSandboxes({ limit: 2, create: async () => ({ suffix: `~s${++made}-00000000`, tokens: {}, expiresAt: Date.now() + 3600_000 }) });
  const a = await s.get('a'); await s.get('b');
  await s.get('a');           // a is now most recent
  await s.get('c');           // evicts b
  assert.equal((await s.get('a')).suffix, a.suffix);
  assert.equal(made, 3);
  await s.get('b');           // b comes back as a new copy
  assert.equal(made, 4);
});
