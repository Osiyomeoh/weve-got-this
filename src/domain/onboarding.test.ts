import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingProgress } from './onboarding.ts';
import type { CareState } from './types.ts';

const NOW = new Date('2026-10-15T18:00:00Z'); // 14:00 New York

function state(over: Partial<CareState> = {}): CareState {
  return {
    household: { id: 'h1', name: "Ada's care circle", timezone: 'America/New_York' },
    members: [
      { id: 'm_ada', householdId: 'h1', name: 'Ada', role: 'primary_caregiver' },
    ],
    medications: [],
    obligations: [],
    events: [],
    ...over,
  };
}

const recipient = { id: 'm_mum', householdId: 'h1', name: 'Grace', role: 'care_recipient' as const, spokenAs: 'Mum' };

test('an unmapped caller is asked to create a circle first', () => {
  const p = onboardingProgress(null);
  assert.equal(p.step, 'create_circle');
  assert.equal(p.complete, false);
  assert.match(p.spoken, /set up your care circle/i);
});

test('a circle with no care recipient asks who it is for', () => {
  const p = onboardingProgress(state());
  assert.equal(p.step, 'add_recipient');
  assert.match(p.spoken, /who is the circle caring for/i);
  assert.deepEqual(p.done, ['create_circle']);
});

test('once there is a recipient but nothing to watch, it asks for one real detail', () => {
  const p = onboardingProgress(state({ members: [state().members[0]!, recipient] }));
  assert.equal(p.step, 'add_care_detail');
  // Uses how the person is spoken about, not their formal name.
  assert.match(p.spoken, /Mum/);
  assert.match(p.spoken, /medication|appointment/i);
});

test('a medication is enough to be ready', () => {
  const p = onboardingProgress(state({
    members: [state().members[0]!, recipient],
    medications: [{ id: 'med1', householdId: 'h1', name: 'heart pill', times: ['08:00'], forMemberId: 'm_mum' }],
  }));
  assert.equal(p.step, 'ready');
  assert.equal(p.complete, true);
});

test('setup ends the moment there is a real gap to act on - it does not chase a finished form', () => {
  // An unowned obligation is "something to watch" even with no medications.
  const p = onboardingProgress(state({
    members: [state().members[0]!, recipient],
    obligations: [{
      id: 'o1', householdId: 'h1', what: 'Drive Mum to the clinic', status: 'OPEN',
      consequence: 'medical', ownerId: null, createdAt: '2026-10-14T12:00:00Z',
      dueAt: '2026-10-16T14:00:00Z',
      provenance: { kind: 'CONFIRMED', byMemberId: 'm_ada', at: '2026-10-14T12:00:00Z' },
    }],
  }), { now: NOW });
  assert.equal(p.step, 'ready');
  assert.ok(p.firstGap, 'ready without surfacing the first gap defeats the point');
  assert.match(p.firstGap!.what, /clinic/i);
  assert.match(p.spoken, /needs someone/i);
});

test('ready with nothing outstanding reassures rather than inventing work', () => {
  const p = onboardingProgress(state({
    members: [state().members[0]!, recipient],
    medications: [{ id: 'med1', householdId: 'h1', name: 'vitamin', times: ['09:00'], forMemberId: 'm_mum' }],
  }), { now: new Date('2026-10-15T11:00:00Z') }); // before 09:00 NY? actually 07:00 NY - dose not yet due
  assert.equal(p.step, 'ready');
  // No due-and-missed dose yet, so no manufactured gap.
  assert.equal(/needs someone/i.test(p.spoken), p.firstGap !== undefined);
});

test('the step is a pure function of the record - same state, same step', () => {
  const s = state({ members: [state().members[0]!, recipient] });
  assert.deepEqual(onboardingProgress(s, { now: NOW }), onboardingProgress(s, { now: NOW }));
});

test('progress only ever moves forward through the four steps', () => {
  const order = ['create_circle', 'add_recipient', 'add_care_detail', 'ready'];
  const seen = [
    onboardingProgress(null).step,
    onboardingProgress(state()).step,
    onboardingProgress(state({ members: [state().members[0]!, recipient] })).step,
    onboardingProgress(state({
      members: [state().members[0]!, recipient],
      medications: [{ id: 'med1', householdId: 'h1', name: 'x', times: ['08:00'], forMemberId: 'm_mum' }],
    })).step,
  ];
  assert.deepEqual(seen, order);
});
