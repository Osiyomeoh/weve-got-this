import type { CareEvent, CareState } from './types.js';
import { DOSE_GRACE_MINUTES, doseRecord, localParts, parseHHMM } from './gaps.js';
import { AGENT_ID } from './agent.js';

/**
 * What a family's care record shows about a stretch of real use.
 *
 * Every figure is counted from the log, the same append-only record the tools read;
 * nothing is estimated or projected. That matters because this is the evidence for
 * whether CareCircle helped, and the only honest source for that is what happened.
 *
 * The one figure that needs a word is `loggedLate`: a dose whose record arrived after
 * the board had already started showing "no record". Each one is a time a system that
 * treats silence as a missed dose would have raised a false alarm about somebody's
 * father. Counting them is how the trust rule shows up in real use, not just in tests.
 */

export interface PilotReport {
  from: string;
  to: string;
  /** First and last calendar day of the window, household time (YYYY-MM-DD). */
  firstDay: string;
  lastDay: string;
  /** Calendar days in the window, household time. */
  days: number;
  /** Days on which somebody recorded something. */
  activeDays: number;
  /** Everyone who put something in the record, most first. Devices and CareCircle are left out. */
  people: { name: string; records: number; channels: string[] }[];
  doses: {
    /** Doses due in the window whose "no record" point had passed by the end of it. */
    expected: number;
    recorded: number;
    recordedBy: { name: string; count: number }[];
    /** Recorded, but only after the board showed "no record" for it. */
    loggedLate: number;
    /** Still no record at the end of the window. Never counted as missed. */
    noRecord: number;
  };
  work: {
    created: number;
    /** Proposed by CareCircle from a signal or a calendar, not said by a person. */
    proposed: number;
    proposedConfirmed: number;
    proposedDismissed: number;
    asked: number;
    askedByCareCircle: number;
    accepted: number;
    declined: number;
    unanswered: number;
    /** Median time from an ask to its answer, in minutes. */
    medianAnswerMinutes: number | null;
    done: number;
    /** Open now with nobody on it (the current state, so run the report with `to` = now). */
    stillUnowned: number;
  };
  signals: { total: number; bySource: { source: string; count: number }[] };
  eveningUpdates: { sent: number; recipients: string[] };
}

const DAY_MS = 86_400_000;

function counted(values: string[]): { name: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** One instant inside each household-local calendar day from `from` to `to`. */
function localDays(from: Date, to: Date, timezone: string): { date: string; at: Date }[] {
  const out: { date: string; at: Date }[] = [];
  const seen = new Set<string>();
  // Step in half days so a daylight-saving change can never skip a date.
  for (let t = from.getTime(); t <= to.getTime() + DAY_MS; t += DAY_MS / 2) {
    const at = new Date(Math.min(t, to.getTime()));
    const { date } = localParts(at, timezone);
    if (!seen.has(date)) { seen.add(date); out.push({ date, at }); }
    if (at.getTime() === to.getTime()) break;
  }
  return out;
}

export function pilotReport(state: CareState, window: { from: Date; to: Date }): PilotReport {
  const { timezone } = state.household;
  const { from, to } = window;
  const within = (iso: string | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t >= from.getTime() && t <= to.getTime();
  };
  const nameOf = (id: string): string => {
    if (id === AGENT_ID) return 'CareCircle';
    if (id.startsWith('device:')) return id.slice('device:'.length);
    const m = state.members.find((x) => x.id === id);
    return m ? (m.spokenAs ?? m.name) : 'someone no longer in the circle';
  };
  const events = state.events.filter((e) => within(e.occurredAt));
  const byPerson = events.filter((e) => e.reportedBy !== AGENT_ID && !e.reportedBy.startsWith('device:'));

  const days = localDays(from, to, timezone);
  const activeDays = new Set(byPerson.map((e) => localParts(new Date(e.occurredAt), timezone).date)).size;

  const people = [...new Set(byPerson.map((e) => e.reportedBy))].map((id) => {
    const mine = byPerson.filter((e) => e.reportedBy === id);
    return {
      name: nameOf(id),
      records: mine.length,
      channels: [...new Set(mine.map((e) => e.source ?? 'voice'))].sort(),
    };
  }).sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));

  // Doses: every expected time on every day, once its "no record" point has passed.
  const end = localParts(to, timezone);
  const recordedBy: string[] = [];
  let expected = 0; let loggedLate = 0; let noRecord = 0;
  for (const day of days) {
    for (const med of state.medications) {
      for (const time of med.times) {
        const due = parseHHMM(time);
        if (due === null) continue;
        if (day.date === end.date && end.minutes < due + DOSE_GRACE_MINUTES) continue;
        const record = doseRecord(state, med.id, time, day.at);
        if (record && !within(record.occurredAt)) continue;
        if (!record && day.date === localParts(from, timezone).date
          && localParts(from, timezone).minutes > due) continue;
        expected += 1;
        if (!record) { noRecord += 1; continue; }
        recordedBy.push(nameOf(record.reportedBy));
        const seen = localParts(new Date(record.recordedAt), timezone);
        if (seen.date > day.date || (seen.date === day.date && seen.minutes >= due + DOSE_GRACE_MINUTES)) {
          loggedLate += 1;
        }
      }
    }
  }

  // Asks and answers. An answer belongs to the latest ask of that person for that work.
  // Follow-ups on promised work are not asks for an owner; they are counted apart.
  const asks = events.filter((e) => e.kind === 'owner_requested' && e.data['followUp'] !== true);
  const answers = events.filter((e) => e.kind === 'request_answered');
  const answerOf = (ask: CareEvent): CareEvent | undefined => {
    const later = asks.find((a) => a !== ask && a.data['obligationId'] === ask.data['obligationId']
      && a.data['askedOfId'] === ask.data['askedOfId'] && a.occurredAt > ask.occurredAt);
    return answers.find((r) => r.data['obligationId'] === ask.data['obligationId']
      && r.reportedBy === ask.data['askedOfId'] && r.occurredAt >= ask.occurredAt
      && (!later || r.occurredAt < later.occurredAt));
  };
  const answered = asks.map((a) => ({ ask: a, answer: answerOf(a) }));
  const waits = answered.filter((x) => x.answer)
    .map((x) => Math.round((Date.parse(x.answer!.occurredAt) - Date.parse(x.ask.occurredAt)) / 60_000));

  const created = state.obligations.filter((o) => within(o.createdAt));
  const proposed = created.filter((o) => o.provenance.kind === 'INFERRED');

  const signals = events.filter((e) => e.kind === 'external_signal');
  const updates = events.filter((e) => e.kind === 'member_notified' && e.data['update'] === 'daily');

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    firstDay: days[0]?.date ?? end.date,
    lastDay: end.date,
    days: days.length,
    activeDays,
    people,
    doses: {
      expected,
      recorded: expected - noRecord,
      recordedBy: counted(recordedBy),
      loggedLate,
      noRecord,
    },
    work: {
      created: created.length,
      proposed: proposed.length,
      proposedConfirmed: proposed.filter((o) => o.status !== 'PROPOSED' && o.status !== 'DISMISSED').length,
      proposedDismissed: proposed.filter((o) => o.status === 'DISMISSED').length,
      asked: asks.length,
      askedByCareCircle: asks.filter((a) => a.reportedBy === AGENT_ID).length,
      accepted: answered.filter((x) => x.answer?.data['accepted'] === true).length,
      declined: answered.filter((x) => x.answer?.data['accepted'] === false).length,
      unanswered: answered.filter((x) => !x.answer).length,
      medianAnswerMinutes: median(waits),
      done: created.filter((o) => o.status === 'RESOLVED').length,
      stillUnowned: state.obligations.filter((o) => (o.status === 'OPEN' || o.status === 'REQUESTED')
        && o.ownerId === null && Date.parse(o.createdAt) <= to.getTime()).length,
    },
    signals: {
      total: signals.length,
      bySource: counted(signals.map((e) => String(e.data['source'] ?? e.source ?? 'device')))
        .map(({ name, count }) => ({ source: name, count })),
    },
    eveningUpdates: {
      sent: updates.length,
      recipients: [...new Set(updates.map((e) => nameOf(String(e.data['recipientId']))))].sort(),
    },
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function minutes(m: number): string {
  if (m < 60) return plural(m, 'minute');
  const h = Math.round(m / 6) / 10;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** The report as plain text, for a terminal, a write-up or the end of a video. */
export function renderPilotReport(r: PilotReport, title: string): string {
  const out: string[] = [
    title,
    `${r.firstDay} to ${r.lastDay} · ${plural(r.days, 'day')}, something recorded on ${r.activeDays}`,
    '',
  ];

  out.push('Who kept the record');
  if (r.people.length === 0) out.push('  Nobody yet.');
  for (const p of r.people) out.push(`  ${p.name.padEnd(12)} ${plural(p.records, 'record')} · ${p.channels.join(', ')}`);
  out.push('');

  const d = r.doses;
  out.push('Medication');
  if (d.expected === 0) {
    out.push('  No doses were due in this window.');
  } else {
    out.push(`  ${d.recorded} of ${d.expected} doses have a record`
      + (d.recordedBy.length ? ` (${d.recordedBy.map((x) => `${x.name} ${x.count}`).join(', ')})` : ''));
    out.push(`  ${plural(d.noRecord, 'dose')} with no record. Counted as "no record", never as missed.`);
    if (d.loggedLate > 0) {
      out.push(`  ${plural(d.loggedLate, 'dose')} logged after the board already showed "no record".`
        + ` Calling ${d.loggedLate === 1 ? 'it' : 'them'} missed would have been wrong.`);
    }
  }
  out.push('');

  const w = r.work;
  out.push('Work that needed an owner');
  out.push(`  ${plural(w.created, 'new task')}${w.proposed ? `, ${w.proposed} proposed by CareCircle`
    + ` (${w.proposedConfirmed} confirmed, ${w.proposedDismissed} dismissed)` : ''}`);
  if (w.asked > 0) {
    out.push(`  ${plural(w.asked, 'ask')} (${w.askedByCareCircle} by CareCircle): ${w.accepted} yes, `
      + `${w.declined} no, ${w.unanswered} no answer`
      + (w.medianAnswerMinutes !== null ? `; median answer in ${minutes(w.medianAnswerMinutes)}` : ''));
  }
  out.push(`  ${w.done} done · ${w.stillUnowned} still with nobody on ${w.stillUnowned === 1 ? 'it' : 'them'}`);
  out.push('');

  if (r.signals.total > 0) {
    out.push(`Signals: ${r.signals.bySource.map((s) => `${s.source} ${s.count}`).join(', ')}`);
  }
  if (r.eveningUpdates.sent > 0) {
    out.push(`Evening updates: ${r.eveningUpdates.sent} sent to ${r.eveningUpdates.recipients.join(', ')}`);
  }
  return out.join('\n').trimEnd();
}
