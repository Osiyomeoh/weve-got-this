import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blameIn } from './no-blame.ts';

test('a claim that someone missed a dose is caught in every voice', () => {
  for (const said of [
    'Daddy missed his evening drops.',
    'He skipped them.',
    "He's skipping doses.",
    'You forgot your drops.',
    'He has forgotten them again.',
    'She keeps forgetting.',
    "He didn't take his drops.",
    'Musa did not give them.',
    "He hasn't taken them.",
    "Daddy's evening eye drops were not taken.",
    "The 8 PM dose wasn't given.",
    "They haven't been taken yet.",
    'The drops have not yet been given.',
    'The dose is not taken.',
    'He failed to take them.',
    'He never took them.',
  ])
    assert.ok(blameIn(said), said);
});

test('saying what the record shows is never caught', () => {
  for (const said of [
    "There's no record of Daddy's evening eye drops yet.",
    'Nobody has logged the 8 PM drops.',
    'Musa logged his morning drops at 8:10 AM.',
    'There is a missing record for the 8 PM dose.',
    'Has anyone given him the drops? I have no record of it.',
    'He takes his drops at 8 AM and 8 PM.',
    'The drops were given at 8:10 AM, Musa logged it.',
  ])
    assert.equal(blameIn(said), null, said);
});
