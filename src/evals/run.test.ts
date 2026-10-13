import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, type CaseResult } from './run.ts';
import { CORPUS, type EvalCase } from './corpus.ts';

const result = (
  c: Partial<EvalCase> & { id: string },
  pass: boolean,
  errored = false,
): CaseResult => ({
  case: { member: 'm_david', utterance: '', ...c },
  chosen: null,
  args: {},
  pass,
  reason: '',
  ...(errored ? { errored: true } : {}),
});

test('held-out cases used to fix the server are reported apart from unseen ones', () => {
  const s = summarise([
    result({ id: 'log-01' }, true),
    result({ id: 'h-buy-02', seen: 'used' }, true),
    result({ id: 'h-note-01' }, false),
    result({ id: 'h2-buy-01' }, true),
    result({ id: 'h-gap-01' }, false, true), // never reached the model: in no split
  ]);
  assert.deepEqual(s.splits, [
    { split: 'authored', passed: 1, total: 1 },
    { split: 'held-out', passed: 1, total: 2 },
    { split: 'seen', passed: 1, total: 1 },
  ]);
});

test('only held-out cases can be marked seen, and ids are unique', () => {
  const ids = CORPUS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CORPUS.filter((x) => x.seen)) assert.ok(c.id.startsWith('h'), c.id);
});
