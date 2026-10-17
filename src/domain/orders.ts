import { randomUUID } from 'node:crypto';
import type { CareStore } from '../store/store.js';
import type { CareState, ConsequenceClass, EventSource, Member, Obligation } from './types.js';
import { AGENT_ID } from './agent.js';
import { can } from './auth.js';
import { loadOf } from './delegation.js';
import { localParts, parseHHMM, spokenDue } from './gaps.js';
import { routinesOf } from './routines.js';
import { toInstant } from './time.js';

/**
 * Orders: when the work can be bought in rather than done by hand.
 *
 * Nobody nearby is free to bring Daddy lunch, but his son in Houston can order it from the
 * kitchen Daddy likes. The family already has ways to buy things: the apps on their phones,
 * the pharmacy that delivers, the assistant's own shopping. None of that is rebuilt here.
 * There is no checkout, payment, catalogue or delivery tracking, and nothing is ever bought
 * by this app. What none of those services knows is what this record is for: whose need it
 * is, who said they would order it, and whether it reached him.
 *
 * "The seller says delivered" is not "he has it". An order never closes the work. It puts
 * the work on the name of whoever ordered it, and a person closes it, as with everything
 * else. When whoever ordered it lives far away, the order brings a small job with it:
 * someone nearby taking it in. That job is ordinary work, so the agent finds somebody for
 * it in the usual way, and saying it was taken in closes the order too.
 *
 * An order lives in the event log (`order_placed`), like a routine: who ordered what, from
 * where, and when it is due at the door. Nothing is rewritten.
 */

export interface Order {
  /** The `order_placed` event. */
  id: string;
  /** The work it covers. */
  obligationId: string;
  orderedBy: string;
  /** Who it is for. */
  forMemberId?: string;
  at: string;
  /** Where from, as the family said it: a place, a service, a link. */
  from?: string;
  /** When it is due at the door. */
  arrivesAt?: string;
  /** The job of taking it in, when whoever ordered it is far away. */
  takeInId?: string;
}

/** Every order on the record, oldest first. */
export function ordersOf(state: Pick<CareState, 'events'>): Order[] {
  return state.events
    .filter((e) => e.kind === 'order_placed' && typeof e.data['obligationId'] === 'string')
    .map((e) => ({
      id: e.id,
      obligationId: e.data['obligationId'] as string,
      orderedBy: e.reportedBy,
      ...(typeof e.data['forMemberId'] === 'string' ? { forMemberId: e.data['forMemberId'] } : {}),
      at: e.occurredAt,
      ...(typeof e.data['from'] === 'string' ? { from: e.data['from'] } : {}),
      ...(typeof e.data['arrivesAt'] === 'string' ? { arrivesAt: e.data['arrivesAt'] } : {}),
      ...(typeof e.data['takeInId'] === 'string' ? { takeInId: e.data['takeInId'] } : {}),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** The order a piece of work is part of, as the work it covers or as the taking in. */
export function orderOn(obligationId: string, state: Pick<CareState, 'events'>): Order | undefined {
  return ordersOf(state)
    .reverse()
    .find((x) => x.obligationId === obligationId || x.takeInId === obligationId);
}

/** Work that can be bought and brought to the door, in the words families use for it. */
const BUYABLE =
  /\b(lunch|dinner|breakfast|supper|meals?|food|groceries|shopping|diesel|fuel|gas|water|refill|prescription|pharmacy|medicines?|medication)\b/i;

/** Of those, what a person goes without at a cost to their health. */
const HEALTH =
  /\b(lunch|dinner|breakfast|supper|meals?|food|refill|prescription|pharmacy|medicines?|medication)\b/i;

/**
 * Whether somebody far away could get this done by ordering it in. A meal or the diesel can
 * be; a ride, a night in the house, or a hand with the bath cannot. Work already ordered is
 * not offered again.
 */
export function orderable(o: Obligation, state: CareState): boolean {
  if (orderOn(o.id, state)) return false;
  if (o.routineId) {
    const r = routinesOf(state).find((x) => x.id === o.routineId);
    if (r) return r.area === 'meal' || r.area === 'household' || r.orderFrom !== undefined;
  }
  return BUYABLE.test(o.what);
}

/** Where the family said it usually comes from, when the work is one day of a routine. */
export function usualSource(o: Obligation, state: CareState): string | undefined {
  if (!o.routineId) return undefined;
  return routinesOf(state).find((x) => x.id === o.routineId)?.orderFrom;
}

/**
 * Who far away could order this in, best first: family who can take work on and live
 * elsewhere, and who have not already said no to it or been asked to order it. The people
 * nearby are always asked first (`candidatesFor`); this is the step after them.
 */
export function awayToOrder(o: Obligation, state: CareState): Member[] {
  const declined = new Set(o.declinedBy ?? []);
  const askedBefore = new Set(
    state.events
      .filter(
        (e) =>
          e.kind === 'owner_requested' &&
          e.data['order'] === true &&
          e.data['obligationId'] === o.id &&
          e.data['escalation'] !== true,
      )
      .map((e) => String(e.data['askedOfId'])),
  );
  return state.members
    .filter(
      (m) =>
        m.livesAway &&
        can(m, 'claim_obligation') &&
        m.id !== o.ownerId &&
        m.id !== o.request?.askedOfId &&
        !declined.has(m.id) &&
        !askedBefore.has(m.id),
    )
    .sort((a, b) => loadOf(a.id, state) - loadOf(b.id, state) || a.name.localeCompare(b.name));
}

/** Whether the question this person is answering was the app asking them to order it in. */
export function askedToOrder(o: Obligation, memberId: string, state: CareState): boolean {
  const ask = state.events
    .filter(
      (e) =>
        e.kind === 'owner_requested' &&
        e.reportedBy === AGENT_ID &&
        e.data['obligationId'] === o.id &&
        e.data['askedOfId'] === memberId,
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .at(-1);
  return ask?.data['order'] === true;
}

/** What a yes to ordering it in is followed by: the order goes on the record, then the door. */
export const AFTER_ORDER_YES =
  "Once it's ordered, tell me where from and when it's due, and I'll ask someone nearby to take it in.";

/**
 * When the order is due at the door. "13:00" is on the day of the work it covers, or today;
 * a time already well past today is tomorrow (breakfast ordered the night before). A full
 * local date and time is read as the household's clock.
 */
export function arrivalFrom(
  arrives: string,
  covered: Obligation | undefined,
  timezone: string,
  now: Date,
): { at: string } | { problem: string } {
  const raw = arrives.trim();
  const problem = {
    problem: `I couldn't read "${arrives}" as a time. Ask when it is due at the door, as 24-hour "HH:MM".`,
  };
  if (parseHHMM(raw) === null) {
    const at = toInstant(raw, timezone);
    return at ? { at } : problem;
  }
  const date = localParts(covered?.dueAt ? new Date(covered.dueAt) : now, timezone).date;
  const at = toInstant(`${date}T${raw}:00`, timezone);
  if (!at) return problem;
  if (!covered?.dueAt && Date.parse(at) < now.getTime() - 2 * 3_600_000) {
    const next = localParts(new Date(Date.parse(at) + 86_400_000), timezone).date;
    const tomorrow = toInstant(`${next}T${raw}:00`, timezone);
    return tomorrow ? { at: tomorrow } : problem;
  }
  return { at };
}

export interface OrderInput {
  householdId: string;
  /** Whoever ordered it. */
  by: Member;
  /** The work it covers, when it is already on the record. */
  covered?: Obligation;
  /** What was ordered, as said, when there is no work on the record for it yet. */
  what?: string;
  /** Who it is for. */
  forMember: Member;
  from?: string;
  arrivesAt?: string;
  source: EventSource;
}

export interface OrderResult {
  order: Order;
  /** The work it covers, as it now stands. */
  obligation: Obligation;
  /** Somebody else already had it, so it stayed theirs. */
  heldBy?: Member;
  /** The taking in, when whoever ordered it is far away. */
  takeIn?: Obligation;
}

/**
 * Put an order on the record. The work it covers goes on the name of whoever ordered it,
 * unless somebody else already has it; ordering is how they took it on, the way a yes is
 * for anybody else. Nothing about the order closes it.
 */
export async function recordOrder(
  store: Pick<CareStore, 'appendEvent' | 'createObligation' | 'transition' | 'getCareState'>,
  input: OrderInput,
  now: Date,
): Promise<OrderResult> {
  const { by, covered } = input;
  const state = store.getCareState(input.householdId);
  const name = input.forMember.spokenAs ?? input.forMember.name;
  const orderId = `evt_${randomUUID()}`;
  const heldBy =
    covered?.status === 'ASSIGNED' && covered.ownerId && covered.ownerId !== by.id
      ? state.members.find((m) => m.id === covered.ownerId)
      : undefined;

  let obligation: Obligation;
  if (!covered) {
    const what = input.what!.trim();
    const consequence: ConsequenceClass = HEALTH.test(what) ? 'medical' : 'logistical';
    obligation = await store.createObligation({
      householdId: input.householdId,
      what,
      status: 'ASSIGNED',
      consequence,
      provenance: { kind: 'CONFIRMED', byMemberId: by.id, at: now.toISOString() },
      ownerId: by.id,
      ...(input.arrivesAt ? { dueAt: input.arrivesAt } : {}),
      sourceEventId: orderId,
    });
  } else if (heldBy || (covered.status === 'ASSIGNED' && covered.ownerId === by.id)) {
    obligation = covered;
  } else {
    obligation = await store.transition(
      covered.id,
      input.householdId,
      'ASSIGNED',
      by.id,
      { ownerId: by.id, clearRequest: true },
      'ordered it in',
    );
  }

  // Far away, they cannot open the door. Unless someone at home already has the work, a
  // person nearby has to take it in, and saying so is what closes the order.
  const due = input.arrivesAt ?? obligation.dueAt;
  const takeIn =
    by.livesAway && !heldBy
      ? await store.createObligation({
          householdId: input.householdId,
          what: `Take the delivery${input.from ? ` from ${input.from}` : ''} in to ${name}`,
          status: 'OPEN',
          consequence: obligation.consequence,
          provenance: { kind: 'CONFIRMED', byMemberId: by.id, at: now.toISOString() },
          ownerId: null,
          ...(due ? { dueAt: due } : {}),
          sourceEventId: orderId,
        })
      : undefined;

  const event = await store.appendEvent({
    id: orderId,
    householdId: input.householdId,
    kind: 'order_placed',
    reportedBy: by.id,
    occurredAt: now.toISOString(),
    source: input.source,
    confidence: 'reported',
    detail: obligation.what,
    data: {
      obligationId: obligation.id,
      forMemberId: input.forMember.id,
      ...(input.from ? { from: input.from } : {}),
      ...(input.arrivesAt ? { arrivesAt: input.arrivesAt } : {}),
      ...(takeIn ? { takeInId: takeIn.id } : {}),
    },
  });

  return {
    order: {
      id: event.id,
      obligationId: obligation.id,
      orderedBy: by.id,
      forMemberId: input.forMember.id,
      at: event.occurredAt,
      ...(input.from ? { from: input.from } : {}),
      ...(input.arrivesAt ? { arrivesAt: input.arrivesAt } : {}),
      ...(takeIn ? { takeInId: takeIn.id } : {}),
    },
    obligation,
    ...(heldBy ? { heldBy } : {}),
    ...(takeIn ? { takeIn } : {}),
  };
}

const LIVE = new Set<Obligation['status']>(['OPEN', 'REQUESTED', 'ASSIGNED']);

/**
 * "Ask Musa to take it in", said about the lunch Kunle ordered: the lunch stays on his
 * name, so the ask is about the delivery. The take-in job for work this member ordered in,
 * while it is still open to someone.
 */
export function takeInFor(
  o: Obligation,
  memberId: string,
  state: Pick<CareState, 'events' | 'obligations'>,
): Obligation | undefined {
  return o.ownerId === memberId ? liveTakeIn(o, state) : undefined;
}

/**
 * "Done, I took the lunch in to Daddy", from Musa about the lunch Kunle ordered: what Musa
 * is closing is the taking in, and that closes the lunch too. The take-in job for work
 * someone ordered in, when this member has it.
 */
export function takeInHeldBy(
  o: Obligation,
  memberId: string,
  state: Pick<CareState, 'events' | 'obligations'>,
): Obligation | undefined {
  const takeIn = liveTakeIn(o, state);
  return takeIn?.ownerId === memberId ? takeIn : undefined;
}

function liveTakeIn(
  o: Obligation,
  state: Pick<CareState, 'events' | 'obligations'>,
): Obligation | undefined {
  const order = orderOn(o.id, state);
  if (!order?.takeInId || order.obligationId !== o.id) return undefined;
  const takeIn = state.obligations.find((x) => x.id === order.takeInId);
  return takeIn && LIVE.has(takeIn.status) ? takeIn : undefined;
}

/**
 * After a person marks one half of an order done, the other half follows on their word.
 * Taking the delivery in to him is the order reaching him, so the work it covers is done.
 * And once whoever ordered it says it reached him, nobody needs to be found to take it in.
 * Returns the work that followed, if any.
 */
export async function closeAlongside(
  store: Pick<CareStore, 'appendEvent' | 'transition' | 'getCareState'>,
  householdId: string,
  done: Obligation,
  byMemberId: string,
  now: Date,
): Promise<Obligation | undefined> {
  const state = store.getCareState(householdId);
  const order = orderOn(done.id, state);
  if (!order?.takeInId) return undefined;
  const by = state.members.find((m) => m.id === byMemberId);
  const name = by?.spokenAs ?? by?.name ?? 'Someone';

  if (done.id === order.takeInId) {
    const covered = state.obligations.find((o) => o.id === order.obligationId);
    if (!covered || !LIVE.has(covered.status)) return undefined;
    const note = `${name} took the delivery in`;
    const closed = await store.transition(
      covered.id,
      householdId,
      'RESOLVED',
      byMemberId,
      { resolvedAt: now.toISOString(), resolutionNote: note, clearRequest: true },
      note,
    );
    await store.appendEvent({
      householdId,
      kind: 'obligation_resolved',
      reportedBy: byMemberId,
      occurredAt: now.toISOString(),
      source: 'system',
      confidence: 'confirmed',
      detail: note,
      data: { obligationId: covered.id, takenIn: order.takeInId },
    });
    return closed;
  }

  const takeIn = state.obligations.find((o) => o.id === order.takeInId);
  if (!takeIn || !LIVE.has(takeIn.status)) return undefined;
  const cared = state.members.find((m) => m.id === order.forMemberId);
  return store.transition(
    takeIn.id,
    householdId,
    'DISMISSED',
    byMemberId,
    { ownerId: null, clearRequest: true },
    `${name} said it already reached ${cared?.spokenAs ?? cared?.name ?? 'them'}`,
  );
}

/** How long after it is ordered nothing can have reached him yet. */
const JUST_ORDERED_MINUTES = 10;

/**
 * "I ordered Mom's dinner, it'll be there at six" is said in the past tense, and can be heard
 * as done. Nothing ordered minutes ago, and not due yet, has reached anyone. What to say
 * instead of marking it done, if that is the case.
 */
export function justOrdered(o: Obligation, state: CareState, now: Date): string | undefined {
  const order = orderOn(o.id, state);
  if (!order || now.getTime() - Date.parse(order.at) > JUST_ORDERED_MINUTES * 60_000) {
    return undefined;
  }
  if (order.arrivesAt && Date.parse(order.arrivesAt) <= now.getTime()) return undefined;
  const work = state.obligations.find((x) => x.id === order.obligationId);
  const cared = state.members.find((m) => m.id === order.forMemberId);
  const due = order.arrivesAt
    ? `, due${spokenDue(order.arrivesAt, state.household.timezone, now)}`
    : '';
  return (
    `"${work?.what ?? o.what}" was only just ordered${due}. It isn't done until someone says ` +
    `it reached ${cared?.spokenAs ?? cared?.name ?? 'them'}, so it stays open. Tell the person that.`
  );
}

/** How far from the time an order is due a delivery at the door can still be that order. */
const DELIVERY_WINDOW_HOURS = 3;

/**
 * A delivery the doorbell saw, matched to the order it may be. Ring can tell a delivery from
 * a visitor, never what is in the bag, so this is only ever a question for a person: the
 * work it names is what a yes would close (the taking in, when there is one).
 */
export function deliveryFor(
  state: CareState,
  at: Date,
  recipientName: string,
): { obligationId: string; ask: string } | undefined {
  const tz = state.household.timezone;
  const live = (id: string | undefined) =>
    state.obligations.find((o) => o.id === id && LIVE.has(o.status));
  let best: { order: Order; apart: number } | undefined;
  for (const order of ordersOf(state)) {
    if (!live(order.obligationId) && !live(order.takeInId)) continue;
    const due = order.arrivesAt ?? live(order.obligationId)?.dueAt;
    const apart = due ? Math.abs(Date.parse(due) - at.getTime()) : 0;
    if (due && apart > DELIVERY_WINDOW_HOURS * 3_600_000) continue;
    if (!due && at.getTime() - Date.parse(order.at) > 24 * 3_600_000) continue;
    if (!best || apart < best.apart) best = { order, apart };
  }
  if (!best) return undefined;
  const { order } = best;
  const work = state.obligations.find((o) => o.id === order.obligationId);
  const who = state.members.find((m) => m.id === order.orderedBy);
  const from = order.from ? ` from ${order.from}` : '';
  const due = order.arrivesAt ? `, due${spokenDue(order.arrivesAt, tz, at)}` : '';
  const target = live(order.takeInId) ?? work!;
  return {
    obligationId: target.id,
    ask:
      `A delivery arrived at ${recipientName}'s door. It may be "${work?.what ?? 'the order'}", ` +
      `which ${who?.spokenAs ?? who?.name ?? 'someone'} ordered${from}${due}. ` +
      `Has it reached ${recipientName}?`,
  };
}
