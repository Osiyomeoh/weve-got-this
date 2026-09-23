import type { CareState, Member } from './types.js';

/**
 * Who a piece of care is for.
 *
 * A family can care for more than one person: a father after surgery and a
 * grandmother, say. Anything recorded for the wrong one is worse than nothing,
 * because the record would look right. So when nobody says who, it is the person
 * being cared for only if there is exactly one; with two, we ask.
 *
 * The person is named the way the family says it ("Mum", "Grandma", "Dad"), or by id.
 */

export function careRecipients(state: CareState): Member[] {
  return state.members.filter((m) => m.role === 'care_recipient');
}

/** "Dad", or "Dad and Grandma", or "Dad, Grandma and Uncle Tunde". */
export function spokenList(names: string[], joiner = 'and'): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1)}`;
}

export const called = (m: Member): string => m.spokenAs ?? m.name;

/** Everyone being cared for, as the family says it ("Dad and Grandma"). */
export function recipientsSpoken(state: CareState, fallback = 'the person you care for'): string {
  const names = careRecipients(state).map(called);
  return names.length ? spokenList(names) : fallback;
}

function byName(state: CareState, given: string): Member | undefined {
  const needle = given.trim().toLowerCase().replace(/'s$/, '');
  return state.members.find((m) => m.id === given.trim())
    ?? state.members.find((m) => m.name.toLowerCase() === needle || m.spokenAs?.toLowerCase() === needle);
}

export type Subject = { member: Member } | { problem: string };

/**
 * Resolve who something is for. `given` is what the person said (a name) or an id;
 * absent, it is the one person being cared for, when there is exactly one.
 */
export function subjectOf(state: CareState, given: string | undefined, what = 'this'): Subject {
  if (given?.trim()) {
    const m = byName(state, given);
    if (m) return { member: m };
    const cared = careRecipients(state).map(called);
    return {
      problem: `I don't know who "${given.trim()}" is in this circle.`
        + (cared.length ? ` Ask whether they meant ${spokenList(cared, 'or')}.` : ' Ask who they meant.'),
    };
  }
  const cared = careRecipients(state);
  if (cared.length === 1) return { member: cared[0]! };
  if (cared.length === 0) return { problem: `I don't know who ${what} is for. Ask who it is for.` };
  return { problem: `Ask who ${what} is for: ${spokenList(cared.map(called), 'or')}.` };
}
