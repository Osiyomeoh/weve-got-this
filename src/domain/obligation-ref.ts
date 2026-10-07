import type { Obligation } from './types.js';

/**
 * Which piece of work a tool call means, when the planner did not pass its id.
 *
 * Tools take an `obligationId`, and the planner usually passes the id from
 * get_care_gaps. But it sometimes passes the words instead: the task itself ("Take
 * Daddy to his eye check-up"), the whole spoken gap line, or part of it ("the
 * check-up"). Refusing that makes Alexa say it has "a technical issue identifying the
 * obligation" in the middle of a family asking for help, which we watched happen. So
 * the words are matched against the work that is still live, and the call goes
 * through when exactly one piece of work fits. When several fit, nothing is guessed:
 * the caller gets the choices back to ask the person which one.
 */

export type ObligationMatch =
  | { kind: 'found'; obligation: Obligation }
  | { kind: 'ambiguous'; options: Obligation[] }
  | { kind: 'none'; live: Obligation[] };

const LIVE = new Set<Obligation['status']>(['PROPOSED', 'OPEN', 'REQUESTED', 'ASSIGNED']);

/** Lower case, words only, so punctuation and dashes from a spoken line don't matter. */
function words(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Words that say nothing about which task is meant. */
const FILLER = new Set([
  'the', 'a', 'an', 'to', 'his', 'her', 'their', 'for', 'of', 'up', 'at', 'on', 'in', 'my',
  'one', 'thing', 'task', 'job', 'that', 'this',
]);

function significant(s: string): string[] {
  return words(s).split(' ').filter((w) => w.length > 2 && !FILLER.has(w));
}

export function matchObligation(
  ref: string, obligations: Obligation[], opts: { finished?: boolean } = {},
): ObligationMatch {
  const byId = obligations.find((o) => o.id === ref);
  if (byId) return { kind: 'found', obligation: byId };

  const live = obligations.filter((o) => LIVE.has(o.status));
  const inLive = matchIn(ref, live);
  if (inLive) return inLive;
  // A question about what happened ("where does it say the refill was picked up?") is
  // about finished work. Only read-only callers ask for it; nothing acts on a closed task.
  if (opts.finished) {
    const done = matchIn(ref, obligations.filter((o) => !LIVE.has(o.status)));
    if (done?.kind === 'found') return done;
    // The same errand done more than once: the latest is the one being asked about.
    if (done?.kind === 'ambiguous') {
      const latest = [...done.options].sort((a, b) =>
        (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))[0]!;
      return { kind: 'found', obligation: latest };
    }
  }
  return { kind: 'none', live };
}

/** The work in `pool` that the words fit, or undefined when nothing does. */
function matchIn(ref: string, pool: Obligation[]): ObligationMatch | undefined {
  const said = words(ref);
  if (!said) return undefined;

  // The task's own words, or the gap line that starts with them.
  const whole = pool.filter((o) => {
    const what = words(o.what);
    return what.length > 0 && (said === what || said.startsWith(`${what} `) || said.includes(what));
  });
  if (whole.length === 1) return { kind: 'found', obligation: whole[0]! };
  if (whole.length > 1) return { kind: 'ambiguous', options: whole };

  // Part of it: every significant word said appears in the task.
  const key = significant(ref);
  if (key.length === 0) return undefined;
  const partial = pool.filter((o) => {
    const what = new Set(words(o.what).split(' '));
    return key.every((w) => what.has(w));
  });
  if (partial.length === 1) return { kind: 'found', obligation: partial[0]! };
  if (partial.length > 1) return { kind: 'ambiguous', options: partial };
  return undefined;
}
