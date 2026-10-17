import type { CareStore } from '../store/store.js';
import { AGENT_ID } from './agent.js';
import type { CareState, ConsequenceClass, Obligation } from './types.js';
import { localParts, parseHHMM, spokenClock } from './gaps.js';
import { clockTime, isLocalToday } from './local-time.js';
import { orderOn, type Order } from './orders.js';
import { toInstant } from './time.js';

/**
 * Routines: the work that comes round again.
 *
 * Care is not only medicine. After an operation someone has to bring lunch, someone has to
 * be in the house at night, someone has to help with the bath, and somebody has to buy
 * diesel before the generator runs dry. None of it is said out loud each day, which is
 * exactly why it is the work that slips.
 *
 * A routine is set up once ("someone brings Daddy lunch every day at 1") and each time it
 * comes round becomes ordinary work on the record, a day ahead. That is the whole design:
 * once it is ordinary work, everything already built applies to it unchanged - who's free,
 * asking rather than assigning, "still on?", the promises page, and "nothing's been marked
 * yet" rather than blame. Medicine stays on its own schedule (`MedicationSchedule`): a dose
 * is something the person does, where a routine is something somebody does for them.
 *
 * A routine lives in the event log, like an appointment: `routine_set` says who set it up
 * and when, `routine_stopped` ends it, and nothing is rewritten.
 */

export type RoutineArea = 'meal' | 'safety' | 'personal' | 'household';

export const ROUTINE_AREAS: readonly RoutineArea[] = ['meal', 'safety', 'personal', 'household'];

/**
 * What a dropped day costs. Going without a meal after an operation, or alone at night
 * when a fall is likely, is a health matter; a missed bath or a dry generator is a hard
 * day. The class is what the gap engine and the agent weigh, so it is fixed by the area,
 * not chosen per routine by a model.
 */
export const CONSEQUENCE_OF: Record<RoutineArea, ConsequenceClass> = {
  meal: 'medical',
  safety: 'medical',
  personal: 'logistical',
  household: 'logistical',
};

export interface Routine {
  /** The `routine_set` event. Each day's work points back to it. */
  id: string;
  householdId: string;
  /** As the family says it, and as each day's work is named: "Bring Daddy lunch". */
  what: string;
  area: RoutineArea;
  /** Local times of day, "HH:MM". */
  times: string[];
  /** Days of the week it comes round, 0 = Sunday. Every day when absent. */
  days?: number[];
  /** Who it is for, when the family cares for more than one person. */
  forMemberId: string | null;
  /** Who set it up, and so who stands behind each day's work being needed. */
  setBy: string;
  since: string;
  /**
   * Only ever the person who set it up, saying it is theirs: "I'll bring Daddy lunch every
   * day". Each day's work is then theirs from the start. Nobody can set a routine up on
   * someone else's name; everyone else is asked, day by day.
   */
  ownerId?: string;
  /**
   * Where it can be ordered from when nobody nearby is free, as the family says it: a place,
   * a service, a link they use. Only ever passed on to whoever orders; nothing is bought here.
   */
  orderFrom?: string;
  stoppedAt?: string;
  stoppedBy?: string;
}

/** Every routine, as it stands after any stop, in the order they were set up. */
export function routinesOf(state: Pick<CareState, 'events'>): Routine[] {
  const byId = new Map<string, Routine>();
  for (const e of state.events) {
    if (e.kind === 'routine_set') {
      const d = e.data;
      const area = d['area'] as RoutineArea;
      const times = Array.isArray(d['times']) ? (d['times'] as string[]) : [];
      if (!ROUTINE_AREAS.includes(area) || typeof d['what'] !== 'string' || !times.length) continue;
      byId.set(e.id, {
        id: e.id,
        householdId: e.householdId,
        what: d['what'],
        area,
        times,
        ...(Array.isArray(d['days']) ? { days: d['days'] as number[] } : {}),
        forMemberId: (d['forMemberId'] as string | undefined) ?? null,
        setBy: e.reportedBy,
        since: e.occurredAt,
        ...(typeof d['ownerId'] === 'string' ? { ownerId: d['ownerId'] } : {}),
        ...(typeof d['orderFrom'] === 'string' ? { orderFrom: d['orderFrom'] } : {}),
      });
    } else if (e.kind === 'routine_stopped') {
      const r = byId.get(String(e.data['routineId']));
      if (r && !r.stoppedAt) {
        r.stoppedAt = e.occurredAt;
        r.stoppedBy = e.reportedBy;
      }
    }
  }
  return [...byId.values()];
}

/** Routines still coming round at this moment. */
export function activeRoutines(state: Pick<CareState, 'events'>, now: Date): Routine[] {
  return routinesOf(state).filter((r) => !r.stoppedAt || Date.parse(r.stoppedAt) > now.getTime());
}

/**
 * How far ahead each day's work is put on the record. A day is enough for the agent to
 * find someone free and, the day before, to ask whoever said yes if it is still on; any
 * further and the board would show the same lunch twice.
 */
export const ROUTINE_AHEAD_HOURS = 24;

/** The id of one day's work, so putting it on the record twice is impossible. */
export function occurrenceId(routineId: string, date: string, time: string): string {
  return `obl_rt_${routineId}_${date}_${time.replace(':', '')}`;
}

export interface Occurrence {
  id: string;
  routine: Routine;
  /** The instant it is due. */
  at: string;
}

/** Each time a routine comes round after `now` and within the day ahead. */
export function upcomingOccurrences(state: CareState, now: Date): Occurrence[] {
  const tz = state.household.timezone;
  const until = now.getTime() + ROUTINE_AHEAD_HOURS * 3_600_000;
  // The local dates the window touches: today, tomorrow, and the day after in case the
  // window crosses two midnights on a clock change.
  const dates = [0, 1, 2].map((d) => localParts(new Date(now.getTime() + d * 86_400_000), tz).date);
  const out: Occurrence[] = [];
  for (const routine of activeRoutines(state, now)) {
    for (const date of new Set(dates)) {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (routine.days && !routine.days.includes(weekday)) continue;
      for (const time of routine.times) {
        if (parseHHMM(time) === null) continue;
        const at = toInstant(`${date}T${time}:00`, tz);
        if (!at) continue;
        const t = Date.parse(at);
        if (t <= now.getTime() || t > until || t < Date.parse(routine.since)) continue;
        if (routine.stoppedAt && t >= Date.parse(routine.stoppedAt)) continue;
        out.push({ id: occurrenceId(routine.id, date, time), routine, at });
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Whether a routine day's time has gone. Nobody can bring today's lunch once one o'clock has
 * passed, so it is not worth asking anyone about; what the record says of it stays.
 */
export function routineDayPassed(o: Obligation, now: Date): boolean {
  return o.routineId !== undefined && o.dueAt !== undefined && Date.parse(o.dueAt) <= now.getTime();
}

/**
 * Put the next day of every routine on the record. Idempotent: each day's work has a fixed
 * id, so running this every few minutes adds each one once.
 *
 * Nothing about the person cared for is attached to the work (`aboutEntityId`): their
 * standing needs speak about rides ("fewer fall-back rides"), and a lunch is not a ride.
 *
 * An ask nobody answered before the time came is taken back, so it does not sit in that
 * person's requests as a question about a lunch already past.
 */
export async function putRoutinesOnRecord(
  store: Pick<CareStore, 'getCareState' | 'createObligation' | 'transition'>,
  householdId: string,
  now: Date,
): Promise<Obligation[]> {
  for (const o of store.getCareState(householdId).obligations) {
    if (o.status !== 'REQUESTED' || !routineDayPassed(o, now)) continue;
    await store.transition(
      o.id,
      householdId,
      'OPEN',
      AGENT_ID,
      { clearRequest: true },
      'its time passed before anyone answered',
    );
  }
  const state = store.getCareState(householdId);
  const have = new Set(state.obligations.map((o) => o.id));
  const added: Obligation[] = [];
  for (const occ of upcomingOccurrences(state, now)) {
    if (have.has(occ.id)) continue;
    const r = occ.routine;
    added.push(
      await store.createObligation({
        id: occ.id,
        householdId,
        what: r.what,
        status: r.ownerId ? 'ASSIGNED' : 'OPEN',
        consequence: CONSEQUENCE_OF[r.area],
        // The person who set the routine up said this needs doing; each day is that same word.
        provenance: { kind: 'CONFIRMED', byMemberId: r.setBy, at: r.since },
        ownerId: r.ownerId ?? null,
        dueAt: occ.at,
        sourceEventId: r.id,
        routineId: r.id,
      }),
    );
  }
  return added;
}

/**
 * End a routine's days still to come. Work already done stays done, and so does a yes
 * already given for a day that has passed; only the days ahead are taken off.
 */
export async function takeRoutineOffRecord(
  store: Pick<CareStore, 'getCareState' | 'transition'>,
  householdId: string,
  routineId: string,
  byMemberId: string,
  now: Date,
): Promise<number> {
  const state = store.getCareState(householdId);
  const ahead = state.obligations.filter(
    (o) =>
      o.routineId === routineId &&
      (o.status === 'OPEN' || o.status === 'REQUESTED' || o.status === 'ASSIGNED') &&
      o.dueAt !== undefined &&
      Date.parse(o.dueAt) > now.getTime(),
  );
  for (const o of ahead) {
    await store.transition(
      o.id,
      householdId,
      'DISMISSED',
      byMemberId,
      { ownerId: null, clearRequest: true },
      'the routine was stopped',
    );
  }
  return ahead.length;
}

export interface RoutineDay {
  day: Obligation;
  routine: Routine | undefined;
}

/** Today's days of every routine, in time order, including any already done or stopped short. */
export function routineDaysToday(state: CareState, now: Date): RoutineDay[] {
  const tz = state.household.timezone;
  const routines = new Map(routinesOf(state).map((r) => [r.id, r]));
  return state.obligations
    .filter(
      (o) =>
        o.routineId !== undefined &&
        o.dueAt !== undefined &&
        o.status !== 'DISMISSED' &&
        o.status !== 'PROPOSED' &&
        isLocalToday(o.dueAt, now, tz),
    )
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
    .map((day) => ({ day, routine: routines.get(day.routineId!) }));
}

/** "; Funmi is taking it in": the half of an order someone nearby does. */
function takingIn(order: Order, state: CareState, who: (id: string | null | undefined) => string) {
  const t = state.obligations.find((o) => o.id === order.takeInId);
  if (!t) return '';
  switch (t.status) {
    case 'ASSIGNED': {
      const name = who(t.ownerId);
      return `; ${name} ${name === 'you' ? 'are' : 'is'} taking it in`;
    }
    case 'REQUESTED': {
      const name = who(t.request?.askedOfId);
      return `; ${name} ${name === 'you' ? 'were' : 'was'} asked to take it in`;
    }
    case 'OPEN':
      return '; nobody is taking it in yet';
    default:
      return '';
  }
}

/** "1 PM", "8:30 AM": an instant as the household's clock says it. */
function spokenAt(iso: string, timezone: string): string {
  const { minutes } = localParts(new Date(iso), timezone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return spokenClock(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
}

/**
 * One day of a routine as the record has it: "Bring Daddy lunch at 1 PM: Funmi marked it done
 * at 1:10 PM." Only what was recorded is said. A day past its time with nothing marked is
 * "nothing's marked yet", never "it wasn't done": the lunch may well have been eaten, and
 * the person who had it is not to be accused by an empty record.
 */
export function sayRoutineDay(
  day: Obligation,
  state: CareState,
  now: Date,
  readerId?: string,
): string {
  const tz = state.household.timezone;
  const who = (id: string | undefined | null) => {
    if (id && id === readerId) return 'you';
    const m = state.members.find((x) => x.id === id);
    return m?.spokenAs ?? m?.name ?? 'someone';
  };
  const head = `${day.what} at ${spokenAt(day.dueAt!, tz)}`;
  // Ordered in: who ordered it and from where, and who is taking it in when they can't.
  const order = orderOn(day.id, state);
  const ordered =
    order?.obligationId === day.id
      ? `${who(order.orderedBy)} ordered it${order.from ? ` from ${order.from}` : ''}`
      : undefined;
  switch (day.status) {
    case 'RESOLVED': {
      const marked = [...state.events]
        .reverse()
        .find((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === day.id);
      const at = day.resolvedAt ? ` at ${clockTime(day.resolvedAt, tz)}` : '';
      const did = marked?.data['takenIn'] ? 'took it in' : 'marked it done';
      const by = marked ? `${who(marked.reportedBy)} ${did}` : 'marked done';
      return ordered ? `${head}: ${ordered}, and ${by}${at}` : `${head}: ${by}${at}`;
    }
    case 'ASSIGNED': {
      const has = day.ownerId === readerId ? 'you have it' : `${who(day.ownerId)} has it`;
      const past = Date.parse(day.dueAt!) < now.getTime();
      const marked = past ? ", and nothing's marked yet" : '';
      if (ordered && order) {
        // Due at the routine's own time goes without saying.
        const due =
          order.arrivesAt && Date.parse(order.arrivesAt) !== Date.parse(day.dueAt!)
            ? `, due at ${spokenAt(order.arrivesAt, tz)}`
            : '';
        const mine = day.ownerId === order.orderedBy;
        return `${head}: ${mine ? '' : `${has}, and `}${ordered}${due}${takingIn(order, state, who)}${marked}`;
      }
      return `${head}: ${has}${marked}`;
    }
    case 'REQUESTED': {
      const asked = day.request?.askedOfId;
      return asked === readerId
        ? `${head}: you were asked, and haven't answered yet`
        : `${head}: ${who(asked)} was asked, and hasn't answered yet`;
    }
    default:
      return `${head}: nobody has it yet`;
  }
}
