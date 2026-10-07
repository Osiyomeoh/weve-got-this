import type { PersonKey } from './cast';

// One day in the family's life, as the world plays it. Nothing here is a canned answer:
// every line is sent to the real Alexa+ planner as that person, and every device signal
// is a real tool call on the visitor's own copy of the care record. What comes back is
// whatever the server says.

export type ShotName = 'overview' | 'daddy' | 'daddyTv' | 'tolu' | 'musa' | 'pharmacy' | 'door' | 'both' | 'hub';
export type Device = 'echo' | 'phone';
export type Stage = 'midday' | 'pharmacy' | 'driving' | 'atDoor' | 'backInCar';

export type Step =
  /** A person speaks to their device. If the visitor plays them, the visitor says it. */
  | { kind: 'line'; who: PersonKey; text: string; via: Device; expect?: string[]; shot?: ShotName }
  /** A device or the server itself acts, through a tool, with no one speaking. */
  | { kind: 'signal'; source: 'ring' | 'agent'; tool: string; args: Record<string, unknown>; caption: string; shot?: ShotName }
  /** A caption on screen, nobody's words. */
  | { kind: 'caption'; text: string; ms?: number; shot?: ShotName }
  /** The clock runs forward to a time of day, lights following it. */
  | { kind: 'lapse'; to: [number, number]; seconds: number; shot?: ShotName }
  /** Musa moves through his evening. */
  | { kind: 'musa'; stage: Stage; shot?: ShotName; ms?: number }
  /** People speaking to each other, not to Alexa. Never sent to the server, never on the record. */
  | { kind: 'aside'; who: PersonKey; to: PersonKey; text: string; listener?: 'nod' | 'shake'; shot?: ShotName }
  /** Someone gets up and goes somewhere in their home. The story moves on while they walk. */
  | { kind: 'move'; who: PersonKey; to: 'home' | 'door'; ms?: number; shot?: ShotName }
  | { kind: 'shot'; shot: ShotName; ms?: number };

export interface Beat {
  id: string;
  at: [number, number];
  title: string;
  /** Why this moment matters, in one line, for the beat card. */
  point: string;
  steps: Step[];
}

/**
 * The words of one family's day. The shape of the day is the same for every family: it is
 * the coordination being shown, not a condition. What changes is who is cared for, what
 * they take, where Thursday's ride goes, and the one moment their need makes different.
 */
export interface Words {
  /** How the family speaks of them: "Daddy", "Mama", "Baba". */
  who: string;
  /** "his" / "her". */
  his: string;
  /** "him" / "her". */
  him: string;
  /** The opening caption, over their home. */
  intro: string;
  /** What the morning beat's card says about them. */
  morningPoint: string;
  /** What they say as their morning dose is taken. */
  logMorning: string;
  /** The refill, as Tolu asks for it. */
  refill: string;
  /** The ride, as it is said. */
  ride: string;
  /** "eye drops", "blood pressure tablet": the evening dose. */
  evening: string;
  /** How the dose is said: you "use" eye drops and "take" a tablet. */
  use: { present: string; past: string };
  /** What Musa hands over at the door. */
  handover: string;
  /**
   * The moment this family's need changes the day, played right after the morning.
   * Memory loss: asking again, and the record answering the same way, calmly.
   */
  extraMorning?: Step[];
  /**
   * Thursday's ride. Default: Tolu takes it on himself. Wheelchair: Musa is asked, says no
   * with his reason, and the loop moves on instead of stalling.
   */
  rideSteps?: Step[];
  ridePoint?: string;
}

export const EYES: Words = {
  who: 'Daddy', his: 'his', him: 'him',
  intro: 'Daddy is a week out of eye surgery. He can\'t read a screen, so he talks.',
  morningPoint: 'The person cared for is a participant, not a monitored subject. He records his own care.',
  logMorning: 'Alexa, I used my eye drops.',
  refill: 'Daddy\'s eye drops refill',
  ride: 'Daddy to his eye check-up',
  evening: 'eye drops',
  use: { present: 'use', past: 'used' },
  handover: 'Good evening, sir. Your eye drops.',
};

export function storyFor(w: Words): Beat[] {
  return [
  {
    id: 'morning', at: [7, 42], title: `${w.who}'s morning`,
    point: w.morningPoint,
    steps: [
      { kind: 'caption', text: w.intro, shot: 'daddy', ms: 3200 },
      { kind: 'line', who: 'daddy', via: 'echo', text: w.logMorning, expect: ['log_care_event'] },
      ...(w.extraMorning ?? []),
    ],
  },
  {
    id: 'ask', at: [12, 30], title: 'Tolu, between meetings',
    point: 'One sentence in one house becomes a question on someone else\'s phone across town.',
    steps: [
      { kind: 'caption', text: 'Across town, Tolu has ten minutes between meetings.', shot: 'tolu', ms: 2600 },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Alexa, what\'s going to fall through the cracks this week?', expect: ['get_care_gaps'] },
      { kind: 'line', who: 'tolu', via: 'echo', text: `Ask Musa if he can pick up ${w.refill} tonight.`, expect: ['request_owner'] },
      { kind: 'shot', shot: 'musa', ms: 1800 },
      { kind: 'line', who: 'musa', via: 'phone', text: 'Yes, I\'ll do it.', expect: ['respond_to_request'], shot: 'musa' },
    ],
  },
  {
    id: 'ride', at: [12, 34], title: 'Thursday\'s ride',
    point: w.ridePoint ?? 'Work has an owner or it is a gap. Tolu takes the ride himself.',
    steps: w.rideSteps ?? [
      { kind: 'line', who: 'tolu', via: 'echo', text: `I'll take ${w.ride} on Thursday.`, expect: ['claim_obligation'], shot: 'tolu' },
    ],
  },
  {
    id: 'evening', at: [19, 20], title: 'The evening gets away',
    point: 'Saying yes is not doing it. The day runs on.',
    steps: [
      { kind: 'lapse', to: [19, 20], seconds: 4, shot: 'overview' },
      { kind: 'musa', stage: 'pharmacy', shot: 'pharmacy', ms: 4200 },
      { kind: 'lapse', to: [19, 58], seconds: 2.5, shot: 'overview' },
      { kind: 'musa', stage: 'driving', ms: 3500 },
      { kind: 'musa', stage: 'atDoor', shot: 'door', ms: 3200 },
      // They hear the bell and come to the door, slowly, while the doorbell reports what it saw.
      { kind: 'move', who: 'daddy', to: 'door' },
      {
        kind: 'signal', source: 'ring', tool: 'ingest_signal', args: { source: 'ring', kind: 'motion' }, shot: 'door',
        caption: `Ring sees someone at ${w.who}'s door at 7:58. It can say a person. It can't say who.`,
      },
      { kind: 'aside', who: 'musa', to: 'daddy', text: w.handover, shot: 'door' },
      { kind: 'aside', who: 'daddy', to: 'musa', text: 'Thank you, Musa.', listener: 'nod' },
      { kind: 'move', who: 'daddy', to: 'home' },
      { kind: 'musa', stage: 'backInCar', shot: 'overview', ms: 3000 },
      { kind: 'caption', text: `${w.who} knows who came. The record only knows someone did. Musa drives on, and never says it's done.`, ms: 3600 },
    ],
  },
  {
    id: 'checkin', at: [20, 16], title: '8:16 PM. Nobody asked it to.',
    point: 'Every 15 minutes the agent looks for promises slipping. It asks. It never accuses, never reassigns.',
    steps: [
      { kind: 'lapse', to: [20, 16], seconds: 2.5, shot: 'hub' },
      {
        kind: 'signal', source: 'agent', tool: 'run_care_agent', args: {}, shot: 'hub',
        caption: 'The pharmacy run was due at 8:00. CareCircle\'s own pass notices, and asks the one person who said yes.',
      },
      { kind: 'shot', shot: 'musa', ms: 2600 },
      { kind: 'line', who: 'musa', via: 'phone', text: `Done. I dropped them with ${w.him} at eight.`, expect: ['resolve_obligation'], shot: 'musa' },
      { kind: 'line', who: 'tolu', via: 'echo', text: `Where does it say ${w.refill} was picked up? Show me the trail.`, expect: ['get_provenance'], shot: 'tolu' },
    ],
  },
  {
    id: 'unknown', at: [21, 10], title: 'Known is not assumed',
    point: 'No record is not the same as "didn\'t happen". It is said as a question, never as a failure.',
    steps: [
      { kind: 'lapse', to: [21, 10], seconds: 2, shot: 'overview' },
      { kind: 'line', who: 'tolu', via: 'echo', text: `Did ${w.who} ${w.use.present} ${w.his} evening ${w.evening}?`, shot: 'tolu' },
      { kind: 'shot', shot: 'daddyTv', ms: 3500 },
      { kind: 'line', who: 'daddy', via: 'echo', text: `Alexa, I ${w.use.past} my evening ${w.evening} at ten to eight.`, expect: ['log_care_event'], shot: 'daddy' },
      { kind: 'caption', text: `One record. The question cleared for the whole family at once, on ${w.who}'s TV too.`, shot: 'both', ms: 3600 },
    ],
  },
  ];
}

/**
 * The day being played. One family at a time per page, and the people keep their keys
 * ("daddy" is always the person cared for, as m_margaret is on the server), so choosing a
 * family rewrites this in place rather than threading a story through every component.
 */
export const STORY: Beat[] = storyFor(EYES);

/** The household lives in Lagos (UTC+1, no daylight saving). */
const LAGOS_OFFSET_H = 1;

/** Today's date in Lagos, at a Lagos wall-clock time. */
export function lagosToday(hour: number, minute: number, base = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(base);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, hour - LAGOS_OFFSET_H, minute));
}

export function clockText(at: Date): string {
  return at.toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos', hour: 'numeric', minute: '2-digit' });
}

/** Hours since Lagos midnight, as a fraction, for the sun. */
export function lagosHour(at: Date): number {
  return ((at.getUTCHours() + LAGOS_OFFSET_H) % 24) + at.getUTCMinutes() / 60;
}
