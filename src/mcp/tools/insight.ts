/**
 * Reading the record back: how the day went, what a shift needs, and how we know.
 */

import { activeMedications, upcomingAppointments, type Appointment } from '../../domain/care-changes.js';
import { spokenClock, spokenDue } from '../../domain/gaps.js';
import type { CareState } from '../../domain/types.js';
import { z } from 'zod';
import { attributionOf, isReported, sayWhoSaysSo } from '../../domain/attribution.js';
import { require as requireCap } from '../../domain/auth.js';
import { describeConnections } from '../../domain/connections.js';
import { detectCareGaps, pendingProposals } from '../../domain/gaps.js';
import { clockTime, isLocalToday } from '../../domain/local-time.js';
import { explainProvenance } from '../../domain/provenance.js';
import { OUT } from '../output-schemas.js';
import { countPhrase, joinSpoken, sentence, speakGaps } from '../text.js';
import { describeError, guidance, reply, type ToolContext, obligationFrom } from '../toolkit.js';

/**
 * "How do we know that?"
 */
export function registerGetProvenance({ server, store, actor, state, nameOf }: ToolContext): void {
  server.registerTool('get_provenance', {
    title: 'Explain how the system knows something',
    description:
      'Explains the whole chain behind one piece of work - "how do you know that?", "why '
      + 'are you saying this?", "where did that come from?", "who said she needs a ride?". '
      + 'Walks what was actually recorded: how the obligation arose (a human confirmed it, '
      + 'the system guessed it, or there is simply no record), the signal or event it came '
      + 'from, and every ownership move since. Read-only. Use it whenever someone questions a '
      + 'gap or a claim. Speak the result verbatim - it is phrased to state a guess as a guess '
      + 'and an absent record as an absent record, and it never accuses anyone.',
    inputSchema: {
      obligationId: z.string().describe('Which piece of work to explain. From get_care_gaps.'),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.get_provenance,
  }, async ({ obligationId: ref }) => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const o = obligationFrom(store, ref, me.householdId);
      const obligationId = o.id;
      const explanation = explainProvenance(
        o, store.getTransitions(obligationId), state().events, nameOf,
      );
      return reply(explanation.spoken, {
        obligationId: explanation.obligationId,
        what: explanation.what,
        owner: explanation.owner,
        chain: explanation.chain,
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "What are you connected to?"
 */
export function registerGetConnections({ server, actor, state }: ToolContext): void {
  server.registerTool('get_connections', {
    title: 'List the data connections and whether each is live',
    description:
      'Reports what CareCircle is connected to - Google Calendar, Gmail, Ring, Bee, WhatsApp, '
      + 'Telegram - and for each whether it is LIVE (connected and receiving events), CONFIGURED '
      + '(connected but nothing has arrived yet), or NOT CONNECTED. Use for "what are you '
      + 'connected to?", "is Telegram working?", "which of my accounts are linked?". Read-only, '
      + 'and honest: it never reports a connection that is not actually configured, and a door '
      + 'that has never carried an event is not called live. Speak the result as written.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    outputSchema: OUT.get_connections,
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const report = describeConnections(process.env, state().events);
      return reply(report.spoken, { connections: report.connections });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "How's Daddy doing today?"
 */
export function registerGetCareSummary({ server, now, actor, state, nameOf }: ToolContext): void {
  server.registerTool('get_care_summary', {
    title: "How is the person being cared for doing",
    description:
      'A picture of the day: what has been logged, what notes the family added, what is '
      + 'coming up, and anything unowned. Use for "how is she doing", "what happened today", '
      + '"catch me up". For unowned work specifically, get_care_gaps is sharper.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: OUT.get_care_summary,
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_full_state');
      const s = state();
      const tz = s.household.timezone;
      const todays = s.events.filter((e) => isLocalToday(e.occurredAt, now(), tz));
      const meds = todays.filter((e) => e.kind === 'medication_taken');
      const notes = todays.filter((e) => e.kind === 'note_added');
      const gaps = detectCareGaps(s, { now: now() });
      const proposals = pendingProposals(s);

      const parts: string[] = [];
      // Who logged a dose is part of what the record says, not metadata about it.
      // A bare count silently upgrades "the aide says you took it" into "you took
      // it", which is the accusation rule failing in the opposite direction.
      const proxied = meds.filter(isReported);
      parts.push(meds.length > 0
        ? sentence(`${countPhrase(meds.length, 'medication')} logged today.`)
        : 'Nothing logged for medications today yet.');
      for (const e of proxied.slice(0, 2)) {
        parts.push(sentence(`${sayWhoSaysSo(attributionOf(e), (id) => nameOf(id) ?? null)}.`));
      }
      for (const n of notes.slice(0, 2)) {
        parts.push(`${nameOf(n.reportedBy) ?? 'Someone'} noted: ${n.detail}`);
      }
      const coming = upcomingAppointments(s, now(), 7);
      if (coming.length > 0) parts.push(`Coming up: ${joinSpoken(coming.slice(0, 4).map((a) => sayAppointment(a, s, now())))}.`);
      if (gaps.length > 0) parts.push(speakGaps(gaps));
      if (proposals.length > 0) {
        parts.push(`There ${proposals.length === 1 ? 'is' : 'are'} also ${countPhrase(proposals.length, 'thing')} I'm not sure about yet.`);
      }
      return reply(parts.join(' '), {
        appointments: coming.map((a) => ({ what: a.kind, at: a.at, for: nameOf(a.forMemberId) ?? null })),
        medicationsLogged: meds.length,
        medications: meds.map((e) => ({
          eventId: e.id,
          medicationId: e.data['medicationId'] ?? null,
          // The name, always. Given only an id, a model will read one: we heard
          // "his heart pill" for eye drops whose id is a leftover `med_heart`.
          name: s.medications.find((m) => m.id === e.data['medicationId'])?.name
            ?? e.data['medicationName'] ?? 'medication',
          at: e.occurredAt,
          time: clockTime(e.occurredAt, tz),
          attribution: attributionOf(e),
        })),
        notes: notes.map((n) => ({ by: nameOf(n.reportedBy), text: n.detail })),
        gaps: gaps.map((g) => ({ severity: g.severity, spoken: g.spoken })),
        pendingProposals: proposals.map((p) => ({ id: p.id, what: p.what })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/**
 * "What do I need to know today?" (the paid driver)
 */
export function registerGetShiftBrief({ server, actor, state, now }: ToolContext): void {
  server.registerTool('get_shift_brief', {
    title: 'What this shift needs to know',
    description:
      'A short handoff brief for whoever is on duty: what is due, what they own, and any '
      + 'recent notes that change how today should go. Use it when a helper or aide asks '
      + 'what they need to know, what is happening today, or what medications the person is '
      + 'on today - for the aide this is how they see the day. Scoped deliberately - it does '
      + 'not expose the whole family record.',
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true },
    outputSchema: OUT.get_shift_brief,
  }, async () => {
    try {
      const me = actor();
      requireCap(me, 'read_shift');
      const s = state();
      const mine = s.obligations.filter((o) => o.ownerId === me.id && o.status === 'ASSIGNED');
      const active = activeMedications(s, now());
      const meds = active.map((m) => `${m.name} at ${joinSpoken(m.times.map(spokenClock))}`);
      // "Did I take my drops?" The person themselves, and whoever is on duty, can see
      // what is recorded today - with who recorded it - so nobody gives a dose twice.
      const tz = s.household.timezone;
      const mineOnly = me.role === 'care_recipient';
      const dosesToday = s.events.filter((e) => e.kind === 'medication_taken' && isLocalToday(e.occurredAt, now(), tz)
        && (!mineOnly || e.data['aboutMemberId'] === me.id
          || active.some((m) => m.id === e.data['medicationId'] && m.forMemberId === me.id)));
      const doseLine = (e: (typeof dosesToday)[number]) => {
        const name = s.medications.find((m) => m.id === e.data['medicationId'])?.name ?? String(e.data['medicationName'] ?? 'medication');
        const by = e.reportedBy === me.id ? '' : ` (from ${s.members.find((m) => m.id === e.reportedBy)?.spokenAs ?? s.members.find((m) => m.id === e.reportedBy)?.name ?? 'someone'})`;
        return `${name} at ${clockTime(e.occurredAt, tz)}${by}`;
      };
      // Today and tomorrow: what a person on duty, or the person themselves, needs to plan for.
      const coming = upcomingAppointments(s, now(), 2)
        .filter((a) => me.role !== 'care_recipient' || a.forMemberId === me.id);
      const recentNote = [...s.events].reverse().find((e) => e.kind === 'note_added');

      const parts: string[] = [];
      parts.push(meds.length > 0 ? `Medications today: ${joinSpoken(meds)}.` : 'No medications scheduled.');
      parts.push(dosesToday.length > 0
        ? `Recorded so far today: ${joinSpoken(dosesToday.map(doseLine))}.`
        : 'No doses recorded yet today.');
      parts.push(mine.length > 0
        ? `You have ${countPhrase(mine.length, 'thing')}: ${joinSpoken(mine.map((o) => o.what))}.`
        : 'Nothing is assigned to you right now.');
      if (coming.length > 0) parts.push(`Coming up: ${joinSpoken(coming.map((a) => sayAppointment(a, s, now())))}.`);
      if (recentNote?.detail) parts.push(`Latest note: ${recentNote.detail}`);
      return reply(parts.join(' '), {
        appointments: coming.map((a) => ({ what: a.kind, at: a.at })),
        recordedToday: dosesToday.map((e) => ({ line: doseLine(e), at: e.occurredAt })),
        medications: active.map((m) => ({ name: m.name, times: m.times })),
        assignedToMe: mine.map((o) => ({ id: o.id, what: o.what, dueAt: o.dueAt ?? null })),
      });
    } catch (err) { return guidance(describeError(err)); }
  });
}

/** "Dad's eye check-up tomorrow at 10 AM". */
function sayAppointment(a: Appointment, s: CareState, now: Date): string {
  const who = s.members.find((m) => m.id === a.forMemberId);
  return `${who ? `${who.spokenAs ?? who.name}'s ` : ''}${a.kind}${spokenDue(a.at, s.household.timezone, now)}`;
}
