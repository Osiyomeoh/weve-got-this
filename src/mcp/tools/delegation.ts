/**
 * Asking people to take work on, their answers, and telling them things.
 */

import { z } from 'zod';
import { runAgentOnce } from '../../domain/agent-runner.js';
import { deliberate } from '../../domain/agent.js';
import { require as requireCap } from '../../domain/auth.js';
import { candidatesFor } from '../../domain/delegation.js';
import { asTask, dueSpoken } from '../../domain/local-time.js';
import type { Member, Obligation } from '../../domain/types.js';
import { OUT } from '../output-schemas.js';
import { currentAgent } from '../agent.js';
import { joinSpoken, sentence } from '../text.js';
import { BRAND } from '../../domain/brand.js';
import { describeError, guidance, reply, type ToolContext, obligationFrom } from '../toolkit.js';

/**
 * "Ask Funmi if she can take him."
 *
 * The delegation loop. This is the difference between a system that *reports*
 * a Care Gap and one that *pursues* it. Asking deliberately does not move
 * ownership: the obligation goes to REQUESTED, ownerId stays null, and it keeps
 * showing up as a gap until a human actually says yes.
 */
export function registerRequestOwner({
  server,
  store,
  now,
  notifier,
  actor,
  state,
  nameOf,
}: ToolContext): void {
  server.registerTool(
    'request_owner',
    {
      title: 'Ask someone to take a piece of work on',
      description:
        'Ask a member of the care circle whether they will take something on - "ask David if ' +
        'he can drive her", "see if Renee can pick up the prescription", "can someone take ' +
        'Thursday?", "who can do this?". This ASKS; it does not assign. They still have to ' +
        'say yes, and the work stays unowned until they do. If no name is given, leave ' +
        'assigneeName empty and this picks who to ask and explains why. Use assign_obligation ' +
        'when the primary caregiver hands it to someone outright (it asks too), and ' +
        'claim_obligation when the speaker is taking it themselves.',
      inputSchema: {
        obligationId: z.string().describe('Which piece of work. From get_care_gaps.'),
        assigneeName: z
          .string()
          .optional()
          .describe('Who to ask, as the speaker named them. Omit to have someone suggested.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      outputSchema: OUT.request_owner,
    },
    async ({ obligationId: ref, assigneeName }) => {
      try {
        const me = actor();
        requireCap(me, 'request_owner');
        const s = state();
        const o = obligationFrom(store, ref, me.householdId);
        if (o.status === 'PROPOSED') {
          return guidance(
            `"${o.what}" hasn't been confirmed as actually needed yet. Confirm it first with ` +
              'confirm_proposal, then ask someone to take it.',
          );
        }
        if (o.status === 'ASSIGNED' && o.ownerId) {
          return guidance(
            `${nameOf(o.ownerId)} already has "${o.what}". Ask whether they want to hand it over.`,
          );
        }

        const ranked = candidatesFor(o, s, { askerId: me.id });
        let target = ranked[0];
        if (assigneeName) {
          const named = store.findMemberByName(me.householdId, assigneeName);
          if (!named) {
            const others = s.members.filter((m) => m.id !== me.id).map((m) => m.spokenAs ?? m.name);
            return guidance(
              `There's nobody called "${assigneeName}" in this care circle. ` +
                `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
            );
          }
          if ((o.declinedBy ?? []).includes(named.id)) {
            const next = ranked[0];
            return guidance(
              `${named.spokenAs ?? named.name} has already said no to "${o.what}". ` +
                (next
                  ? `${next.name} ${next.because} - shall I ask them instead?`
                  : 'There is nobody else left to ask. It may need the primary caregiver.'),
            );
          }
          target = {
            memberId: named.id,
            name: named.spokenAs ?? named.name,
            because: '',
            load: 0,
          };
        }

        if (!target) {
          return guidance(
            `There's nobody left to ask about "${o.what}" - everyone has either declined or ` +
              'said they are not available then. This may need the primary caregiver to step in.',
          );
        }

        const { updated, due } = await askMember({ store, now, notifier, state }, me, o, target);

        // Say what is true: they were asked, and nobody owns it yet.
        const suggested =
          !assigneeName && target.because
            ? ` I picked ${target.name} because they're the one who ${target.because}.`
            : '';
        return reply(
          `I've asked ${target.name} whether they can ${asTask(o.what)}${due ? ` ${due}` : ''}.${suggested} ` +
            'It stays unowned until they say yes.',
          { obligationId: updated.id, askedOfId: target.memberId, status: 'REQUESTED' },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * Ask one member to take a piece of work on: the obligation goes to REQUESTED with
 * nobody as owner, and the ask is delivered and recorded. request_owner and
 * assign_obligation both come through here, so the only way work reaches a person
 * ends in that person's own answer.
 */
export async function askMember(
  { store, now, notifier, state }: Pick<ToolContext, 'store' | 'now' | 'notifier' | 'state'>,
  me: Member,
  o: Obligation,
  target: { memberId: string; name: string },
): Promise<{ updated: Obligation; due: string | null }> {
  const due = dueSpoken(o.dueAt, state().household.timezone, now());
  // Which agent carried the ask, so the person asked can hear "Tolu asked, through Claude".
  const via = currentAgent();
  const updated = await store.transition(
    o.id,
    me.householdId,
    'REQUESTED',
    me.id,
    {
      ownerId: null,
      request: {
        askedOfId: target.memberId,
        askedById: me.id,
        askedAt: now().toISOString(),
        ...(via ? { via } : {}),
      },
    },
    `Asked ${target.name}`,
  );
  const message =
    `${me.spokenAs ?? me.name} asked${via ? `, through ${via},` : ''} if you can take this on:\n\n${o.what}` +
    `${due ? `, ${due}` : ''}\n\nReply "yes" or "can't".`;
  const delivery = await notifier.deliver({
    to: target.memberId,
    toName: target.name,
    from: me.spokenAs ?? me.name,
    message,
  });
  await store.appendEvent({
    householdId: me.householdId,
    kind: 'owner_requested',
    reportedBy: me.id,
    occurredAt: now().toISOString(),
    source: 'voice',
    confidence: 'confirmed',
    detail: o.what,
    data: {
      obligationId: o.id,
      askedOfId: target.memberId,
      delivered: delivery.delivered,
      message,
    },
  });
  return { updated, due };
}

/**
 * "Yes, I'll do it." / "No, I can't."
 */
export function registerRespondToRequest({
  server,
  store,
  now,
  actor,
  state,
  nameOf,
}: ToolContext): void {
  server.registerTool(
    'respond_to_request',
    {
      title: 'Answer a request to take something on',
      description:
        'The speaker answers something they were asked to take on - "yes, I\'ll do it", ' +
        '"I can take that", "no, I can\'t", "sorry, not this week". Accepting makes them the ' +
        'owner. Declining puts it back with no owner, records that they said no, and suggests ' +
        'who to ask next - a decline is an answer, not a failure. Also the answer to a ' +
        `${BRAND} check-in on work the speaker already has ("still on?"): "can't make it ` +
        'after all" hands it back the same way; "on my way" keeps it theirs.',
      inputSchema: {
        obligationId: z.string().describe('Which request they are answering.'),
        accepted: z.boolean().describe('True if they said yes, false if they said no.'),
        note: z.string().optional().describe('Anything they said about why, in their words.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      outputSchema: OUT.respond_to_request,
    },
    async ({ obligationId: ref, accepted, note }) => {
      try {
        const me = actor();
        const o = obligationFrom(store, ref, me.householdId);
        const obligationId = o.id;
        // The owner answering a check-in: a no hands the work back like any decline, a
        // yes leaves it where it is. Nobody else can hand back someone else's work.
        const owned = o.status === 'ASSIGNED' && o.ownerId === me.id;
        if (owned && accepted) {
          return reply(`Thanks - ${asTask(o.what)} stays with you.`, {
            obligationId,
            ownerId: me.id,
            status: 'ASSIGNED',
          });
        }
        if (!owned && (o.status !== 'REQUESTED' || !o.request)) {
          return guidance(
            `Nobody has an outstanding request for "${o.what}". ` +
              'If the speaker wants it, they can take it on with claim_obligation.',
          );
        }
        // Only the person asked can answer. Anyone else "accepting" on their behalf
        // would be the system inventing an agreement that was never given.
        if (!owned && o.request!.askedOfId !== me.id) {
          return guidance(
            `That was asked of ${nameOf(o.request!.askedOfId)}, so it's theirs to answer. ` +
              'The speaker can take it on themselves instead if they want it.',
          );
        }

        if (accepted) {
          await store.transition(
            obligationId,
            me.householdId,
            'ASSIGNED',
            me.id,
            { ownerId: me.id, clearRequest: true },
            note,
          );
          await store.appendEvent({
            householdId: me.householdId,
            kind: 'request_answered',
            reportedBy: me.id,
            occurredAt: now().toISOString(),
            source: 'voice',
            confidence: 'confirmed',
            ...(note ? { detail: note } : {}),
            data: { obligationId, accepted: true },
          });
          return reply(`Thanks, that's yours now: ${asTask(o.what)}.`, {
            obligationId,
            ownerId: me.id,
            status: 'ASSIGNED',
          });
        }

        const declinedBy = [...(o.declinedBy ?? []), me.id];
        // Read before the transition clears the request on the record.
        const askedBy = o.request?.askedById ?? me.id;
        await store.transition(
          obligationId,
          me.householdId,
          'OPEN',
          me.id,
          { ownerId: null, clearRequest: true, declinedBy },
          note,
        );
        await store.appendEvent({
          householdId: me.householdId,
          kind: 'request_answered',
          reportedBy: me.id,
          occurredAt: now().toISOString(),
          source: 'voice',
          confidence: 'confirmed',
          ...(note ? { detail: note } : {}),
          data: { obligationId, accepted: false },
        });
        // A decline should move the loop forward, not dead-end it.
        const next = candidatesFor(
          // Whoever made the ask is the one who will ask again; they are not the next ask.
          { ...o, declinedBy, ownerId: null },
          state(),
          { askerId: askedBy },
        )[0];
        return reply(
          `That's noted - this is back with no owner: ${asTask(o.what)}. ` +
            (next
              ? `${next.name} ${next.because}. Shall I ask them?`
              : 'There is nobody else left to ask, so the primary caregiver may need to step in.'),
          { obligationId, status: 'OPEN', declined: true, nextCandidate: next?.name ?? null },
        );
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "What have I been asked to do?"
 */
export function registerGetMyRequests({ server, actor, state, nameOf, now }: ToolContext): void {
  server.registerTool(
    'get_my_requests',
    {
      title: 'What the speaker has been asked to take on',
      description:
        'Everything the speaker has been asked to take on and has not answered yet - "what do ' +
        'I have for Mom?", "did anyone ask me to do anything?", "what am I down for?", "what ' +
        'was I asked?". Read-only. Use this before respond_to_request when you do not know ' +
        'which request they mean.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      outputSchema: OUT.get_my_requests,
    },
    async () => {
      try {
        const me = actor();
        requireCap(me, 'read_shift');
        const mine = state().obligations.filter(
          (o) => o.status === 'REQUESTED' && o.request?.askedOfId === me.id,
        );
        if (mine.length === 0) {
          return reply('Nobody is waiting on an answer from you right now.', { requests: [] });
        }
        const tz = state().household.timezone;
        const lines = mine.map((o, i) => {
          const named = nameOf(o.request!.askedById) ?? 'someone';
          // The agent is "the app", and the first line starts the sentence.
          const who = i === 0 ? sentence(named) : named;
          const through = o.request!.via ? `, through ${o.request!.via},` : '';
          const due = dueSpoken(o.dueAt, tz, now());
          return `${who} asked${through} if you can ${asTask(o.what)}${due ? ` ${due}` : ''}`;
        });
        return reply(`${joinSpoken(lines)}. You haven't answered yet.`, {
          requests: mine.map((o) => ({
            obligationId: o.id,
            what: o.what,
            askedBy: nameOf(o.request!.askedById) ?? null,
            askedAt: o.request!.askedAt,
            via: o.request!.via ?? null,
            dueAt: o.dueAt ?? null,
            due: dueSpoken(o.dueAt, tz, now()),
          })),
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * The agent, on demand.
 *
 * The agent normally runs on a timer with nobody watching. This lets a person
 * ask it to look right now - "is anything falling through the cracks?" - and,
 * because it runs the identical policy, also lets the autonomy be shown on camera
 * without waiting an hour for the clock. It asks; it never assigns; and it reports
 * its own restraint, so a pass that decides to do nothing still explains why.
 */
export function registerRunCareAgent({
  server,
  store,
  now,
  notifier,
  actor,
  state,
}: ToolContext): void {
  server.registerTool(
    'run_care_agent',
    {
      title: 'Let the agent look for slipping work itself',
      description:
        'Have the agent proactively review everything unowned and, where it is worth ' +
        'interrupting somebody, ASK the fairest person to take it on - the same thing it ' +
        'does on its own in the background. Use this for "check on things", "is anything ' +
        'being missed", "chase up the open items", or to see what the agent would do. It ' +
        'only ever asks; it never assigns work to anyone. It reports both what it did and ' +
        'what it deliberately left alone, and why.',
      inputSchema: {
        dryRun: z
          .boolean()
          .optional()
          .describe('When true, report what it would do without asking anyone. Defaults to false.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.run_care_agent,
    },
    async ({ dryRun }) => {
      try {
        const me = actor();
        requireCap(me, 'read_full_state');
        const s = state();

        if (dryRun) {
          const d = deliberate(s, { now: now(), timezone: s.household.timezone });
          const lines = d.actions.map((a) => a.because);
          const spoken = d.actions.length
            ? `I would reach out about ${d.actions.length === 1 ? 'one thing' : `${d.actions.length} things`}. ${lines.join(' ')}`
            : "I looked, and there's nothing I'd interrupt anyone about right now.";
          return reply(spoken, { would: d.actions, heldBack: d.restraint, dryRun: true });
        }

        const run = await runAgentOnce(me.householdId, { store, notifier, now });
        const asks = run.performed.map((p) => p.action.because);
        const held = run.deliberation.restraint;
        const spoken = run.performed.length
          ? `Done. ${run.performed.length === 1 ? 'I reached out about one thing.' : `I reached out about ${run.performed.length} things.`} ${asks.join(' ')}`
          : held.length
            ? `I looked at everything and decided to leave it for now. ${held[0]!.because}`
            : 'I looked, and everything that needs doing already has someone.';
        return reply(spoken, {
          asked: run.performed.map((p) => ({
            because: p.action.because,
            value: p.action.value,
            delivered: p.delivered,
          })),
          heldBack: held,
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}

/**
 * "Tell Funmi I'm taking Daddy."
 */
export function registerNotifyMember({
  server,
  store,
  now,
  notifier,
  actor,
  state,
}: ToolContext): void {
  server.registerTool(
    'notify_member',
    {
      title: 'Let someone in the care circle know something',
      description:
        'Send a short message to another member of the care circle - "tell Renee I\'m ' +
        'taking Mom Thursday", "let David know the pharmacy called", "message Renee about ' +
        'the appointment change", "text Renee". Any of tell / message / text / let-know a ' +
        'named person maps here. Use this when the speaker wants a specific PERSON told ' +
        'something. To record something for the whole family to see later, use add_note. ' +
        'Only for people in this care circle, and never for email: anyone else, or an email, ' +
        "is the assistant's own job.",
      inputSchema: {
        recipientName: z.string().describe('Who to tell, as the speaker named them.'),
        message: z.string().describe("What to tell them, in the speaker's own words."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      outputSchema: OUT.notify_member,
    },
    async ({ recipientName, message }) => {
      try {
        const me = actor();
        const recipient = store.findMemberByName(me.householdId, recipientName);
        if (!recipient) {
          const others = state()
            .members.filter((m) => m.id !== me.id)
            .map((m) => m.spokenAs ?? m.name);
          return guidance(
            `There's nobody called "${recipientName}" in this care circle. ` +
              `The people here are ${joinSpoken(others)}. Ask which one they meant.`,
          );
        }
        const who = recipient.spokenAs ?? recipient.name;
        const delivery = await notifier.deliver({
          to: recipient.id,
          toName: who,
          from: me.spokenAs ?? me.name,
          message,
        });
        const event = await store.appendEvent({
          householdId: me.householdId,
          kind: 'member_notified',
          reportedBy: me.id,
          occurredAt: now().toISOString(),
          source: 'voice',
          confidence: 'confirmed',
          detail: message,
          data: {
            recipientId: recipient.id,
            delivered: delivery.delivered,
            channel: delivery.channel,
          },
        });
        // Stay honest about what happened. If a real channel pushed it, say so; if we
        // only recorded it, do not imply a phone buzzed.
        const spoken = delivery.delivered
          ? `I've sent that to ${who}.`
          : `I've noted that for ${who} - they'll see it on the care record.`;
        return reply(spoken, {
          eventId: event.id,
          recipientId: recipient.id,
          delivered: delivery.delivered,
          channel: delivery.channel,
        });
      } catch (err) {
        return guidance(describeError(err));
      }
    },
  );
}
