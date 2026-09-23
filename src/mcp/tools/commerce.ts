/**
 * Closing a gap by buying the fix: a priced offer, and the confirmation that makes it real.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canActOn, require as requireCap } from '../../domain/auth.js';
import {
  chooseRefill,
  formatPrice,
  offerFor,
  offerSpoken,
  type PurchaseOffer,
  waitingOffers,
} from '../../domain/commerce.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken } from '../text.js';
import { describeError, guidance, reply, type ToolContext } from '../toolkit.js';

/**
 * "Refill his prescription." - the purchase, as an offer.
 */
export function registerReorderPrescription({ server, store, now, actor, state }: ToolContext): void {
  server.registerTool('reorder_prescription', {
    title: 'Offer to reorder a prescription',
    description:
      'Some work is closed by buying the thing, not by doing it. When a prescription '
      + 'needs refilling - often the same one a delivery or a pickup gap is about - this '
      + 'prepares a priced OFFER from a pharmacy and presents it. It does NOT buy '
      + 'anything: like every inference here, a purchase is a proposal until a person '
      + 'confirms it with confirm_purchase. Tell them the item, the price and the ETA, '
      + 'and that nothing is charged yet. Call it straight away for "refill his '
      + 'prescription", "order more of her supplement" or "reorder my meds" - do not ask '
      + 'which medication first. This knows what is on record and asks back itself if '
      + 'it cannot tell.',
    inputSchema: {
      medicationName: z.string().optional()
        .describe('What they said to refill, in their words (e.g. "eye drops", "his '
          + 'supplement"). Leave it out if they did not name one.'),
      obligationId: z.string().optional()
        .describe('The pickup/refill Care Gap this would close, if known.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: OUT.reorder_prescription,
  }, async ({ medicationName, obligationId }) => {
    try {
      const me = actor();
      requireCap(me, 'make_purchase');
      const s = state();
      const open = s.obligations.filter((o) => o.status !== 'RESOLVED' && o.status !== 'DISMISSED');
      const choice = chooseRefill(medicationName, s.medications, open);
      if (!choice.ok) {
        return guidance(
          `More than one medication could be meant: ${joinSpoken(choice.choices)}. `
          + 'Ask which one to reorder, then call this again with medicationName.',
        );
      }
      const closes = obligationId ?? choice.obligationId;
      const offer = offerFor('prescription_refill', {
        offerId: `off_${randomUUID()}`,
        ...(choice.itemName ? { itemName: choice.itemName } : {}),
        ...(closes ? { obligationId: closes } : {}),
      });
      const event = await store.appendEvent({
        householdId: me.householdId, kind: 'purchase_offered', reportedBy: me.id,
        occurredAt: now().toISOString(), source: 'voice', confidence: 'confirmed',
        detail: offer.item,
        data: { offer: offer as unknown as Record<string, unknown> },
      });
      return reply(offerSpoken(offer), { eventId: event.id, offer });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "Yes, place the order." - the in-place confirmation.
 */
export function registerConfirmPurchase({ server, store, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool('confirm_purchase', {
    title: 'Place or decline a prepared purchase',
    description:
      'Confirm a purchase that was offered, or decline it. This is the only step that '
      + 'commits money. On confirmation the order is placed and, if the purchase closes '
      + 'a Care Gap (a prescription pickup), that work is marked done. Only call this '
      + 'when a person has said yes to a specific offer - never on your own judgement. '
      + '"Yes, place the order" or "go ahead and buy it" is this tool even when you do '
      + 'not have the offer id: leave offerId out and it finds the order that is waiting.',
    inputSchema: {
      offerId: z.string().optional().describe(
        'The offer being answered, from reorder_prescription. Leave it out when you do '
          + 'not have it; the waiting order is found for you.',
      ),
      confirmed: z.boolean().describe('True to place the order, false to decline it.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.confirm_purchase,
  }, async ({ offerId, confirmed }) => {
    try {
      const me = actor();
      requireCap(me, 'make_purchase');
      const s = state();
      if (!offerId) {
        const waiting = waitingOffers(s.events, now());
        if (waiting.length === 0) {
          return guidance(
            "There's no order waiting for a yes. Ask what they'd like reordered, and price "
            + 'it with reorder_prescription first.',
          );
        }
        if (waiting.length > 1) {
          return guidance(
            `${waiting.length} orders are waiting: `
            + `${joinSpoken(waiting.map((w) => `${w.offer.item} (offerId ${w.offer.offerId})`))}. `
            + 'Ask which one they mean, then call this again with its offerId.',
          );
        }
        const [{ offer: only, offeredBy }] = waiting as [typeof waiting[number]];
        // Money is committed only against a price the person has heard. If somebody
        // else was quoted it, read it back first rather than placing it on their yes.
        if (offeredBy !== me.id) {
          return guidance(
            `${nameOf(offeredBy) ?? 'Someone'} was quoted ${only.item} for `
            + `${formatPrice(only.amountCents, only.currency)}. Read that back and ask whether `
            + `to place it; only if they say yes, call this again with offerId "${only.offerId}".`,
          );
        }
        offerId = only.offerId;
      }
      const offered = s.events.find(
        (e) => e.kind === 'purchase_offered'
          && (e.data['offer'] as PurchaseOffer | undefined)?.offerId === offerId,
      );
      if (!offered) return guidance(`I can't find that offer any more. Ask me to price it again.`);
      const offer = offered.data['offer'] as unknown as PurchaseOffer;

      const already = s.events.find(
        (e) => e.kind === 'purchase_completed' && e.data['offerId'] === offerId,
      );
      if (already) {
        return guidance(`That order was already ${(already.data['placed']) ? 'placed' : 'declined'}.`);
      }

      await store.appendEvent({
        householdId: me.householdId, kind: 'purchase_completed', reportedBy: me.id,
        occurredAt: now().toISOString(), source: 'voice', confidence: 'confirmed',
        detail: confirmed ? `Placed: ${offer.item}` : `Declined: ${offer.item}`,
        data: { offerId, placed: confirmed, amountCents: offer.amountCents, simulated: true },
      });

      if (!confirmed) {
        return reply(`Okay, I won't place it.`, { offerId, placed: false });
      }

      // A confirmed purchase closes the Care Gap it was for, when it names one and
      // the caller may act on it.
      let closed: string | null = null;
      if (offer.obligationId) {
        try {
          const o = store.getObligation(offer.obligationId, me.householdId);
          if (o.status !== 'RESOLVED' && o.status !== 'DISMISSED' && canActOn(me, o)) {
            await store.transition(offer.obligationId, me.householdId, 'RESOLVED', me.id, {
              resolvedAt: now().toISOString(), resolutionNote: `Ordered via ${offer.merchant}.`,
            });
            closed = o.what;
          }
        } catch { /* the gap may have been resolved another way; the order still stands */ }
      }

      const price = formatPrice(offer.amountCents, offer.currency);
      const spoken = closed
        ? `Done - ${offer.item} is ordered for ${price}, and that takes "${closed}" off the list.`
        : `Done - ${offer.item} is ordered for ${price}. You'll get a confirmation from ${offer.merchant}.`;
      return reply(spoken, { offerId, placed: true, amountCents: offer.amountCents, closedObligation: closed });
    } catch (err) { return guidance(describeError(err)); }
  });
}
