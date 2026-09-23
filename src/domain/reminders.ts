import { appointmentsOf, activeMedications } from './care-changes.js';
import { doseRecord, localParts, spokenClock, spokenDue } from './gaps.js';
import type { CareStore } from '../store/store.js';
import type { Notifier } from '../notify/notifier.js';
import type { CareState, Member, Obligation } from './types.js';
import { called } from './who.js';

/**
 * Reminders, sent to a person privately and never to the family group.
 *
 *  - At dose time, to the person who takes the medicine, with two big buttons (Taken /
 *    in 15 minutes), because after eye surgery a tap is easier than typing. Only while
 *    there is no record of that dose yet.
 *  - The evening before an appointment and two hours before it: to the person it is
 *    for and whoever is taking them. If nobody has taken what it needs, the coordinator
 *    is told, so the gap is seen while there is still time.
 *
 * Each reminder has a key and is recorded when sent, so a restart never sends one
 * twice. Anyone can turn theirs off.
 */

export interface Button { text: string; data: string }
export interface Reminder { key: string; to: string; text: string; buttons?: Button[][] }

const DOSE_WINDOW_MIN = 30;
const LIVE = new Set<Obligation['status']>(['PROPOSED', 'OPEN', 'REQUESTED', 'ASSIGNED']);

function sentKeys(state: CareState, now: Date): Set<string> {
  const since = now.getTime() - 3 * 86_400_000;
  return new Set(state.events
    .filter((e) => e.kind === 'reminder_sent' && Date.parse(e.occurredAt) >= since)
    .map((e) => `${String(e.data['key'])}|${String(e.data['to'])}`));
}

const wants = (m: Member | undefined): m is Member => !!m && m.reminders !== 'off';

export function dueReminders(state: CareState, now: Date): Reminder[] {
  const tz = state.household.timezone;
  const local = localParts(now, tz);
  const sent = sentKeys(state, now);
  const out: Reminder[] = [];
  const push = (r: Reminder) => { if (!sent.has(`${r.key}|${r.to}`)) out.push(r); };
  const member = (id: string | null | undefined) => state.members.find((m) => m.id === id);

  // Dose time, while there is still no record of it.
  for (const med of activeMedications(state, now)) {
    const who = member(med.forMemberId);
    if (!wants(who)) continue;
    for (const slot of med.times) {
      const due = Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5));
      if (local.minutes < due || local.minutes >= due + DOSE_WINDOW_MIN) continue;
      if (doseRecord(state, med.id, slot, now)) continue;
      push({
        key: `dose:${med.id}:${local.date}:${slot}`, to: who.id,
        text: `It's ${spokenClock(slot)}: time for your ${med.name}.`,
        buttons: [[{ text: '✅ Taken', data: `dose:${med.id}:${slot}` }, { text: '⏰ In 15 minutes', data: `snooze:${med.id}:${slot}` }]],
      });
    }
  }

  // Appointments: the evening before, and two hours before.
  for (const a of appointmentsOf(state)) {
    if (a.cancelled) continue;
    const at = Date.parse(a.at);
    const apptDate = localParts(new Date(at), tz).date;
    const tomorrow = localParts(new Date(now.getTime() + 86_400_000), tz).date;
    const evening = apptDate === tomorrow && local.minutes >= 19 * 60 && local.minutes < 22 * 60;
    const soon = at - now.getTime() <= 2 * 3_600_000 && at - now.getTime() > 60 * 60_000;
    if (!evening && !soon) continue;
    const phase = evening ? 'eve' : '2h';
    const key = `appt-${phase}:${a.eventId}:${a.at}`;
    const when = spokenDue(a.at, tz, now).trim();
    const subject = member(a.forMemberId);
    const them = subject ? called(subject) : 'them';
    const work = state.obligations.filter((o) => o.sourceEventId === a.eventId && LIVE.has(o.status));
    const holders = work.filter((o) => o.status === 'ASSIGNED' && o.ownerId).map((o) => member(o.ownerId)!).filter(Boolean);
    const unowned = work.filter((o) => o.status !== 'ASSIGNED');
    const byWhom = holders.length ? ` ${holders.map(called).join(' and ')} ${holders.length === 1 ? 'is' : 'are'} taking care of ${work[0]?.what.toLowerCase().startsWith('drive') ? 'the ride' : 'it'}.` : '';

    if (wants(subject)) {
      push({ key, to: subject.id, text: `Reminder: ${when}, your ${a.kind}.${byWhom}` });
    }
    for (const h of holders) {
      if (!wants(h) || h.id === subject?.id) continue;
      const mine = work.filter((o) => o.ownerId === h.id).map((o) => o.what);
      push({ key, to: h.id, text: `Reminder: ${when}, ${them}'s ${a.kind}. You have: ${mine.join('; ')}.` });
    }
    if (unowned.length) {
      for (const c of state.members.filter((m) => m.role === 'primary_caregiver')) {
        if (!wants(c)) continue;
        push({
          key: `${key}:unowned`, to: c.id,
          text: `${them}'s ${a.kind} is ${when}, and nobody has taken this on yet: ${unowned.map((o) => o.what).join('; ')}. Say "ask whoever's free" and I'll ask someone.`,
        });
      }
    }
  }
  return out;
}

/** Send what is due now, and record each one so it is never sent twice. */
export async function sendDueReminders(deps: { store: CareStore; notifier: Notifier; now?: Date }): Promise<number> {
  const now = deps.now ?? new Date();
  let sent = 0;
  for (const householdId of deps.store.householdIds()) {
    if (householdId.includes('~')) continue; // demo sandboxes remind nobody
    const state = deps.store.getCareState(householdId);
    for (const r of dueReminders(state, now)) {
      const d = deps.notifier.direct
        ? await deps.notifier.direct({ to: r.to, text: r.text, ...(r.buttons ? { buttons: r.buttons } : {}) })
        : { delivered: false, channel: 'none' as const };
      // Only what reached a phone is recorded. Someone with no chat costs a lookup each
      // minute; a send that failed on the network is simply tried again.
      if (!d.delivered) continue;
      await deps.store.appendEvent({
        householdId, kind: 'reminder_sent', reportedBy: 'system:carecircle', occurredAt: now.toISOString(),
        source: 'system', confidence: 'confirmed', detail: r.text,
        data: { key: r.key, to: r.to },
      });
      sent += 1;
    }
  }
  return sent;
}
