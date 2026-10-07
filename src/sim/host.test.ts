import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, unbackedClaim } from './host.ts';

test('a reply that says it asked someone, with no write behind it, is caught', () => {
  assert.equal(unbackedClaim("I've already asked Funmi whether they can take Baba to physiotherapy.", []), true);
  assert.equal(unbackedClaim("Thanks, that's yours now: take Baba to physiotherapy.", [{ name: 'get_care_gaps', isError: false }]), true);
  assert.equal(unbackedClaim("I've asked Funmi.", [{ name: 'request_owner', isError: true }]), true, 'a failed write backs nothing');
});

test('a backed claim, or a plain answer, passes', () => {
  assert.equal(unbackedClaim("I've asked Funmi.", [{ name: 'request_owner', isError: false }]), false);
  assert.equal(unbackedClaim('Nobody has taken it yet. Musa said no.', [{ name: 'get_care_gaps', isError: false }]), false);
  assert.equal(unbackedClaim('Yes, you took your tablet at 7:42 this morning.', []), false);
});

test('the coming week is spelled out, so "Thursday" is not worked out by hand', () => {
  const p = systemPrompt({ now: new Date('2026-10-07T11:40:00Z'), timezone: 'Africa/Lagos' });
  assert.match(p, /tomorrow, Thursday is 2026-10-08; Friday is 2026-10-09/);
});
