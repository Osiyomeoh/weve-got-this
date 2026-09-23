import { localParts, spokenDue } from './gaps.js';

/**
 * Times as the family lives them, not as the server stores them.
 *
 * The record keeps instants in UTC, which is right for storage and wrong for anything
 * a person hears. We watched a model read `dueAt: 09:00Z` and tell someone in Lagos the
 * check-up was "at nine in the morning" when it was at ten; for a family in New York
 * the same mistake is five hours. And "today" taken as the UTC date quietly drops the
 * whole morning from "how was Dad's day?" once it is evening in the Americas. So
 * everything a tool hands a model or a listener about *when* goes through here, in the
 * household's own timezone.
 */

/** Whether an instant falls on the household's current local day. */
export function isLocalToday(iso: string, now: Date, timezone: string): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return localParts(at, timezone).date === localParts(now, timezone).date;
}

/** "8:10 AM" in the household's timezone. */
export function clockTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

/** "tomorrow at 10 AM", "Thursday the 24th at 10 AM"; null when there is no due time. */
export function dueSpoken(dueAt: string | undefined | null, timezone: string, now: Date): string | null {
  return spokenDue(dueAt ?? undefined, timezone, now).trim() || null;
}

/** Verbs a task's wording starts with when it is already an instruction. */
const TASK_VERBS = new Set([
  'take', 'drive', 'pick', 'go', 'check', 'give', 'get', 'buy', 'collect', 'bring', 'call',
  'book', 'refill', 'reorder', 'order', 'help', 'cook', 'clean', 'visit', 'sit', 'stay',
  'fill', 'arrange', 'confirm', 'renew', 'schedule', 'drop', 'fetch', 'sort', 'make',
]);

/**
 * A task as the end of "can you ...": "take Daddy to his eye check-up", "pick up
 * Daddy's eye drops refill". Wording that is not an instruction ("Groceries for the
 * week") becomes "take on Groceries for the week", so it never reads "take Pick up".
 */
export function asTask(what: string): string {
  const first = what.trim().split(/\s+/)[0] ?? '';
  return TASK_VERBS.has(first.toLowerCase())
    ? first.toLowerCase() + what.trim().slice(first.length)
    : `take on ${what.trim()}`;
}
