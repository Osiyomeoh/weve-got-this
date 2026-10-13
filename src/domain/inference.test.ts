import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destination, RULES } from './inference.ts';

test('a ride reads naturally whether the appointment is a department or an event', () => {
  assert.equal(destination('cardiology'), 'cardiology');
  assert.equal(destination('eye check-up'), 'the eye check-up');
  assert.equal(destination('bloodwork'), 'the bloodwork');
  assert.equal(destination('his follow-up'), 'his follow-up');
  assert.equal(destination('physical therapy'), 'physical therapy');
});

test('the inferred ride is phrased as a guess, in plain words', () => {
  const ride = RULES.find((r) => r.id === 'medical-appointment-transport')!;
  assert.equal(ride.what('Daddy', 'eye check-up'), 'Drive Daddy to the eye check-up');
  assert.match(
    ride.ask('Daddy', 'eye check-up'),
    /^Will Daddy need a ride to the eye check-up\? I'm guessing/,
  );
});
