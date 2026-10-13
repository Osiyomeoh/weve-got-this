import { activeMedications } from './care-changes.js';
import { called, careRecipients } from './who.js';
import type { CareState, Member } from './types.js';
import type { CareStore } from '../store/store.js';
import type { Notifier } from '../notify/notifier.js';
import { doseRecord, localParts, parseHHMM, spokenClock } from './gaps.js';
import { attributionOf, sayWhoSaysSo } from './attribution.js';
import { AGENT_ID } from './agent.js';

/**
 * The evening update, for family who want to know how the day went.
 *
 * Written for the child abroad first: a son in London who cannot drop by, and should
 * not have to ring round his siblings to find out whether the eye drops went in.
 * It is the same record everyone else sees, under the same rules:
 *
 *  - a dose with no record says **no record yet**, never that it was missed;
 *  - a dose someone else logged says who logged it, so "Musa says so" is never
 *    quietly upgraded into "Daddy says so";
 *  - work nobody has taken on is named, so the update is also how a sibling far
 *    away learns there is something he could pick up from where he is.
 */

/** When the update goes out, household time. After the evening doses and their grace hour. */
const DAILY_UPDATE_AT = '21:00';

const UPCOMING_DAYS = 7;
const NOTES_LIMIT = 3;

function nameOf(state: CareState, id: string): string | null {
  const m = state.members.find((x) => x.id === id);
  return m ? (m.spokenAs ?? m.name) : null;
}

/** "today", "tomorrow", or the weekday, in the household's own calendar. */
function whenDue(iso: string, timezone: string, now: Date): string {
  const due = localParts(new Date(iso), timezone).date;
  if (due === localParts(now, timezone).date) return 'today';
  if (due === localParts(new Date(now.getTime() + 86_400_000), timezone).date) return 'tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long' }).format(
    new Date(iso),
  );
}

/**
 * The update, as a short message. Its first line stands on its own, because the family
 * group channel puts the person's name in front ("Kunle, Daddy's evening update ...")
 * and a private chat sends it as it is.
 */
export function composeDailyUpdate(state: CareState, now: Date): string {
  const { timezone } = state.household;
  const today = localParts(now, timezone);
  const cared = careRecipients(state);
  // One person: "Daddy's evening update". More than one: "The evening update", and each
  // medication says whose it is, so Grandma's drops are never read as Dad's.
  const who = cared.length === 1 ? `${called(cared[0]!)}'s` : 'The';
  const whose = (forId: string | undefined): string => {
    if (cared.length < 2) return '';
    const m = cared.find((c) => c.id === forId);
    return m ? ` (${called(m)})` : '';
  };
  const heading = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  const lines: string[] = [`${who} evening update - ${heading}.`];

  const doses = activeMedications(state, now)
    .flatMap((med) => med.times.map((time) => ({ med, time })))
    .sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
  if (doses.length > 0) {
    lines.push('', 'Medication');
    for (const { med, time } of doses) {
      const record = doseRecord(state, med.id, time, now);
      const due = parseHHMM(time) ?? 0;
      const status = record
        ? sayWhoSaysSo(attributionOf(record), (id) => nameOf(state, id))
        : today.minutes < due
          ? 'not due yet'
          : 'no record yet';
      lines.push(`- ${med.name}${whose(med.forMemberId)}, ${spokenClock(time)}: ${status}`);
    }
  }

  const horizon = now.getTime() + UPCOMING_DAYS * 86_400_000;
  const upcoming = state.obligations
    .filter((o) => o.status === 'OPEN' || o.status === 'REQUESTED' || o.status === 'ASSIGNED')
    .filter((o) => o.dueAt && Date.parse(o.dueAt) <= horizon)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  if (upcoming.length > 0) {
    lines.push('', 'Coming up');
    for (const o of upcoming) {
      const owner = o.status === 'ASSIGNED' && o.ownerId ? nameOf(state, o.ownerId) : null;
      const asked =
        o.status === 'REQUESTED' && o.request ? nameOf(state, o.request.askedOfId) : null;
      const status = owner
        ? `${owner} has it`
        : asked
          ? `${asked} has been asked, no answer yet`
          : 'nobody has taken this on yet';
      lines.push(`- ${o.what} (${whenDue(o.dueAt!, timezone, now)}): ${status}`);
    }
  }

  const notes = state.events
    .filter((e) => e.kind === 'note_added' && e.detail)
    .filter((e) => localParts(new Date(e.occurredAt), timezone).date === today.date)
    .slice(-NOTES_LIMIT);
  if (notes.length > 0) {
    lines.push('', 'Notes today');
    for (const n of notes) lines.push(`- ${nameOf(state, n.reportedBy) ?? 'Someone'}: ${n.detail}`);
  }

  if (doses.length > 0) {
    lines.push('', '"No record" means nobody logged it - not that it didn\'t happen.');
  }
  return lines.join('\n');
}

/** Who is owed today's update and has not had it. */
export function dueDailyUpdates(state: CareState, now: Date): Member[] {
  const { timezone } = state.household;
  const today = localParts(now, timezone);
  if (today.minutes < (parseHHMM(DAILY_UPDATE_AT) ?? 0)) return [];
  const sent = new Set(
    state.events
      .filter(
        (e) =>
          e.kind === 'member_notified' &&
          e.data['update'] === 'daily' &&
          e.data['localDate'] === today.date,
      )
      .map((e) => e.data['recipientId']),
  );
  return state.members.filter((m) => m.dailyUpdate && !sent.has(m.id));
}

/**
 * Send every update that is due, across households. Safe to call as often as the agent
 * loop ticks: each one is recorded in the care log, and a recorded update is not sent
 * again that day. A delivery that failed on a real channel is not recorded, so the next
 * tick tries again.
 */
export async function sendDailyUpdates(
  deps: { store: CareStore; notifier: Notifier },
  now: Date = new Date(),
): Promise<number> {
  let sent = 0;
  for (const householdId of deps.store.householdIds()) {
    const state = deps.store.getCareState(householdId);
    for (const member of dueDailyUpdates(state, now)) {
      const message = composeDailyUpdate(state, now);
      const delivery = await deps.notifier.deliver({
        to: member.id,
        toName: member.name,
        from: 'CareCircle',
        message,
      });
      if (!delivery.delivered && delivery.channel !== 'none') continue;
      await deps.store.appendEvent({
        householdId,
        kind: 'member_notified',
        reportedBy: AGENT_ID,
        occurredAt: now.toISOString(),
        source: 'system',
        confidence: 'confirmed',
        detail: `Evening update for ${member.name}`,
        data: {
          recipientId: member.id,
          update: 'daily',
          localDate: localParts(now, state.household.timezone).date,
          delivered: delivery.delivered,
          channel: delivery.channel,
        },
      });
      sent += 1;
    }
  }
  return sent;
}
