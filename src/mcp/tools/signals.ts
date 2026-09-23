/**
 * Evidence from devices in the home, which enters as evidence and never as a conclusion.
 */

import { z } from 'zod';
import { require as requireCap } from '../../domain/auth.js';
import { type CareSignal, interpretSignal } from '../../domain/signals.js';
import { OUT } from '../output-schemas.js';
import { describeError, guidance, reply, type ToolContext } from '../toolkit.js';

/**
 * A physical-world signal from a device (e.g. Ring).
 */
export function registerIngestSignal({ server, store, now, actor, state }: ToolContext): void {
  server.registerTool('ingest_signal', {
    title: 'Record something a device observed',
    description:
      'Take an observation from a device in the home - a Ring doorbell, a camera, a '
      + 'sensor - and fold it into the care record. Use this for physical-world events '
      + 'nobody typed: a delivery arriving at the door, activity or the absence of it. '
      + 'A signal is EVIDENCE, not a conclusion: a delivery is grounds to ASK whether the '
      + 'prescription was picked up, not to mark it done; no activity is grounds to ASK '
      + 'whether someone should check in, never a claim that something is wrong.',
    inputSchema: {
      source: z.enum(['ring', 'other']).describe('Which device reported it.'),
      kind: z.enum(['delivery_arrived', 'door_activity', 'motion', 'no_activity'])
        .describe('What was observed.'),
      occurredAt: z.string().optional().describe('ISO time observed. Defaults to now.'),
      detail: z.string().optional().describe('Anything the device reported, kept verbatim.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: OUT.ingest_signal,
  }, async ({ source, kind, occurredAt, detail }) => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const s = state();
      const recipient = s.members.find((m) => m.role === 'care_recipient');
      if (!recipient) return guidance("I don't know who this home belongs to.");

      const signal: CareSignal = {
        source, kind, at: occurredAt ?? now().toISOString(),
        ...(detail ? { detail } : {}),
      };
      const outcome = interpretSignal(signal, {
        recipientId: recipient.id,
        recipientName: recipient.spokenAs ?? recipient.name,
        now: now(),
      });

      const event = await store.appendEvent({ ...outcome.event, householdId: me.householdId });

      // If the signal is evidence toward open work, name the match so the model can
      // ask about the specific item - it does not resolve anything itself.
      let candidate: string | null = null;
      if (outcome.resolvesObligationLike) {
        const pattern = outcome.resolvesObligationLike.match;
        const open = s.obligations.find(
          (o) => pattern.test(o.what) && o.status !== 'RESOLVED' && o.status !== 'DISMISSED',
        );
        candidate = open?.id ?? null;
      }

      // A proposed obligation (e.g. check-in) enters as a proposal, like any inference.
      let proposalId: string | null = null;
      if (outcome.proposeObligation) {
        const created = await store.createObligation({
          householdId: me.householdId,
          what: outcome.proposeObligation.what,
          status: 'PROPOSED',
          consequence: outcome.proposeObligation.consequence,
          provenance: { kind: 'INFERRED', rule: `signal:${source}:${kind}`, from: `${source} ${kind}` },
          ownerId: null,
          sourceEventId: event.id,
        });
        proposalId = created.id;
      }

      // The ask, when present, already carries the observation - speak it alone to
      // avoid repeating the same fact twice.
      const ask = outcome.resolvesObligationLike?.ask ?? outcome.proposeObligation?.ask;
      return reply(ask ?? outcome.spoken, {
        eventId: event.id,
        resolvesCandidate: candidate,
        proposalId,
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}
