import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { promisesThisWeek } from './promises.ts';
import { blameIn } from './no-blame.ts';
import type { CareEvent, CareState, Obligation, ObligationStatus } from './types.ts';
import type { ObligationTransition } from '../store/store.ts';

// Lagos is UTC+1: 19:00Z is 8 PM at home.
const TZ = 'Africa/Lagos';
const NOW = new Date('2026-10-16T19:40:00Z'); // 8:40 PM
const AGENT = 'system:carecircle';

const names: Record<string, string> = {
  m_tolu: 'Tolu',
  m_funmi: 'Funmi',
  m_kemi: 'Kemi',
  [AGENT]: 'the app',
};
const nameOf = (id: string | null) => (id ? names[id] : undefined);

function obligation(over: Partial<Obligation> = {}): Obligation {
  return {
    id: 'o1',
    householdId: 'h1',
    what: "Pick up Daddy's eye drops refill",
    status: 'ASSIGNED',
    consequence: 'medical',
    provenance: { kind: 'CONFIRMED', byMemberId: 'm_tolu', at: '2026-10-15T18:00:00Z' },
    ownerId: 'm_funmi',
    dueAt: '2026-10-16T19:00:00Z',
    createdAt: '2026-10-15T18:00:00Z',
    ...over,
  };
}

let seq = 0;
function event(
  kind: CareEvent['kind'],
  at: string,
  by: string,
  data: Record<string, unknown>,
  over: Partial<CareEvent> = {},
): CareEvent {
  return {
    id: `e${++seq}`,
    householdId: 'h1',
    kind,
    reportedBy: by,
    occurredAt: at,
    recordedAt: at,
    data,
    ...over,
  };
}

function move(
  from: ObligationStatus,
  to: ObligationStatus,
  by: string,
  at: string,
): ObligationTransition {
  return { obligationId: 'o1', from, to, byMemberId: by, at };
}

function state(obligations: Obligation[], events: CareEvent[] = []): CareState {
  return {
    household: { id: 'h1', name: 'The Adeyemis', timezone: TZ },
    members: [],
    events,
    obligations,
    medications: [],
    entities: [],
  };
}

const asked = (to: string, at: string, extra: Record<string, unknown> = {}) =>
  event('owner_requested', at, AGENT, {
    obligationId: 'o1',
    askedOfId: to,
    escalation: false,
    ...extra,
  });
const answered = (by: string, at: string, accepted: boolean, extra: Record<string, unknown> = {}) =>
  event('request_answered', at, by, { obligationId: 'o1', accepted, ...extra });

// The evening the story plays: asked at 9 AM, yes at 9:05, due at 8 PM.
const askedAndYes = {
  events: [
    asked('m_funmi', '2026-10-16T08:00:00Z'),
    answered('m_funmi', '2026-10-16T08:05:00Z', true),
  ],
  transitions: [
    move('OPEN', 'REQUESTED', AGENT, '2026-10-16T08:00:00Z'),
    move('REQUESTED', 'ASSIGNED', 'm_funmi', '2026-10-16T08:05:00Z'),
  ],
};

function week(o: Obligation, events: CareEvent[], transitions: ObligationTransition[], now = NOW) {
  return promisesThisWeek(state([o], events), () => transitions, nameOf, now);
}

test('a yes reads as the person’s own yes, with when it is due', () => {
  const [p] = week(
    obligation(),
    askedAndYes.events,
    askedAndYes.transitions,
    new Date('2026-10-16T12:00:00Z'),
  );
  assert.equal(p!.stage, 'promised');
  assert.equal(p!.promisedBy, 'Funmi');
  assert.equal(p!.owner, 'Funmi');
  assert.equal(p!.spoken, "Funmi said yes to pick up Daddy's eye drops refill, due today at 8 PM.");
  assert.deepEqual(
    p!.steps.map((s) => s.kind),
    ['asked', 'yes'],
  );
  assert.equal(p!.steps[0]!.detail, 'The app asked Funmi at 9:00 AM.');
});

test('due with nothing marked and a check-in out: "nothing\'s been marked yet", never a broken promise', () => {
  const events = [
    ...askedAndYes.events,
    asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true }),
  ];
  const [p] = week(obligation(), events, askedAndYes.transitions);
  assert.equal(p!.stage, 'checking');
  assert.equal(
    p!.spoken,
    "Funmi said yes to pick up Daddy's eye drops refill, due today at 8 PM. The app checked in at 8:16 PM to ask if it's still on, and nothing's been marked yet.",
  );
  assert.equal(blameIn(p!.spoken), null);
});

test('a heads-up to the primary caregiver is said as one, after the check-in', () => {
  const events = [
    ...askedAndYes.events,
    asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true }),
    asked('m_tolu', '2026-10-16T19:36:00Z', { followUp: true, escalation: true }),
  ];
  const [p] = week(obligation(), events, askedAndYes.transitions);
  assert.equal(p!.stage, 'checking');
  assert.match(p!.spoken, /The app also let Tolu know at 8:36 PM\.$/);
});

test('"on my way" after a check-in reads as still on', () => {
  const events = [
    ...askedAndYes.events,
    asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true }),
    answered('m_funmi', '2026-10-16T19:18:00Z', true, { stillOn: true }),
  ];
  const [p] = week(obligation(), events, askedAndYes.transitions);
  assert.equal(p!.stage, 'still_on');
  assert.match(p!.spoken, /When the app checked in at 8:16 PM, Funmi said it's still on\.$/);
  // A "still on" is not a second yes: the promise is the one given in the morning.
  assert.equal(p!.steps.filter((s) => s.kind === 'yes').length, 1);
});

test('asked the day before: a question waiting for an answer, not "nothing marked"', () => {
  const events = [
    ...askedAndYes.events,
    asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true, ahead: true }),
  ];
  const [p] = week(obligation({ dueAt: '2026-10-17T19:00:00Z' }), events, askedAndYes.transitions);
  assert.equal(p!.stage, 'checking');
  assert.equal(
    p!.spoken,
    "Funmi said yes to pick up Daddy's eye drops refill, due tomorrow at 8 PM. The app checked in at 8:16 PM to ask if it's still on, and there's no answer yet.",
  );
  assert.equal(p!.steps.at(-1)!.ahead, true);
});

test('still on the day before, then the check-in after the time: the latest question decides', () => {
  const events = [
    asked('m_funmi', '2026-10-14T08:00:00Z'),
    answered('m_funmi', '2026-10-14T08:05:00Z', true),
    asked('m_funmi', '2026-10-15T19:16:00Z', { followUp: true, ahead: true }),
    answered('m_funmi', '2026-10-15T19:18:00Z', true, { stillOn: true }),
    asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true }),
  ];
  const transitions = [
    move('OPEN', 'REQUESTED', AGENT, '2026-10-14T08:00:00Z'),
    move('REQUESTED', 'ASSIGNED', 'm_funmi', '2026-10-14T08:05:00Z'),
  ];
  const [p] = week(obligation(), events, transitions);
  assert.equal(p!.stage, 'checking');
  assert.match(
    p!.spoken,
    /checked in at 8:16 PM to ask if it's still on, and nothing's been marked yet\.$/,
  );
});

test('done, with what the doorbell saw beside it and never as it', () => {
  const ring = event(
    'external_signal',
    '2026-10-16T18:58:00Z',
    'device:ring',
    { signalKind: 'person_detected' },
    { source: 'ring', confidence: 'observed' },
  );
  const resolved = event(
    'obligation_resolved',
    '2026-10-16T19:20:00Z',
    'm_funmi',
    { obligationId: 'o1' },
    { derivedFrom: [ring.id] },
  );
  const [p] = week(
    obligation({ status: 'RESOLVED', resolvedAt: '2026-10-16T19:20:00Z' }),
    [...askedAndYes.events, ring, resolved],
    [...askedAndYes.transitions, move('ASSIGNED', 'RESOLVED', 'm_funmi', '2026-10-16T19:20:00Z')],
  );
  assert.equal(p!.stage, 'done');
  assert.equal(p!.owner, null);
  assert.deepEqual(p!.evidence, ['activity at the door at 7:58 PM']);
  assert.equal(
    p!.spoken,
    "Funmi said yes to pick up Daddy's eye drops refill, and marked it done at 8:20 PM. Around then the doorbell saw activity at the door at 7:58 PM.",
  );
});

test('done by someone else names who marked it', () => {
  const [p] = week(obligation({ status: 'RESOLVED' }), askedAndYes.events, [
    ...askedAndYes.transitions,
    move('ASSIGNED', 'RESOLVED', 'm_tolu', '2026-10-16T19:20:00Z'),
  ]);
  assert.match(p!.spoken, /, and Tolu marked it done at 8:20 PM\.$/);
});

test('a no before the yes stays on the trail, and the yes is the one spoken', () => {
  const events = [
    asked('m_kemi', '2026-10-16T07:00:00Z'),
    answered('m_kemi', '2026-10-16T07:10:00Z', false),
    ...askedAndYes.events,
  ];
  const transitions = [
    move('OPEN', 'REQUESTED', AGENT, '2026-10-16T07:00:00Z'),
    move('REQUESTED', 'OPEN', 'm_kemi', '2026-10-16T07:10:00Z'),
    ...askedAndYes.transitions,
  ];
  const [p] = week(obligation(), events, transitions, new Date('2026-10-16T12:00:00Z'));
  assert.deepEqual(
    p!.steps.map((s) => s.kind),
    ['asked', 'no', 'asked', 'yes'],
  );
  assert.equal(p!.steps[1]!.detail, 'Kemi said no at 8:10 AM.');
  assert.equal(p!.promisedBy, 'Funmi');
});

test('handed back: open with nobody, then asking someone new', () => {
  const back = move('ASSIGNED', 'OPEN', 'm_funmi', '2026-10-16T18:05:00Z');
  const [open] = week(obligation({ status: 'OPEN', ownerId: null }), askedAndYes.events, [
    ...askedAndYes.transitions,
    back,
  ]);
  assert.equal(open!.stage, 'open');
  assert.equal(open!.owner, null);
  assert.equal(
    open!.spoken,
    "Funmi said yes to pick up Daddy's eye drops refill, then handed it back at 7:05 PM, so nobody has it right now.",
  );

  const [asking] = week(
    obligation({ status: 'REQUESTED', ownerId: null }),
    [...askedAndYes.events, asked('m_kemi', '2026-10-16T18:06:00Z')],
    [...askedAndYes.transitions, back, move('OPEN', 'REQUESTED', AGENT, '2026-10-16T18:06:00Z')],
  );
  assert.equal(asking!.stage, 'asking');
  assert.match(asking!.spoken, /The app asked Kemi at 7:06 PM, and there's no answer yet\.$/);
});

test('offering is said as offering, not as answering an ask', () => {
  const [p] = week(
    obligation(),
    [],
    [move('OPEN', 'ASSIGNED', 'm_funmi', '2026-10-16T08:05:00Z')],
    new Date('2026-10-16T12:00:00Z'),
  );
  assert.equal(p!.steps[0]!.kind, 'took_on');
  assert.match(p!.spoken, /^Funmi offered to pick up/);
});

test('an offer from earlier in the week never reads "take it on on Tuesday"', () => {
  const [p] = week(obligation(), [], [move('OPEN', 'ASSIGNED', 'm_funmi', '2026-10-13T08:05:00Z')]);
  assert.equal(p!.steps[0]!.detail, 'Funmi offered to take it on, on Tuesday.');
});

test('work put on someone’s name by somebody else is never called their yes', () => {
  // An old record: the primary caregiver wrote the assignment, and no answer from Funmi exists.
  const [p] = week(
    obligation(),
    [],
    [move('OPEN', 'ASSIGNED', 'm_tolu', '2026-10-16T08:05:00Z')],
    new Date('2026-10-16T12:00:00Z'),
  );
  assert.equal(p!.steps[0]!.kind, 'owned');
  assert.equal(p!.steps[0]!.detail, 'It went to Funmi at 9:05 AM.');
  assert.doesNotMatch(p!.spoken, /said yes|offered/);
  assert.equal(p!.promisedBy, 'Funmi');
});

test('only promises, and only this week', () => {
  const transitions = askedAndYes.transitions;
  // Asked, never answered: not a promise.
  assert.equal(
    week(
      obligation({ status: 'REQUESTED', ownerId: null }),
      [asked('m_funmi', '2026-10-16T08:00:00Z')],
      [transitions[0]!],
    ).length,
    0,
  );
  // A guess nobody confirmed: not a promise.
  assert.equal(week(obligation({ status: 'PROPOSED', ownerId: null }), [], []).length, 0);
  // Promised and done a month ago, due a month ago: not this week.
  const old: ObligationTransition[] = [
    move('REQUESTED', 'ASSIGNED', 'm_funmi', '2026-09-10T08:00:00Z'),
    move('ASSIGNED', 'RESOLVED', 'm_funmi', '2026-09-12T08:00:00Z'),
  ];
  assert.equal(
    week(obligation({ status: 'RESOLVED', dueAt: '2026-09-12T08:00:00Z' }), [], old).length,
    0,
  );
  // Promised a month ago and due in three days: this week.
  const soon = week(obligation({ dueAt: '2026-10-19T09:00:00Z' }), [], [old[0]!]);
  assert.equal(soon.length, 1);
  assert.match(soon[0]!.spoken, /, due Monday the 19th at 10 AM\.$/);
  assert.equal(soon[0]!.steps[0]!.detail, 'Funmi said yes on September 10.');
});

test('heard in order: waiting on an answer, then coming up, then done', () => {
  const ride = obligation({
    id: 'o2',
    what: 'Take Daddy to his eye check-up',
    ownerId: 'm_kemi',
    dueAt: '2026-10-17T09:00:00Z',
  });
  const refill = obligation();
  const drops = obligation({
    id: 'o3',
    what: 'Collect the new eye shield',
    status: 'RESOLVED',
    ownerId: 'm_tolu',
  });
  const t = (id: string, ...ts: ObligationTransition[]) =>
    ts.map((x) => ({ ...x, obligationId: id }));
  const byId: Record<string, ObligationTransition[]> = {
    o1: t('o1', move('REQUESTED', 'ASSIGNED', 'm_funmi', '2026-10-16T08:05:00Z')),
    o2: t('o2', move('OPEN', 'ASSIGNED', 'm_kemi', '2026-10-15T08:00:00Z')),
    o3: t(
      'o3',
      move('OPEN', 'ASSIGNED', 'm_tolu', '2026-10-14T08:00:00Z'),
      move('ASSIGNED', 'RESOLVED', 'm_tolu', '2026-10-14T10:00:00Z'),
    ),
  };
  const events = [asked('m_funmi', '2026-10-16T19:16:00Z', { followUp: true })];
  const list = promisesThisWeek(
    state([drops, ride, refill], events),
    (id) => byId[id] ?? [],
    nameOf,
    NOW,
  );
  assert.deepEqual(
    list.map((p) => p.stage),
    ['checking', 'promised', 'done'],
  );
  assert.equal(
    list[2]!.spoken,
    'Tolu offered to collect the new eye shield, and marked it done on Wednesday.',
  );
});

test('property: no promise, step or trail ever blames anyone', () => {
  const statuses: ObligationStatus[] = ['OPEN', 'REQUESTED', 'ASSIGNED', 'RESOLVED', 'DISMISSED'];
  const who = fc.constantFrom('m_tolu', 'm_funmi', 'm_kemi', AGENT, 'm_unknown');
  const at = fc
    .integer({ min: -9 * 24 * 60, max: 0 })
    .map((m) => new Date(NOW.getTime() + m * 60_000).toISOString());
  const arbTransition = fc.record({
    obligationId: fc.constant('o1'),
    from: fc.constantFrom(...statuses),
    to: fc.constantFrom(...statuses),
    byMemberId: who,
    at,
  });
  const arbEvent = fc
    .tuple(
      fc.constantFrom('owner_requested', 'request_answered'),
      at,
      who,
      who,
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
    )
    .map(([kind, when, by, to, a, b, c]) =>
      kind === 'owner_requested'
        ? asked(to, when, { followUp: a, escalation: b })
        : event('request_answered', when, by, {
            obligationId: 'o1',
            accepted: a,
            ...(c ? { stillOn: true } : {}),
          }),
    );
  fc.assert(
    fc.property(
      fc.constantFrom(...statuses),
      fc.option(who, { nil: null }),
      fc.array(arbTransition, { maxLength: 8 }),
      fc.array(arbEvent, { maxLength: 8 }),
      (status, owner, transitions, events) => {
        for (const p of week(obligation({ status, ownerId: owner }), events, transitions)) {
          const said = [p.spoken, ...p.steps.map((s) => s.detail)].join(' ');
          assert.equal(blameIn(said), null, said);
          assert.doesNotMatch(said, /undefined|null|\bbroke|\bfailed|let down/i, said);
          // A yes is only ever spoken as the person's own when they wrote it.
          if (p.spoken.includes(' said yes to ')) {
            const yes = p.steps.filter((s) => s.kind === 'yes').at(-1);
            assert.ok(yes, said);
          }
        }
      },
    ),
    { numRuns: 400 },
  );
});
