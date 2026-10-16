/**
 * The purchase moment.
 *
 * Some Care Gaps are closed not by a person doing the task but by buying the thing:
 * a prescription that needs reordering. The app turns that into an OFFER - priced,
 * sourced, with an ETA - that a human confirms in place. It never charges on its own:
 * a purchase follows the same discipline as everything else here, Known != Assumed.
 * The offer is a proposal; only a confirmation makes it real.
 *
 * These are simulated storefronts for the hackathon - no real payment is taken. The
 * shape is exactly what a real MCP commerce integration would return, so the seam is
 * honest about what it is and ready for a real merchant behind it. Adding a second
 * purchase kind (e.g. a paid medical ride) is a new OfferKind and one branch here.
 */

import { namesMedicine } from './language.js';
import type { MedicationSchedule } from './types.js';

export type OfferKind = 'prescription_refill';

export interface PurchaseOffer {
  offerId: string;
  kind: OfferKind;
  /** What is being bought, in plain words. */
  item: string;
  merchant: string;
  amountCents: number;
  currency: 'USD';
  /** When it lands, phrased for speech. */
  etaText: string;
  /** The Care Gap this purchase would close, if any. */
  obligationId?: string;
  /** Always true here: no real card is charged. */
  simulated: true;
}

export function formatPrice(amountCents: number, currency: 'USD' = 'USD'): string {
  const symbol = currency === 'USD' ? '$' : '';
  return `${symbol}${(amountCents / 100).toFixed(2)}`;
}

interface OfferContext {
  offerId: string;
  /** The medication or item name, when reordering. */
  itemName?: string;
  obligationId?: string;
}

/**
 * Build a priced offer. Deterministic so the demo - and the tests - see the same
 * numbers every time. A real integration swaps this for a live catalogue lookup
 * behind the same return type.
 */
export function offerFor(kind: OfferKind, ctx: OfferContext): PurchaseOffer {
  const item = ctx.itemName
    ? `${ctx.itemName} refill - 30-day supply`
    : 'Prescription refill - 30-day supply';
  return {
    offerId: ctx.offerId,
    kind,
    item,
    merchant: 'Cornerside Pharmacy',
    amountCents: 1200,
    currency: 'USD',
    etaText: 'delivered to the door by tomorrow evening',
    simulated: true,
    ...(ctx.obligationId ? { obligationId: ctx.obligationId } : {}),
  };
}

/** The single sentence the assistant speaks when it presents an offer. */
export function offerSpoken(offer: PurchaseOffer): string {
  return (
    `${offer.item} from ${offer.merchant} is ${formatPrice(offer.amountCents, offer.currency)}, ` +
    `${offer.etaText}. Want me to place it? Nothing is charged until you confirm.`
  );
}

/** Work a refill would close: "Pick up Daddy's eye drops refill", "Pharmacy run". */
const REFILL_WORK = /refill|prescription|pharmacy/i;

/** Words that ask for "a prescription" without saying which one. */
const GENERIC_ITEM =
  /^(?:prescriptions?|medicines?|medications?|meds|pills?|drugs|tablets|refills?)$/;

/** "his prescription", "Daddy's meds", "the usual" -> "" when nothing specific was named. */
function specificPart(said: string): string {
  const words = said
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(?:his|her|my|their|the|a|usual|own|\S+'s|\S+’s)$/.test(w));
  const rest = words.join(' ');
  return GENERIC_ITEM.test(rest) ? '' : rest;
}

export type RefillChoice =
  | { ok: true; itemName?: string; obligationId?: string }
  /** More than one medication fits; the person has to say which. */
  | { ok: false; choices: string[] };

/**
 * Work out what "refill his prescription" means, from what the household has on record.
 *
 * The planner cannot see the medication list, so left to itself it asks "which
 * medication?" - a question the family should not have to answer when there is only
 * one it could be. This answers it from the record, and asks only when the record
 * cannot: a named item matching two medications, or an unnamed one with several and
 * no refill already waiting to say which. It never picks the first of several.
 *
 * It also finds the open refill work the purchase would close, so confirming the order
 * takes that work off the list.
 */
export function chooseRefill(
  said: string | undefined,
  medications: readonly Pick<MedicationSchedule, 'name' | 'names'>[],
  openWork: readonly { id: string; what: string }[],
): RefillChoice {
  const refillWork = openWork.filter((o) => REFILL_WORK.test(o.what));
  const mentions = (text: string, name: string) => text.toLowerCase().includes(name.toLowerCase());
  const named = said ? specificPart(said) : '';

  let itemName: string | undefined;
  if (named) {
    // By any name the family gave it; the order goes out under the name on the record.
    const matches = medications.filter((m) => namesMedicine(named, m));
    if (matches.length > 1) return { ok: false, choices: matches.map((m) => m.name) };
    // Not on the schedule is still a real thing to buy; keep their words.
    itemName = matches[0]?.name ?? said!.trim();
  } else {
    const waiting = medications.filter((m) => refillWork.some((o) => mentions(o.what, m.name)));
    if (waiting.length === 1) itemName = waiting[0]!.name;
    else if (medications.length === 1) itemName = medications[0]!.name;
    else if (medications.length > 1) {
      return {
        ok: false,
        choices: (waiting.length > 1 ? waiting : medications).map((m) => m.name),
      };
    }
  }

  const closes = itemName ? refillWork.filter((o) => mentions(o.what, itemName!)) : refillWork;
  return {
    ok: true,
    ...(itemName ? { itemName } : {}),
    ...(closes.length === 1 ? { obligationId: closes[0]!.id } : {}),
  };
}

/** How long an unanswered offer can be confirmed without naming it. Prices and ETAs go stale. */
export const OFFER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Offers still waiting for a yes or a no, newest first.
 *
 * "Yes, place the order" often arrives without the offer's id - a new conversation, or
 * the offer was seen on the TV or in the family group. This is how confirm_purchase
 * finds what "the order" means. Offers older than OFFER_TTL_MS are left out: a day-old
 * price is not something to commit money against without reading it again.
 */
export function waitingOffers(
  events: readonly {
    kind: string;
    reportedBy: string;
    occurredAt: string;
    data: Record<string, unknown>;
  }[],
  at: Date,
): { offer: PurchaseOffer; offeredBy: string }[] {
  const answered = new Set(
    events.filter((e) => e.kind === 'purchase_completed').map((e) => e.data['offerId']),
  );
  return events
    .filter((e) => e.kind === 'purchase_offered')
    .filter((e) => at.getTime() - Date.parse(e.occurredAt) <= OFFER_TTL_MS)
    .map((e) => ({
      offer: e.data['offer'] as unknown as PurchaseOffer,
      offeredBy: e.reportedBy,
      at: e.occurredAt,
    }))
    .filter(({ offer }) => offer && !answered.has(offer.offerId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ offer, offeredBy }) => ({ offer, offeredBy }));
}
