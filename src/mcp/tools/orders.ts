/**
 * Work bought in rather than done by hand: lunch ordered from Houston, diesel from the
 * supplier, a refill from the pharmacy that delivers.
 */

import { z } from 'zod';
import { require as requireCap } from '../../domain/auth.js';
import { spokenDue } from '../../domain/gaps.js';
import { matchObligation } from '../../domain/obligation-ref.js';
import { arrivalFrom, orderOn, recordOrder, usualSource } from '../../domain/orders.js';
import { routinesOf } from '../../domain/routines.js';
import type { Obligation } from '../../domain/types.js';
import { called, subjectOf } from '../../domain/who.js';
import { currentChannel } from '../channel.js';
import { OUT } from '../output-schemas.js';
import { describeError, guidance, obligationFrom, reply, type ToolContext } from '../toolkit.js';

/**
 * "I've ordered Daddy's lunch from Mama Titi's, it'll be there at one."
 */
export function registerRecordOrder({ server, store, actor, state, now }: ToolContext): void {
  server.registerTool(
    'record_order',
    {
      title: 'Record that someone ordered the work in',
      description:
        'Record that the speaker ordered something in for the person cared for, wherever they ' +
        'ordered it: a delivery app, a pharmacy that delivers, a local kitchen, a link the ' +
        "family uses, or the assistant's own shopping. Nothing is bought here: this records who " +
        'ordered what, from where, and when it is due at the door, and puts the work on their ' +
        'name until a person says it reached them. If the speaker lives far away, someone ' +
        'nearby is asked to take it in. Not for a refill offered by reorder_prescription: ' +
        'confirm that with confirm_purchase. Only for what was ordered for the person cared ' +
        "for: the speaker's own shopping is not care, so answer it without a tool.",
      inputSchema: {
        obligationId: z
          .string()
          .optional()
          .describe(
            'The work it covers: its obligationId from get_care_gaps, or its words ("Bring Daddy lunch"). Leave it out when nothing on the board is for it.',
          ),
        what: z
          .string()
          .optional()
          .describe(
            'What was ordered, as said, when nothing on the board is for it: "Groceries for Mum".',
          ),
        from: z
          .string()
          .optional()
          .describe('Where it was ordered from, as said: a shop, a kitchen, a service, a link.'),
        arrives: z
          .string()
          .optional()
          .describe(
            'When it is due at the door: 24-hour "HH:MM" in the household timezone, or a local date and time.',
          ),
        forMemberId: z
          .string()
          .optional()
          .describe(
            'Who it is for: their name as the family says it, or their id. Leave it out when only one person is being cared for.',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.record_order,
    },
    async ({ obligationId: ref, what, from, arrives, forMemberId }) => {
      try {
        const me = actor();
        requireCap(me, 'claim_obligation');
        const s = state();
        const at = now();
        const tz = s.household.timezone;

        let covered: Obligation | undefined;
        if (ref?.trim()) {
          covered = obligationFrom(store, ref, me.householdId);
        } else if (what?.trim()) {
          // Said as the work itself ("I ordered Daddy's lunch"): the work on the board it fits.
          const match = matchObligation(what, s.obligations);
          if (match.kind === 'ambiguous') {
            return guidance(
              `That could be ${match.options.map((o) => `"${o.what}" (obligationId ${o.id})`).join('; ')}. ` +
                'Ask which one was ordered, then use its obligationId.',
            );
          }
          if (match.kind === 'found') covered = match.obligation;
        } else {
          return guidance('Ask what was ordered, or which job on the board it is for.');
        }

        if (covered) {
          if (covered.status === 'RESOLVED')
            return guidance(`"${covered.what}" is already marked done. Tell the person that.`);
          if (covered.status === 'DISMISSED')
            return guidance(`"${covered.what}" was taken off the board. Tell the person that.`);
          if (covered.status === 'PROPOSED')
            return guidance(
              `"${covered.what}" is only a suggestion so far. Ask whether it is needed, confirm it with confirm_proposal, then record the order.`,
            );
          const already = orderOn(covered.id, s);
          if (already) {
            const by = s.members.find((m) => m.id === already.orderedBy);
            const who = by?.id === me.id ? 'you' : by ? called(by) : 'someone';
            return guidance(
              `"${covered.what}" already has an order on record: ${who} ordered it` +
                `${already.from ? ` from ${already.from}` : ''}` +
                `${already.arrivesAt ? `, due${spokenDue(already.arrivesAt, tz, at)}` : ''}. Tell the person that.`,
            );
          }
        }

        const routineFor = covered?.routineId
          ? routinesOf(s).find((r) => r.id === covered.routineId)?.forMemberId
          : undefined;
        const subject = subjectOf(s, forMemberId ?? routineFor ?? undefined, 'this order');
        if ('problem' in subject) return guidance(subject.problem);

        let arrivesAt: string | undefined;
        if (arrives?.trim()) {
          const when = arrivalFrom(arrives, covered, tz, at);
          if ('problem' in when) return guidance(when.problem);
          arrivesAt = when.at;
        }
        const source = from?.trim() || (covered && usualSource(covered, s)) || undefined;

        const done = await recordOrder(
          store,
          {
            householdId: me.householdId,
            by: me,
            ...(covered ? { covered } : { what: what! }),
            forMember: subject.member,
            ...(source ? { from: source } : {}),
            ...(arrivesAt ? { arrivesAt } : {}),
            source: currentChannel() ?? 'voice',
          },
          at,
        );

        const name = called(subject.member);
        const due = arrivesAt ? `, due${spokenDue(arrivesAt, tz, at)}` : '';
        const parts = [
          `Noted - you ordered "${done.obligation.what}"${source ? ` from ${source}` : ''}${due}.`,
          done.heldBy
            ? `${called(done.heldBy)} has it, so it stays with them until it reaches ${name}.`
            : `It's on your name until someone says it reached ${name}.`,
        ];
        if (done.takeIn) parts.push("Since you're away, I'll ask someone nearby to take it in.");
        return reply(parts.join(' '), {
          obligationId: done.obligation.id,
          orderId: done.order.id,
          takeInId: done.takeIn?.id ?? null,
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}
