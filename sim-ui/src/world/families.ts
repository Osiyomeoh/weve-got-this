import type { CareCaseId } from '../lib/api';
import { CAST, type Person } from './cast';
import { EYES, setHomeZone, STORY, storyFor, type Words } from './story';

// Who the family is caring for. Daddy's week after eye surgery is the builder's own family
// and the default. Mama and Baba are simulated families, labelled as such wherever they
// are offered, played on the same real server: the server seeds their copy with their
// names and needs (src/demo/cases.ts), and these are the same people in the world.

/** Where the family lives. The picker asks this first, then the family. */
export type Country = 'ng' | 'us';
export const COUNTRIES: Record<Country, { label: string; zone: string }> = {
  ng: { label: 'Nigeria', zone: 'Africa/Lagos' },
  us: { label: 'United States', zone: 'America/New_York' },
};

export interface Family {
  id: CareCaseId;
  country: Country;
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
  /** How Tolu's day is played, when it is not from across town. */
  toluPlayAs?: string;
  /** Who coordinates, over CAST.tolu, when it is not Tolu. */
  tolu?: Pick<Person, 'name' | 'model' | 'voice' | 'fallbackPitch'>;
  /** Who helps in person, over CAST.musa, when it is not the family's driver. */
  helper?: Pick<Person, 'name' | 'role' | 'playAs' | 'model' | 'voice' | 'fallbackPitch'>;
  /** Where each home is, when the family is not all in one city. */
  places?: { home: string; tolu: string };
  words: Words;
  /** The closing panel. */
  ending: string;
}

const EYES_RECIPIENT = { ...CAST.daddy! };
const TOLU = { ...CAST.tolu! };
const TOLU_ROLE = TOLU.role;
const MUSA = { ...CAST.musa! };

/** Mummy presses OK on the remote: wake the set, open her dose, say yes. */
const PRESS_YES = ['ok', 'ok', 'ok'] as const;

export const FAMILIES: Record<CareCaseId, Family> = {
  eyes: {
    id: 'eyes', country: 'ng', label: 'Daddy', tagline: 'After eye surgery. A real family\'s week.', simulated: false,
    lede: 'A week after eye surgery, Daddy can\'t read a screen. His son Tolu is across town at work. Musa drives for the family.',
    recipient: EYES_RECIPIENT, toluRole: TOLU_ROLE, words: EYES,
    ending: 'Daddy logged his own care by voice. A promise made on one phone was followed up by the agent when it slipped. A doorbell added evidence without claiming to know who. And when nobody knew, it was said as a question.',
  },
  memory: {
    id: 'memory', country: 'ng', label: 'Mama', tagline: 'Early memory loss. A simulated family.', simulated: true,
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
    id: 'wheelchair', country: 'ng', label: 'Baba', tagline: 'Uses a wheelchair. A simulated family.', simulated: true,
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
  hometown: {
    id: 'hometown', country: 'ng', label: 'Mummy', tagline: 'At home in Abeokuta. Her children work in Lagos. A simulated family.', simulated: true,
    lede: 'Mummy lives in Abeokuta, where she has always lived. Her son Tolu and daughter Funmi work in Lagos, two hours away. Bisi, her neighbour, looks in. The TV is the screen she already uses every day.',
    recipient: {
      name: 'Mummy', role: 'At home in Abeokuta, her children in Lagos',
      playAs: 'You don\'t talk to the speaker much. You have the TV remote in your hand every evening.',
      model: 'character-female-c', voice: 'Danielle', fallbackPitch: 1.0,
    },
    toluRole: 'Her son, in Lagos, coordinating her care from two hours away',
    toluPlayAs: 'You hold it all together from Lagos, between meetings, two hours from her door.',
    helper: {
      name: 'Bisi', role: 'Mummy\'s neighbour in Abeokuta',
      playAs: 'You live next door. You\'re the one who is actually there.',
      model: 'character-female-a', voice: 'Joanna', fallbackPitch: 1.15,
    },
    places: { home: 'Abeokuta', tolu: 'Lagos' },
    words: {
      who: 'Mummy', his: 'her', him: 'her',
      intro: 'Mummy lives in Abeokuta. Her children work in Lagos. She doesn\'t talk to the speaker much, but she has the TV remote in her hand every day.',
      morningPoint: 'The person cared for records her own care, on the screen she already uses. Her word, pressed, not spoken.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      morningSteps: [
        { kind: 'remote', who: 'daddy', keys: [...PRESS_YES], expect: 'log_care_event', shot: 'daddyTv',
          caption: 'Mummy\'s TV asks about her 8 o\'clock tablet. She answers with the OK button.' },
        { kind: 'caption', text: 'In Lagos, two hours away, her children\'s record says the same thing at the same moment.', shot: 'both', ms: 3400 },
      ],
      refill: 'Mummy\'s blood pressure tablets refill',
      ride: 'Mummy to her hospital check-up',
      evening: 'blood pressure tablet', use: { present: 'take', past: 'took' },
      handover: 'Good evening, Mummy. Your tablets.',
      helper: { name: 'Bisi', they: 'she' },
      toluWhere: 'In Lagos, two hours away',
      askPoint: 'One sentence in Lagos becomes a question on the phone of the one person who is in Abeokuta.',
      ridePoint: 'Living in Lagos is not a reason to be left out. Tolu can\'t be there tonight, but he can be there on Thursday, and he says so.',
      rideSteps: [
        { kind: 'line', who: 'tolu', via: 'echo', text: 'I\'ll drive down and take Mummy to her hospital check-up on Thursday.', expect: ['claim_obligation'], shot: 'tolu' },
      ],
      ringCaption: 'Ring sees someone at Mummy\'s door at 7:58, and the live view opens over her programme. Nobody from the family is in Abeokuta to see it. Ring can say a person. It can\'t say who.',
      afterDoor: 'Mummy knows Bisi came. Her children, in Lagos, only know what the record knows: someone did. Bisi goes home, and never says it\'s done.',
      answerSteps: [
        { kind: 'remote', who: 'daddy', keys: [...PRESS_YES], expect: 'log_care_event', shot: 'daddyTv',
          caption: 'Mummy sees the same question on her TV, and answers it from her chair.' },
      ],
      answered: 'One press on a remote in Abeokuta. The question cleared for her whole family at once, in Lagos too.',
    },
    ending: 'Mummy logged her own care with the TV remote she already holds, twice. Her children, two hours away in Lagos, saw it the moment she pressed. Tolu took Thursday from Lagos; Bisi, next door, took tonight. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped.',
  },
  // An American family. Mom lives alone in Dayton, Ohio; her children are in three other
  // states, and the one fifteen minutes away ends up doing most of it. Simulated, labelled.
  us: {
    id: 'us', country: 'us', label: 'Mom', tagline: 'Lives alone in Dayton, Ohio. Her kids are spread across three states. A simulated family.', simulated: true,
    lede: 'Mom lives alone in Dayton, Ohio. Sarah coordinates from Chicago, four hours away, between meetings. Mike lives fifteen minutes from Mom and ends up doing most of it. Jen is in Seattle, Tom in Phoenix. Mom watches TV every evening.',
    recipient: {
      name: 'Mom', role: 'Lives alone in Dayton, Ohio',
      playAs: 'You don\'t talk to the speaker much. The TV remote is always in your hand.',
      model: 'character-female-d', voice: 'Kendra', fallbackPitch: 1.0,
    },
    toluRole: 'Her daughter, in Chicago, coordinating Mom\'s care around a full-time job',
    toluPlayAs: 'You hold it together from Chicago, between meetings, four hours from her door.',
    tolu: { name: 'Sarah', model: 'character-female-b', voice: 'Joanna', fallbackPitch: 1.1 },
    helper: {
      name: 'Mike', role: 'Her son, fifteen minutes away',
      playAs: 'You\'re the one who lives close. You\'re the one who always gets the call.',
      model: 'character-male-a', voice: 'Stephen', fallbackPitch: 1.0,
    },
    places: { home: 'Dayton, OH', tolu: 'Chicago, IL' },
    words: {
      who: 'Mom', his: 'her', him: 'her',
      intro: 'Mom lives alone in Dayton, Ohio. Her kids are in Chicago, Seattle and Phoenix, and Mike fifteen minutes away. The TV is on most of the day.',
      morningPoint: 'The person cared for records her own care, over the show she is already watching. Her word, pressed, not spoken.',
      logMorning: 'Alexa, I took my blood pressure pill.',
      morningSteps: [
        { kind: 'remote', who: 'daddy', keys: [...PRESS_YES], expect: 'log_care_event', shot: 'daddyTv',
          caption: 'Mom\'s morning news is on. Her TV asks about her 8 o\'clock pill over it, and she answers with the OK button.' },
        { kind: 'caption', text: 'In Chicago, Sarah\'s record says the same thing at the same moment. No call to check. No "Mom, did you take it?"', shot: 'both', ms: 3600 },
      ],
      refill: 'Mom\'s blood pressure pill refill',
      ride: 'Mom to her cardiology follow-up',
      evening: 'blood pressure pill', use: { present: 'take', past: 'took' },
      handover: 'Hey Mom. Got your pills.',
      helper: { name: 'Mike', they: 'he' },
      primary: { name: 'Sarah', self: 'herself' },
      toluWhere: 'In Chicago, four hours from Mom',
      askPoint: 'Seven in ten family caregivers have a job. One sentence in Chicago becomes a question on the phone of the one person fifteen minutes from Mom.',
      ridePoint: 'Living four hours away is not a reason to be left out. Sarah can\'t do tonight, but she can do Thursday, and she says so.',
      rideSteps: [
        { kind: 'line', who: 'tolu', via: 'echo', text: 'I\'ll drive down Wednesday night and take Mom to her cardiology follow-up on Thursday.', expect: ['claim_obligation'], shot: 'tolu' },
      ],
      ringCaption: 'Ring sees someone at Mom\'s door at 7:58, and the live view opens over her game show. It can say a person. It can\'t say who.',
      afterDoor: 'Mom knows it was Mike. Sarah, in Chicago, only knows what the record knows: someone came. Mike heads home, and never says it\'s done.',
      answerSteps: [
        { kind: 'remote', who: 'daddy', keys: [...PRESS_YES], expect: 'log_care_event', shot: 'daddyTv',
          caption: 'Mom sees the same question on her TV, and answers it without getting up.' },
      ],
      answered: 'One press on a remote in Dayton. The question cleared for the whole family at once: Chicago, Seattle and Phoenix too.',
    },
    ending: 'Mom logged her own care with the remote already in her hand. Sarah, four hours away, saw it the moment she pressed, and took Thursday from Chicago. Mike, fifteen minutes away, took tonight, and was asked, not assumed: three in four caregivers say they get no consistent help from family, and the one nearby is not the only name on the record. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped.',
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
  CAST.tolu = { ...TOLU, ...f.tolu, role: f.toluRole, playAs: f.toluPlayAs ?? TOLU.playAs };
  CAST.musa = { ...MUSA, ...f.helper };
  setHomeZone(COUNTRIES[f.country].zone);
  STORY.splice(0, STORY.length, ...storyFor(f.words));
}
