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

export const STORY: Beat[] = [
  {
    id: 'morning', at: [7, 42], title: 'Daddy\'s morning',
    point: 'The person cared for is a participant, not a monitored subject. He records his own care.',
    steps: [
      { kind: 'caption', text: 'Daddy is a week out of eye surgery. He can\'t read a screen, so he talks.', shot: 'daddy', ms: 3200 },
      { kind: 'line', who: 'daddy', via: 'echo', text: 'Alexa, I used my eye drops.', expect: ['log_care_event'] },
    ],
  },
  {
    id: 'ask', at: [12, 30], title: 'Tolu, between meetings',
    point: 'One sentence in one house becomes a question on someone else\'s phone across town.',
    steps: [
      { kind: 'caption', text: 'Across town, Tolu has ten minutes between meetings.', shot: 'tolu', ms: 2600 },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Alexa, what\'s going to fall through the cracks this week?', expect: ['get_care_gaps'] },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Ask Musa if he can pick up Daddy\'s eye drops refill tonight.', expect: ['request_owner'] },
      { kind: 'shot', shot: 'musa', ms: 1800 },
      { kind: 'line', who: 'musa', via: 'phone', text: 'Yes, I\'ll do it.', expect: ['respond_to_request'], shot: 'musa' },
    ],
  },
  {
    id: 'ride', at: [12, 34], title: 'Thursday\'s ride',
    point: 'Work has an owner or it is a gap. Tolu takes the check-up ride himself.',
    steps: [
      { kind: 'line', who: 'tolu', via: 'echo', text: 'I\'ll take Daddy to his eye check-up on Thursday.', expect: ['claim_obligation'], shot: 'tolu' },
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
      // Daddy hears the bell and gets up, slowly, while the doorbell reports what it saw.
      { kind: 'move', who: 'daddy', to: 'door' },
      {
        kind: 'signal', source: 'ring', tool: 'ingest_signal', args: { source: 'ring', kind: 'motion' }, shot: 'door',
        caption: 'Ring sees someone at Daddy\'s door at 7:58. It can say a person. It can\'t say who.',
      },
      { kind: 'aside', who: 'musa', to: 'daddy', text: 'Good evening, sir. Your eye drops.', shot: 'door' },
      { kind: 'aside', who: 'daddy', to: 'musa', text: 'Thank you, Musa.', listener: 'nod' },
      { kind: 'move', who: 'daddy', to: 'home' },
      { kind: 'musa', stage: 'backInCar', shot: 'overview', ms: 3000 },
      { kind: 'caption', text: 'Daddy knows who came. The record only knows someone did. Musa drives on, and never says it\'s done.', ms: 3600 },
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
      { kind: 'line', who: 'musa', via: 'phone', text: 'Done. I dropped them with him at eight.', expect: ['resolve_obligation'], shot: 'musa' },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Where does it say the eye drops refill was picked up? Show me the trail.', expect: ['get_provenance'], shot: 'tolu' },
    ],
  },
  {
    id: 'unknown', at: [21, 10], title: 'Known is not assumed',
    point: 'No record is not the same as "didn\'t happen". It is said as a question, never as a failure.',
    steps: [
      { kind: 'lapse', to: [21, 10], seconds: 2, shot: 'overview' },
      { kind: 'line', who: 'tolu', via: 'echo', text: 'Did Daddy use his evening eye drops?', shot: 'tolu' },
      { kind: 'shot', shot: 'daddyTv', ms: 3500 },
      { kind: 'line', who: 'daddy', via: 'echo', text: 'Alexa, I used my evening eye drops at ten to eight.', expect: ['log_care_event'], shot: 'daddy' },
      { kind: 'caption', text: 'One record. The question cleared for the whole family at once, on Daddy\'s TV too.', shot: 'both', ms: 3600 },
    ],
  },
];

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
