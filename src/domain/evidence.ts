import type { CareEvent, Obligation } from './types.js';

/**
 * Evidence: what the devices saw around the time a piece of work was due.
 *
 * Proof of care, in the only form this system can honestly offer it. A person saying
 * "done" is the verdict; what a doorbell saw near the promised time is evidence beside
 * it, never in place of it. Ring reports motion, a doorbell press, or a package, and may
 * classify motion as a person or a vehicle - but it never knows *who* - so evidence here
 * is "there was activity at the door at 9:04", never "Musa arrived".
 *
 * The same selection serves three readers, so they can never disagree: closing a task
 * records it, "how do we know?" speaks it, and the agent's check-in mentions it.
 */

/** How far before the due time activity still counts toward it. */
const BEFORE_MINUTES = 60;
/** Without a due time, how far back from now to look. */
const UNDATED_HOURS = 3;
/** Enough to show a pattern, few enough to read aloud. */
const MOST = 3;

const PRESENCE = new Set(['door_activity', 'motion', 'delivery_arrived']);

function isPresence(e: CareEvent): boolean {
  return e.kind === 'external_signal' && PRESENCE.has(String(e.data['signalKind']));
}

/** The window of time in which a device signal bears on this work. */
export function evidenceWindow(o: Obligation, at: Date): { from: number; to: number } {
  const to = at.getTime();
  const from = o.dueAt
    ? new Date(o.dueAt).getTime() - BEFORE_MINUTES * 60_000
    : to - UNDATED_HOURS * 3_600_000;
  return { from, to };
}

/** Device signals that bear on this work, nearest its due time first. */
export function evidenceFor(o: Obligation, events: CareEvent[], at: Date): CareEvent[] {
  const { from, to } = evidenceWindow(o, at);
  const anchor = o.dueAt ? new Date(o.dueAt).getTime() : to;
  return events
    .filter((e) => isPresence(e))
    .filter((e) => { const t = new Date(e.occurredAt).getTime(); return t >= from && t <= to; })
    .sort((a, b) => Math.abs(new Date(a.occurredAt).getTime() - anchor) - Math.abs(new Date(b.occurredAt).getTime() - anchor))
    .slice(0, MOST);
}

/** Whether this household has a device that could have seen anything at all. */
export function hasDoorSensor(events: CareEvent[]): boolean {
  return events.some(isPresence);
}

/** "9:04 AM", in the household's own time, written the way every other answer writes it. */
export function clockAt(at: string, timezone: string): string {
  return new Date(at).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
    .replace(/\s/g, ' ');
}

/** One signal as a plain line: what was seen and when, nothing about what it means. */
export function evidenceLine(e: CareEvent, timezone: string): string {
  const what = e.data['signalKind'] === 'delivery_arrived' ? 'a delivery at the door'
    : e.data['signalKind'] === 'door_activity' ? 'the doorbell pressed'
      : 'activity at the door';
  return `${what} at ${clockAt(e.occurredAt, timezone)}`;
}

/**
 * What the agent can add to a "still on?" check-in. Nothing, when the household has no
 * door sensor: "no activity recorded" from a house with no doorbell would be a false
 * signal dressed as a fact.
 */
export function checkInEvidence(o: Obligation, events: CareEvent[], now: Date, timezone: string): string {
  if (!hasDoorSensor(events)) return '';
  const seen = evidenceFor(o, events, now);
  if (seen.length) return ` The doorbell saw ${evidenceLine(seen[0]!, timezone)}.`;
  const since = o.dueAt ? new Date(new Date(o.dueAt).getTime() - BEFORE_MINUTES * 60_000).toISOString() : undefined;
  return since ? ` No activity at the door has been recorded since ${clockAt(since, timezone)}.` : '';
}
