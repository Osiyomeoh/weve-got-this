/**
 * Who has the work: the gaps, and claiming, assigning, confirming and closing it.
 */

import { z } from 'zod';
import { attributionOf } from '../../domain/attribution.js';
import { canActOn, require as requireCap } from '../../domain/auth.js';
import { evidenceFor, evidenceLine } from '../../domain/evidence.js';
import { detectCareGaps } from '../../domain/gaps.js';
import { asReadBy } from '../../domain/language.js';
import { clockTime, isLocalToday } from '../../domain/local-time.js';
import { appToolMeta } from '../app/protocol.js';
import { OUT } from '../output-schemas.js';
import { joinSpoken, speakGaps } from '../text.js';
import {
  CARE_BOARD_URI,
  describeError,
  guidance,
  obligationFrom,
  reply,
  type ToolContext,
} from '../toolkit.js';

/**
 * "What's going to fall through the cracks this week?"
 */
export function registerGetCareGaps({ server, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool('get_care_gaps', {
    title: 'Find what nobody has taken responsibility for',
    description:
      'THE core tool. Returns everything that needs attention and has no owner - unclaimed '
      + 'work, expected records that are missing, and things past their due time. Use this '
      + 'for "what needs doing", "what\'s unassigned", "what might fall through the cracks", '
      + 'or "is anything being missed". Also use it to resolve an implicit reference: when '
      + 'someone says "yes", "that one", "I\'ve got it" or "that\'s done" and you need to know '
      + 'which item they mean, call this to find it, then act. Results are already ranked by '
      + 'urgency and already phrased for speech: read them as written. Never restate a missing '
      + 'record as someone having failed to do something. The result also carries '
      + '`recordedToday` - what HAS been logged today, and who logged it. Check it before '
      + 'saying anything about what has or has not been taken: a gap for one dose never '
      + 'means nothing was taken, and a dose somebody else logged is still a record.',
    inputSchema: {
      withinDays: z.number().int().positive().max(365).optional()
        .describe('Only include dated items within this many days. Omit for everything.'),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: OUT.get_care_gaps,
    // On a host that can draw, this same call also renders the Care Board (see
    // ./app/care-board.ts). The spoken answer is unchanged and still correct on
    // its own: the view is an enhancement, never a precondition.
    _meta: appToolMeta(CARE_BOARD_URI),
  }, async ({ withinDays }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      // Read-only, so each medicine can go by the name the reader's family gave it.
      const s = asReadBy(state(), me.language);
      const gaps = detectCareGaps(s, {
        now: now(),
        ...(withinDays !== undefined ? { withinDays } : {}),
      });
      // What IS on the record today, alongside what is missing from it.
      //
      // This tool could see absence and not presence, and a caller reading only
      // gaps will generalise "no record of the 08:00 dose" into "nothing has been
      // taken today" - which erases a record a real person made. We watched that
      // happen live, to a dose the aide had just logged. Absence is only half the
      // record and a tool that hands over half a record invites the other half to
      // be invented.
      const tz = s.household.timezone;
      const recordedToday = s.events
        .filter((e) => e.kind === 'medication_taken' && isLocalToday(e.occurredAt, now(), tz))
        .map((e) => ({
          // The medicine's name, not the words it was logged in: Mum's "colírio" is her
          // son's "eye drops".
          what: s.medications.find((m) => m.id === e.data['medicationId'])?.name ?? e.data['medicationName'] ?? 'medication',
          at: e.occurredAt,
          time: clockTime(e.occurredAt, tz),
          attribution: attributionOf(e),
          saidBy: nameOf(e.reportedBy) ?? null,
        }));

      // And it has to be in the sentence, not only in `recordedToday`: many hosts hand the
      // model the text of a result and nothing else. We watched a son ask whether his
      // mother had used her drops and hear only "no record from 8 AM", about a dose she
      // had logged that evening. When the answer speaks of a dose with no record, it also
      // says which doses are on the record today, and who logged them.
      let spoken = speakGaps(gaps);
      if (recordedToday.length > 0 && gaps.some((g) => g.kind === 'UNCONFIRMED')) {
        const shown = recordedToday.slice(0, 3).map((r) => `${r.what} at ${r.time}${r.saidBy ? `, from ${r.saidBy}` : ''}`);
        const more = recordedToday.length - shown.length;
        spoken += ` On the record today: ${joinSpoken(shown)}${more > 0 ? `, and ${more} more` : ''}.`;
      }

      return reply(spoken, {
        recordedToday,
        gaps: gaps.map((g) => ({
          id: g.id, kind: g.kind, severity: g.severity, spoken: g.spoken,
          because: g.because, obligationId: g.obligationId ?? null, score: g.score,
          // The score's derivation travels with it so the view can show *why* a
          // gap ranks where it does. A ranking over someone's medical care that
          // cannot be audited should not be trusted.
          factors: g.factors,
        })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "I'll take that one."
 */
export function registerClaimObligation({ server, store, actor, nameOf }: ToolContext): void {
  server.registerTool('claim_obligation', {
    title: 'Take responsibility for something',
    description:
      'The speaker takes on a piece of work themselves ("I\'ll do it", "I\'ve got Thursday", '
      + '"I can take that one", "leave it with me"). To give work to someone ELSE, use '
      + 'assign_obligation instead. If you are unsure which item they mean - "that one", "it" '
      + '- call get_care_gaps to find it, then claim it, rather than doing nothing.',
    inputSchema: { obligationId: z.string().describe('Which piece of work. From get_care_gaps.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.claim_obligation,
  }, async ({ obligationId: ref }) => {
    try {
      const me = actor();
      requireCap(me, 'claim_obligation');
      const o = obligationFrom(store, ref, me.householdId);
      const obligationId = o.id;
      if (o.status === 'PROPOSED') {
        return guidance(
          `"${o.what}" hasn't been confirmed as actually needed yet. Ask them to confirm it `
          + 'first with confirm_proposal, then claim it.',
        );
      }
      if (o.ownerId && o.ownerId !== me.id) {
        return guidance(
          `${nameOf(o.ownerId)} already has "${o.what}". Ask whether they want to take it over.`,
        );
      }
      const updated = await store.transition(obligationId, me.householdId, 'ASSIGNED', me.id, { ownerId: me.id });
      return reply(`Done - ${o.what} is yours.`, { obligationId: updated.id, ownerId: me.id });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "Give the pharmacy run to Funmi."
 */
export function registerAssignObligation({ server, store, actor, state }: ToolContext): void {
  server.registerTool('assign_obligation', {
    title: 'Give a piece of work to someone',
    description:
      'Assign work to another member of the care circle. Only the primary caregiver can do '
      + 'this. When the speaker is taking it on themselves, use claim_obligation instead.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work. From get_care_gaps.'),
      assigneeName: z.string().describe('Who to give it to, as the speaker named them.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.assign_obligation,
  }, async ({ obligationId: ref, assigneeName }) => {
    try {
      const me = actor();
      requireCap(me, 'assign_obligation');
      const o = obligationFrom(store, ref, me.householdId);
      const obligationId = o.id;
      const assignee = store.findMemberByName(me.householdId, assigneeName);
      if (!assignee) {
        const others = state().members.filter((m) => m.id !== me.id).map((m) => m.spokenAs ?? m.name);
        return guidance(
          `There's nobody called "${assigneeName}" in this care circle. `
          + `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
        );
      }
      const updated = await store.transition(
        obligationId, me.householdId, 'ASSIGNED', me.id, { ownerId: assignee.id },
      );
      const who = assignee.spokenAs ?? assignee.name;
      return reply(`Done - ${o.what} is assigned to ${who}.`, {
        obligationId: updated.id, ownerId: assignee.id,
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "Yes, he'll need a ride."
 */
export function registerConfirmProposal({ server, store, actor }: ToolContext): void {
  server.registerTool('confirm_proposal', {
    title: 'Confirm or dismiss something the system guessed',
    description:
      'The system infers work from appointments (a ride to cardiology, someone to take notes) '
      + 'but never treats a guess as real. This turns a guess into actual work, or dismisses '
      + 'it. A short affirmation of a suggested need - "yes", "that\'s right", "she will need '
      + 'that", "someone should drive her" - is a confirmation: call this. If you do not know '
      + 'which proposal they mean, call get_care_gaps first to find it, then confirm. Always '
      + 'ask a person before calling this - the confirmation must come from them, not from '
      + 'your own judgement about what seems sensible.',
    inputSchema: {
      obligationId: z.string().describe('The proposal being answered.'),
      confirmed: z.boolean().describe('True if the person said it is needed, false if not.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.confirm_proposal,
  }, async ({ obligationId: ref, confirmed }) => {
    try {
      const me = actor();
      requireCap(me, 'confirm_proposal');
      const o = obligationFrom(store, ref, me.householdId);
      const obligationId = o.id;
      if (o.status !== 'PROPOSED') {
        return guidance(`"${o.what}" has already been settled - it's ${o.status.toLowerCase()}.`);
      }
      await store.transition(obligationId, me.householdId, confirmed ? 'OPEN' : 'DISMISSED', me.id);
      return reply(
        confirmed
          ? `Right - ${o.what}. Nobody's taken it yet. Do you want it?`
          : `Okay, I'll leave that out.`,
        { obligationId, status: confirmed ? 'OPEN' : 'DISMISSED' },
      );
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "Picked up the eye drops."
 */
export function registerResolveObligation({ server, store, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool('resolve_obligation', {
    title: 'Mark something as done',
    description:
      'Mark a task or errand as done, so it stops showing as open. Use this when someone '
      + 'says a piece of work is handled - "that\'s sorted now", "taken care of", "I dropped '
      + 'it off", "done" - including errands and rides reported in the past tense, which are '
      + 'work being closed, not events to log. If '
      + 'they do not name which task, call get_care_gaps first to find which one they mean, '
      + 'then resolve it.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work.'),
      note: z.string().optional().describe('Anything they said about how it went.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.resolve_obligation,
  }, async ({ obligationId: ref, note }) => {
    try {
      const me = actor();
      requireCap(me, 'resolve_obligation');
      const o = obligationFrom(store, ref, me.householdId);
      const obligationId = o.id;
      // Closing it again would put a second "done" on the record under someone else's name.
      // Say who closed it and when instead; that is usually what the question was.
      if (o.status === 'RESOLVED') {
        const s = state();
        const closed = [...s.events].reverse()
          .find((e) => e.kind === 'obligation_resolved' && e.data['obligationId'] === obligationId);
        const by = closed ? nameOf(closed.reportedBy) : undefined;
        const at = closed ? clockTime(closed.occurredAt, s.household.timezone) : undefined;
        return reply(`That's already done - ${by ?? 'someone'} marked "${o.what}" done${at ? ` at ${at}` : ''}.`, { obligationId });
      }
      if (!canActOn(me, o)) {
        return guidance(`That one isn't assigned to you, so you can't close it out.`);
      }
      // What the devices saw around the due time travels with the verdict, so "how do
      // we know it was done?" has more to stand on than one person's word.
      const s = state();
      const seen = evidenceFor(o, s.events, now());
      await store.transition(obligationId, me.householdId, 'RESOLVED', me.id, {
        resolvedAt: now().toISOString(), ...(note ? { resolutionNote: note } : {}),
      });
      await store.appendEvent({
        householdId: me.householdId, kind: 'obligation_resolved', reportedBy: me.id,
        occurredAt: now().toISOString(), source: 'voice', confidence: 'confirmed',
        ...(note ? { detail: note } : {}),
        ...(seen.length ? { derivedFrom: seen.map((e) => e.id) } : {}),
        data: { obligationId },
      });
      const also = seen.length ? ` The doorbell also saw ${evidenceLine(seen[0]!, s.household.timezone)}.` : '';
      return reply(`Marked done - ${o.what}.${also}`, { obligationId });
    } catch (err) { return guidance(describeError(err)); }
  });
}
