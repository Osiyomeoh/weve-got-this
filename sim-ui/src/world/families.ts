import type { CareCaseId } from '../lib/api';
import { CAST, type Person } from './cast';
import { EYES, STORY, storyFor, type Words } from './story';

// Who the family is caring for. Daddy's week after eye surgery is the builder's own family
// and the default. Mama and Baba are simulated families, labelled as such wherever they
// are offered, played on the same real server: the server seeds their copy with their
// names and needs (src/demo/cases.ts), and these are the same people in the world.

export interface Family {
  id: CareCaseId;
  /** The picker's tab. */
  label: string;
  /** Said plainly under the tab: real or simulated, and what the need is. */
  tagline: string;
  simulated: boolean;
  /** The picker's opening paragraph. */
  lede: string;
  /** The person cared for, over CAST.daddy. Everyone else is the same family around them. */
  recipient: Pick<Person, 'name' | 'role' | 'playAs' | 'model' | 'voice' | 'fallbackPitch'> & { aid?: Person['aid'] };
  /** Tolu's role card, which names who he is to them. */
  toluRole: string;
  words: Words;
  /** The closing panel. */
  ending: string;
}

const EYES_RECIPIENT = { ...CAST.daddy! };
const TOLU_ROLE = CAST.tolu!.role;

export const FAMILIES: Record<CareCaseId, Family> = {
  eyes: {
    id: 'eyes', label: 'Daddy', tagline: 'After eye surgery. A real family\'s week.', simulated: false,
    lede: 'A week after eye surgery, Daddy can\'t read a screen. His son Tolu is across town at work. Musa drives for the family.',
    recipient: EYES_RECIPIENT, toluRole: TOLU_ROLE, words: EYES,
    ending: 'Daddy logged his own care by voice. A promise made on one phone was followed up by the agent when it slipped. A doorbell added evidence without claiming to know who. And when nobody knew, it was said as a question.',
  },
  memory: {
    id: 'memory', label: 'Mama', tagline: 'Early memory loss. A simulated family.', simulated: true,
    lede: 'Mama is living with early memory loss. Some mornings she isn\'t sure what she has already done. Her son Tolu is across town at work. Musa drives for the family.',
    recipient: {
      name: 'Mama', role: 'Living with early memory loss, at home',
      playAs: 'You don\'t always remember if you took your tablet. You can just ask, as often as you like.',
      model: 'character-female-e', voice: 'Ayanda', fallbackPitch: 1.05,
    },
    toluRole: 'Her son, coordinating care around a full-time job',
    words: {
      who: 'Mama', his: 'her', him: 'her',
      intro: 'Mama is living with early memory loss. When she isn\'t sure, she asks.',
      morningPoint: 'The record answers "did I already?" the same way every time, and never makes her feel she should have known.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      refill: 'Mama\'s blood pressure tablets refill',
      ride: 'Mama to her memory clinic appointment',
      evening: 'blood pressure tablet', use: { present: 'take', past: 'took' },
      handover: 'Good evening, Mama. Your tablets.',
      extraMorning: [
        { kind: 'lapse', to: [9, 5], seconds: 2, shot: 'daddy' },
        { kind: 'line', who: 'daddy', via: 'echo', text: 'Alexa, did I take my tablet this morning?' },
        { kind: 'caption', text: 'An hour later she asks again. The answer is the same, and just as calm.', ms: 3000 },
        { kind: 'lapse', to: [10, 10], seconds: 1.5, shot: 'daddy' },
        { kind: 'line', who: 'daddy', via: 'echo', text: 'Alexa, have I had my tablet today?' },
      ],
    },
    ending: 'Mama logged her own tablet, and asked twice whether she had: the record answered the same way both times. A promise made on one phone was followed up when it slipped. A doorbell added evidence without claiming to know who. And when nobody knew, it was said as a question.',
  },
  wheelchair: {
    id: 'wheelchair', label: 'Baba', tagline: 'Uses a wheelchair. A simulated family.', simulated: true,
    lede: 'Baba uses a wheelchair and runs his own day. Getting to physiotherapy takes a car that can carry the chair. His son Tolu is across town at work. Musa drives for the family.',
    recipient: {
      name: 'Baba', role: 'Uses a wheelchair, at home',
      playAs: 'You run your own day from your chair. Getting across town is the hard part.',
      model: 'character-male-e', voice: 'Arthur', fallbackPitch: 0.85, aid: 'wheelchair',
    },
    toluRole: TOLU_ROLE,
    words: {
      who: 'Baba', his: 'his', him: 'him',
      intro: 'Baba uses a wheelchair. He runs his own day, and he talks to Alexa.',
      morningPoint: 'The person cared for is a participant, not a monitored subject. He records his own care.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      refill: 'Baba\'s blood pressure tablets refill',
      ride: 'Baba to physiotherapy',
      evening: 'blood pressure tablet', use: { present: 'take', past: 'took' },
      handover: 'Good evening, sir. Your tablets.',
      ridePoint: 'A no is an answer, not a dead end. Musa\'s car can\'t take the chair, so he says so, and the ride never quietly hangs.',
      rideSteps: [
        { kind: 'line', who: 'tolu', via: 'echo', text: 'Ask Musa if he can take Baba to physiotherapy on Thursday.', expect: ['request_owner'], shot: 'tolu' },
        { kind: 'shot', shot: 'musa', ms: 1800 },
        { kind: 'line', who: 'musa', via: 'phone', text: 'Sorry, I can\'t. My car can\'t take the wheelchair.', expect: ['respond_to_request'], shot: 'musa' },
        { kind: 'line', who: 'tolu', via: 'echo', text: 'Then I\'ll take Baba to physiotherapy myself on Thursday.', expect: ['claim_obligation'], shot: 'tolu' },
      ],
    },
    ending: 'Baba logged his own care by voice. Musa said no to a ride his car couldn\'t do, and the no moved the loop on instead of stalling it. A promise made on one phone was followed up when it slipped. And when nobody knew, it was said as a question.',
  },
};

let current: CareCaseId = 'eyes';

/** The family being played. */
export function family(): Family { return FAMILIES[current]; }

/**
 * Make this the family the world plays. The people keep their keys - "daddy" is always the
 * person cared for - so the cast and the day are rewritten in place.
 */
export function setFamily(id: CareCaseId): void {
  current = id;
  const f = FAMILIES[id];
  // Start from the real recipient each time, so an aid never carries over from another family.
  CAST.daddy = { ...EYES_RECIPIENT, aid: undefined, ...f.recipient };
  CAST.tolu = { ...CAST.tolu!, role: f.toluRole };
  STORY.splice(0, STORY.length, ...storyFor(f.words));
}
