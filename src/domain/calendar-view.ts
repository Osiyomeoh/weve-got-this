import { appointmentsOf, isActiveMedication } from './care-changes.js';
import { DOSE_GRACE_MINUTES, doseRecord, localParts, spokenClock } from './gaps.js';
import { clockTime } from './local-time.js';
import { toInstant } from './time.js';
import type { CareState, Member, Obligation } from './types.js';
import { called } from './who.js';

/**
 * The family calendar: the whole picture for the days ahead, in one place.
 *
 * Nothing here is stored separately. Every line is read from the care record as it
 * stands: each dose time and whether there is a record of it (and whose), each
 * appointment and the work it needs, and whoever has taken that work on, or that nobody
 * has yet. So the calendar and what the bot says can never disagree.
 */

export type ItemStatus =
  | 'recorded'
  | 'no-record'
  | 'due'
  | 'upcoming'
  | 'proposed'
  | 'unowned'
  | 'asked'
  | 'owned'
  | 'done'
  | 'cancelled';

export interface CalendarItem {
  kind: 'dose' | 'appointment' | 'task';
  /** The instant it happens, or is due. */
  at: string | null;
  /** "8 PM", in the family's time. */
  time: string | null;
  title: string;
  /** Whose it is, as the family says it ("Dad"). */
  forName: string | null;
  status: ItemStatus;
  /** One line a person reads: "from Sandra at 8:05 AM", "Sandra is taking him", "nobody yet". */
  detail: string;
  ids: {
    medicationId?: string;
    slot?: string;
    appointmentEventId?: string;
    obligationId?: string;
    forMemberId?: string;
  };
  /** For an appointment: the work it needs (a ride, someone to go along). */
  work?: CalendarItem[];
}

export interface CalendarDay {
  date: string;
  label: string;
  items: CalendarItem[];
}

export interface CalendarView {
  household: { name: string; timezone: string };
  today: string;
  from: string;
  days: CalendarDay[];
  /** Live work with no date. */
  undated: CalendarItem[];
  people: { name: string; role: Member['role']; id: string }[];
  /** The whole picture in two numbers. */
  counts: { needsSomeone: number; noRecordToday: number };
}

const LIVE = new Set<Obligation['status']>(['PROPOSED', 'OPEN', 'REQUESTED', 'ASSIGNED']);

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(date: string, today: string, timezone: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  const at = toInstant(`${date}T12:00:00`, timezone) ?? `${date}T12:00:00Z`;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  }).format(new Date(at));
}

function workItem(
  o: Obligation,
  state: CareState,
  nameOf: (id: string | null | undefined) => string,
): CalendarItem {
  const tz = state.household.timezone;
  const asked = o.request?.askedOfId;
  const status: ItemStatus =
    o.status === 'RESOLVED'
      ? 'done'
      : o.status === 'ASSIGNED'
        ? 'owned'
        : o.status === 'REQUESTED'
          ? 'asked'
          : o.status === 'PROPOSED'
            ? 'proposed'
            : 'unowned';
  const detail =
    status === 'done'
      ? `done${o.ownerId ? ` by ${nameOf(o.ownerId)}` : ''}`
      : status === 'owned'
        ? `${nameOf(o.ownerId)} has it`
        : status === 'asked'
          ? `asked ${nameOf(asked)}, waiting for an answer`
          : status === 'proposed'
            ? 'needs a yes: is this needed?'
            : 'nobody yet';
  const about = state.members.find((m) => m.id === o.aboutEntityId);
  return {
    kind: 'task',
    at: o.dueAt ?? null,
    time: o.dueAt ? clockTime(o.dueAt, tz) : null,
    title: o.what,
    forName: about ? called(about) : null,
    status,
    detail,
    ids: { obligationId: o.id, ...(about ? { forMemberId: about.id } : {}) },
  };
}

export function calendarView(state: CareState, now: Date, days = 7, from?: string): CalendarView {
  const tz = state.household.timezone;
  const today = localParts(now, tz).date;
  const nameOf = (id: string | null | undefined) => {
    const m = state.members.find((x) => x.id === id);
    return m ? called(m) : 'someone';
  };
  const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : today;
  const span = Math.max(1, Math.min(days, 62));
  const dates = Array.from({ length: span }, (_, i) => addDays(start, i));
  const byDate = new Map<string, CalendarItem[]>(dates.map((d) => [d, []]));
  const nowMin = localParts(now, tz).minutes;

  // A medicine was not expected before it was on the schedule. Older schedules carry no
  // date, so for them the record's first entry stands in: never an empty month of
  // "no record" from before anyone was using the app.
  const firstEntry = state.events.reduce<string | null>(
    (min, e) => (!min || e.occurredAt < min ? e.occurredAt : min),
    null,
  );
  const startOf = (since: string | undefined) => {
    const at = since ?? firstEntry;
    return at ? localParts(new Date(at), tz).date : today;
  };

  // Every dose time, each day, with whether there is a record of it.
  for (const date of dates) {
    const noon = new Date(toInstant(`${date}T12:00:00`, tz) ?? `${date}T12:00:00Z`);
    for (const med of state.medications) {
      if (date < startOf(med.since)) continue;
      if (!isActiveMedication(med, date === today ? now : noon, tz)) continue;
      for (const slot of med.times) {
        const at = toInstant(`${date}T${slot}:00`, tz);
        if (!at) continue;
        const who = state.members.find((m) => m.id === med.forMemberId);
        // doseRecord reads "which day" from the instant it is given: noon of that day.
        const record =
          date <= today ? doseRecord(state, med.id, slot, date === today ? now : noon) : undefined;
        const due = Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5));
        const status: ItemStatus = record
          ? 'recorded'
          : date > today
            ? 'upcoming'
            : date < today || nowMin > due + DOSE_GRACE_MINUTES
              ? 'no-record'
              : nowMin >= due
                ? 'due'
                : 'upcoming';
        const detail = record
          ? `recorded at ${clockTime(record.occurredAt, tz)}${record.reportedBy === med.forMemberId ? '' : `, from ${nameOf(record.reportedBy)}`}`
          : status === 'no-record'
            ? 'no record yet'
            : status === 'due'
              ? 'due now'
              : '';
        byDate.get(date)!.push({
          kind: 'dose',
          at,
          time: spokenClock(slot),
          title: med.name,
          forName: who ? called(who) : null,
          status,
          detail,
          ids: { medicationId: med.id, slot, forMemberId: med.forMemberId },
        });
      }
    }
  }

  // Appointments, with the work each one needs nested under it.
  const shownWork = new Set<string>();
  for (const a of appointmentsOf(state)) {
    const date = localParts(new Date(a.at), tz).date;
    const list = byDate.get(date);
    if (!list) continue;
    const work = a.cancelled
      ? []
      : state.obligations
          .filter(
            (o) => o.sourceEventId === a.eventId && (LIVE.has(o.status) || o.status === 'RESOLVED'),
          )
          .map((o) => {
            shownWork.add(o.id);
            return workItem(o, state, nameOf);
          });
    const who = state.members.find((m) => m.id === a.forMemberId);
    const needs = work.filter(
      (w) => w.status === 'unowned' || w.status === 'proposed' || w.status === 'asked',
    );
    list.push({
      kind: 'appointment',
      at: a.at,
      time: clockTime(a.at, tz),
      title: a.kind,
      forName: who ? called(who) : null,
      status: a.cancelled ? 'cancelled' : needs.length ? 'unowned' : 'owned',
      detail: a.cancelled
        ? 'cancelled'
        : work.length === 0
          ? ''
          : needs.length
            ? `${needs.length === 1 ? 'one thing needs' : `${needs.length} things need`} someone`
            : 'all arranged',
      ids: {
        appointmentEventId: a.eventId,
        ...(a.forMemberId ? { forMemberId: a.forMemberId } : {}),
      },
      work,
    });
  }

  // Other work with a date in the window; undated live work kept apart.
  const undated: CalendarItem[] = [];
  for (const o of state.obligations) {
    if (shownWork.has(o.id) || !LIVE.has(o.status)) continue;
    if (!o.dueAt) {
      undated.push(workItem(o, state, nameOf));
      continue;
    }
    const list = byDate.get(localParts(new Date(o.dueAt), tz).date);
    if (list) list.push(workItem(o, state, nameOf));
  }

  for (const list of byDate.values()) list.sort((x, y) => (x.at ?? '').localeCompare(y.at ?? ''));
  const all = [...byDate.values()].flat();
  const needsSomeone = [...all.flatMap((i) => [i, ...(i.work ?? [])]), ...undated].filter(
    (i) => i.kind === 'task' && (i.status === 'unowned' || i.status === 'proposed'),
  ).length;
  return {
    household: { name: state.household.name, timezone: tz },
    today,
    from: start,
    days: dates.map((date) => ({
      date,
      label: dayLabel(date, today, tz),
      items: byDate.get(date)!,
    })),
    undated,
    people: state.members.map((m) => ({ name: called(m), role: m.role, id: m.id })),
    counts: {
      needsSomeone,
      noRecordToday: (byDate.get(today) ?? []).filter((i) => i.status === 'no-record').length,
    },
  };
}
