import type { PersonKey } from './cast';
import type { Key } from '../lib/dpad';

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
  /**
   * Someone picks up the TV remote and presses its buttons. The TV on the wall is the real
   * Fire TV page, so the press does whatever it does there, through the same tools.
   */
  | { kind: 'remote'; who: PersonKey; keys: Key[]; expect: string; caption: string; shot?: ShotName }
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
  /** Who helps in person, when it is not Musa: their name and "he"/"she". */
  helper?: { name: string; they: string };
  /** Who coordinates, when it is not Tolu: their name and "himself"/"herself". */
  primary?: { name: string; self: string };
  /** Where Tolu is, as the day opens on them. Default: across town. */
  toluWhere?: string;
  /** The ask beat's point, when the family is not all in one town. */
  askPoint?: string;
  /** How the morning dose gets on the record, when it is not said to the Echo. */
  morningSteps?: Step[];
  /** What the doorbell's card says, when there is more to say about who is not there. */
  ringCaption?: string;
  /** The caption as the helper drives away. */
  afterDoor?: string;
  /** How the evening question is answered, when it is not said to the Echo. */
  answerSteps?: Step[];
  /** The caption once the evening question is answered. */
  answered?: string;
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
  const helper = w.helper ?? { name: 'Musa', they: 'he' };
  const H = helper.name;
  const T = w.primary?.name ?? 'Tolu';
  return [
  {
    id: 'morning', at: [7, 42], title: `${w.who}'s morning`,
    point: w.morningPoint,
    steps: [
      { kind: 'caption', text: w.intro, shot: 'daddy', ms: 3200 },
      ...(w.morningSteps ?? [
        { kind: 'line', who: 'daddy', via: 'echo', text: w.logMorning, expect: ['log_care_event'] } as Step,
        // The same record, on the screen already in the room: the TV is not a second app.
        { kind: 'caption', text: `${w.who}'s TV shows it the moment it is said. Nobody had to open anything.`, shot: 'daddyTv', ms: 3200 } as Step,
      ]),
      ...(w.extraMorning ?? []),
    ],
  },
  {
    id: 'ask', at: [12, 30], title: `${T}, between meetings`,
    point: w.askPoint ?? 'One sentence in one house becomes a question on someone else\'s phone across town.',
    steps: [
      { kind: 'caption', text: `${w.toluWhere ?? 'Across town'}, ${T} has ten minutes between meetings.`, shot: 'tolu', ms: 2600 },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Alexa, what\'s going to fall through the cracks this week?', expect: ['get_care_gaps'] },
      { kind: 'line', who: 'tolu', via: 'echo', text: `Ask ${H} if ${helper.they} can pick up ${w.refill} tonight.`, expect: ['request_owner'] },
      { kind: 'shot', shot: 'musa', ms: 1800 },
      { kind: 'line', who: 'musa', via: 'phone', text: 'Yes, I\'ll do it.', expect: ['respond_to_request'], shot: 'musa' },
    ],
  },
  {
    id: 'ride', at: [12, 34], title: 'Thursday\'s ride',
    point: w.ridePoint ?? `Work has an owner or it is a gap. ${T} takes the ride ${w.primary?.self ?? 'himself'}.`,
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
      // The bell: on Fire TV the door camera opens over whatever is on. They see someone, and
      // get up and go to the door, slowly, while the doorbell reports what it saw.
      {
        kind: 'signal', source: 'ring', tool: 'ingest_signal', args: { source: 'ring', kind: 'motion' }, shot: 'daddyTv',
        caption: w.ringCaption ?? `Ring sees someone at ${w.who}'s door at 7:58, and the live view opens over the programme on the TV. It can say a person. It can't say who.`,
      },
      { kind: 'move', who: 'daddy', to: 'door', shot: 'door' },
      { kind: 'aside', who: 'musa', to: 'daddy', text: w.handover, shot: 'door' },
      { kind: 'aside', who: 'daddy', to: 'musa', text: `Thank you, ${H}.`, listener: 'nod' },
      { kind: 'move', who: 'daddy', to: 'home' },
      { kind: 'musa', stage: 'backInCar', shot: 'overview', ms: 3000 },
      { kind: 'caption', text: w.afterDoor ?? `${w.who} knows who came. The record only knows someone did. ${H} drives on, and never says it's done.`, ms: 3600 },
    ],
  },
  {
    id: 'checkin', at: [20, 16], title: 'Nobody asked it to',
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
      ...(w.answerSteps ?? [
        { kind: 'line', who: 'daddy', via: 'echo', text: `Alexa, I ${w.use.past} my evening ${w.evening} at ten to eight.`, expect: ['log_care_event'], shot: 'daddy' } as Step,
      ]),
      { kind: 'caption', text: w.answered ?? `One record. The question cleared for the whole family at once, on ${w.who}'s TV too.`, shot: 'both', ms: 3600 },
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

/**
 * The zone the household lives in: Lagos, or Dayton for the American family. Every clock in
 * the world is theirs, the way the server's "today" and "8 PM" are.
 */
let ZONE = 'Africa/Lagos';
export function setHomeZone(zone: string): void { ZONE = zone; }

/** The wall clock in the household's zone at an instant, as numbers. */
function wall(at: Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at).map((x) => [x.type, Number(x.value)]));
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute! };
}

/** Today's date in their zone, at a wall-clock time there. Daylight saving included. */
export function homeToday(hour: number, minute: number, base = new Date()): Date {
  const { y, mo, d } = wall(base);
  const guess = Date.UTC(y, mo - 1, d, hour, minute);
  // The zone's offset at that moment, read back from the wall clock, then applied once.
  const seen = wall(new Date(guess));
  const offset = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, seen.mi) - guess;
  return new Date(guess - offset);
}

export function clockText(at: Date): string {
  return at.toLocaleTimeString('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' });
}

/** Hours since their midnight, as a fraction, for the sun. */
export function homeHour(at: Date): number {
  const { h, mi } = wall(at);
  return h + mi / 60;
}
