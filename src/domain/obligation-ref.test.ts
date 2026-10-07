import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchObligation } from './obligation-ref.ts';
import type { Obligation } from './types.ts';

function work(id: string, what: string, status: Obligation['status'] = 'OPEN'): Obligation {
  return {
    id, householdId: 'h', what, status, consequence: 'logistical', ownerId: null,
    provenance: { kind: 'CONFIRMED', byMemberId: 'm', at: '2026-09-23T08:00:00Z' },
    createdAt: '2026-09-23T08:00:00Z',
  };
}

const board = [
  work('ob_ride', 'Take Daddy to his eye check-up'),
  work('ob_refill', "Pick up Daddy's eye drops refill"),
  work('ob_old', 'Book the eye check-up', 'RESOLVED'),
];

const found = (ref: string) => {
  const m = matchObligation(ref, board);
  return m.kind === 'found' ? m.obligation.id : m.kind;
};

test('an id is used as it is', () => {
  assert.equal(found('ob_refill'), 'ob_refill');
});

test('the task in words, or the whole spoken gap line, finds it', () => {
  assert.equal(found('Take Daddy to his eye check-up'), 'ob_ride');
  // What the planner passed in production, word for word.
  assert.equal(found('Take Daddy to his eye check-up tomorrow at 10 AM - nobody has taken this yet.'), 'ob_ride');
  assert.equal(found("pick up daddy's eye drops refill"), 'ob_refill');
});

test('part of it finds it when only one piece of work fits', () => {
  assert.equal(found('the check-up'), 'ob_ride');
  assert.equal(found('the refill'), 'ob_refill');
});

test('when more than one fits, nothing is guessed', () => {
  const m = matchObligation('the eye one', board);
  assert.equal(m.kind, 'ambiguous');
  assert.deepEqual(m.kind === 'ambiguous' && m.options.map((o) => o.id), ['ob_ride', 'ob_refill']);
});

test('finished work is not matched, and no match says what is live', () => {
  const m = matchObligation('book the eye check-up', board);
  assert.equal(m.kind, 'none');
  assert.deepEqual(m.kind === 'none' && m.live.map((o) => o.id), ['ob_ride', 'ob_refill']);
  assert.equal(found('the laundry'), 'none');
  assert.equal(found('   '), 'none');
});

test('a question about what happened may name finished work, and gets the latest', () => {
  const pick = (ref: string, os: Obligation[]) => {
    const m = matchObligation(ref, os, { finished: true });
    return m.kind === 'found' ? m.obligation.id : m.kind;
  };
  assert.equal(pick('book the eye check-up', board), 'ob_old');
  assert.equal(pick('the refill', board), 'ob_refill', 'live work still comes first');
  const twice = [
    { ...work('ob_r1', "Pick up Daddy's eye drops refill", 'RESOLVED'), resolvedAt: '2026-09-20T19:00:00Z' },
    { ...work('ob_r2', "Pick up Daddy's eye drops refill", 'RESOLVED'), resolvedAt: '2026-10-07T19:16:00Z' },
  ];
  assert.equal(pick('the eye drops refill', twice), 'ob_r2');
  assert.equal(pick('the laundry', board), 'none');
});
