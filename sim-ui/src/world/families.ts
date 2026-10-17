import type { CareCaseId } from '../lib/api';
import { CAST, type Person } from './cast';
import { EYES, homeToday, setHomeZone, STORY, storyFor, weekdayName, type Words } from './story';

// Who the family is caring for. Daddy's week after eye surgery is the builder's own family
// and the default. Mama and Baba are simulated families, labelled as such wherever they
// are offered, played on the same real server: the server seeds their copy with their
// names and needs (src/demo/cases.ts), and these are the same people in the world.

/** Where the family lives. The picker asks this first, then the family. */
export type Country = 'ng' | 'ke' | 'us';
export const COUNTRIES: Record<Country, { label: string; zone: string }> = {
  ng: { label: 'Nigeria', zone: 'Africa/Lagos' },
  ke: { label: 'Kenya', zone: 'Africa/Nairobi' },
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
  recipient: Pick<Person, 'name' | 'role' | 'playAs' | 'model' | 'voice' | 'fallbackPitch'> & {
    aid?: Person['aid'];
    size?: number;
  };
  /** Tolu's role card, which names who he is to them. */
  toluRole: string;
  /** How Tolu's day is played, when it is not from across town. */
  toluPlayAs?: string;
  /** Who coordinates, over CAST.tolu, when it is not Tolu. */
  tolu?: Pick<Person, 'name' | 'model' | 'voice' | 'fallbackPitch'>;
  /** Who helps in person, over CAST.musa, when it is not the family's driver. */
  helper?: Pick<Person, 'name' | 'role' | 'playAs' | 'model' | 'voice' | 'fallbackPitch'>;
  /** Who is far away and orders things in, over CAST.kunle. */
  away?: Pick<Person, 'name' | 'role' | 'model' | 'voice' | 'fallbackPitch'>;
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
const KUNLE = { ...CAST.kunle! };

/** Mummy presses OK on the remote: wake the set, open her dose, say yes. */
const PRESS_YES = ['ok', 'ok', 'ok'] as const;

export const FAMILIES: Record<CareCaseId, Family> = {
  eyes: {
    id: 'eyes',
    country: 'ng',
    label: 'Daddy',
    tagline: "After eye surgery. A real family's week.",
    simulated: false,
    lede: "A week after eye surgery, Daddy can't read a screen. His son Tolu is across town at work. Musa drives for the family.",
    recipient: EYES_RECIPIENT,
    toluRole: TOLU_ROLE,
    words: EYES,
    ending:
      "Daddy logged his own care by voice. A promise made on one phone was followed up by the agent when it slipped. A doorbell added evidence without claiming to know who. And when nobody knew, it was said as a question. In one simulated beat, not from the real week, Kunle ordered lunch from London: the doorbell saw it come, and only Musa's word said it reached Daddy.",
  },
  memory: {
    id: 'memory',
    country: 'ng',
    label: 'Mama',
    tagline: 'Early memory loss. A simulated family.',
    simulated: true,
    lede: "Mama is living with early memory loss. Some mornings she isn't sure what she has already done. Her son Tolu is across town at work. Musa drives for the family.",
    recipient: {
      name: 'Mama',
      role: 'Living with early memory loss, at home',
      playAs:
        "You don't always remember if you took your tablet. You can just ask, as often as you like.",
      model: 'character-female-e',
      voice: 'Ayanda',
      fallbackPitch: 1.05,
    },
    toluRole: 'Her son, coordinating care around a full-time job',
    away: {
      name: 'Kunle',
      role: 'Her son, in London',
      model: 'character-male-a',
      voice: 'Arthur',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Mama',
      his: 'her',
      him: 'her',
      intro: "Mama is living with early memory loss. When she isn't sure, she asks.",
      morningPoint:
        'The record answers "did I already?" the same way every time, and never makes her feel she should have known.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      refill: "Mama's blood pressure tablets refill",
      ride: 'Mama to her memory clinic appointment',
      evening: 'blood pressure tablet',
      use: { present: 'take', past: 'took' },
      handover: 'Good evening, Mama. Your tablets.',
      order: {
        by: 'Kunle',
        city: 'London',
        intro:
          "In London, her son Kunle can't be at Mama's table, but he can get her shopping to the door.",
        line: "Alexa, I've ordered Mama's groceries from Iya Basira's shop. They'll be there at one.",
        thing: 'her groceries',
        said: 'at one',
        at: [13, 0],
        handover: 'Good afternoon, Mama. Your groceries, from Kunle.',
      },
      extraMorning: [
        { kind: 'lapse', to: [9, 5], seconds: 2, shot: 'daddy' },
        {
          kind: 'line',
          who: 'daddy',
          via: 'echo',
          text: 'Alexa, did I take my tablet this morning?',
        },
        {
          kind: 'caption',
          text: 'An hour later she asks again. The answer is the same, and just as calm.',
          ms: 3000,
        },
        { kind: 'lapse', to: [10, 10], seconds: 1.5, shot: 'daddy' },
        { kind: 'line', who: 'daddy', via: 'echo', text: 'Alexa, have I had my tablet today?' },
      ],
    },
    ending:
      "Mama logged her own tablet, and asked twice whether she had: the record answered the same way both times. A promise made on one phone was followed up when it slipped. A doorbell added evidence without claiming to know who. And when nobody knew, it was said as a question. Kunle ordered her shopping from London: the doorbell saw it come, and only Musa's word said it reached her.",
  },
  wheelchair: {
    id: 'wheelchair',
    country: 'ng',
    label: 'Baba',
    tagline: 'Uses a wheelchair. A simulated family.',
    simulated: true,
    lede: 'Baba uses a wheelchair and runs his own day. Getting to physiotherapy takes a car that can carry the chair. His son Tolu is across town at work. Musa drives for the family.',
    recipient: {
      name: 'Baba',
      role: 'Uses a wheelchair, at home',
      playAs: 'You run your own day from your chair. Getting across town is the hard part.',
      model: 'character-male-e',
      voice: 'Arthur',
      fallbackPitch: 0.85,
      aid: 'wheelchair',
    },
    toluRole: TOLU_ROLE,
    away: {
      name: 'Kunle',
      role: 'His son, in London',
      model: 'character-male-a',
      voice: 'Gregory',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Baba',
      his: 'his',
      him: 'him',
      intro: 'Baba uses a wheelchair. He runs his own day, and he talks to Alexa.',
      morningPoint:
        'The person cared for is a participant, not a monitored subject. He records his own care.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      refill: "Baba's blood pressure tablets refill",
      ride: 'Baba to physiotherapy',
      evening: 'blood pressure tablet',
      use: { present: 'take', past: 'took' },
      handover: 'Good evening, sir. Your tablets.',
      order: {
        by: 'Kunle',
        city: 'London',
        intro: "In London, his son Kunle can't carry Baba's water in, but he can order it.",
        line: "Alexa, I've ordered Baba's drinking water from the water depot on his road. It'll be there at one.",
        thing: 'his water',
        said: 'at one',
        at: [13, 0],
        handover: 'Good afternoon, sir. Your water, from Kunle.',
      },
      ridePoint:
        "A no is an answer, not a dead end. Musa's car can't take the chair, so he says so, and the ride never quietly hangs.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: 'Ask Musa if he can take Baba to physiotherapy on Thursday.',
          expect: ['request_owner'],
          shot: 'tolu',
        },
        { kind: 'shot', shot: 'musa', ms: 1800 },
        {
          kind: 'line',
          who: 'musa',
          via: 'phone',
          text: "Sorry, I can't. My car can't take the wheelchair.",
          expect: ['respond_to_request'],
          shot: 'musa',
        },
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: "Then I'll take Baba to physiotherapy myself on Thursday.",
          expect: ['claim_obligation'],
          shot: 'tolu',
        },
      ],
    },
    ending:
      "Baba logged his own care by voice. Musa said no to a ride his car couldn't do, and the no moved the loop on instead of stalling it. A promise made on one phone was followed up when it slipped. And when nobody knew, it was said as a question. Kunle ordered his water from London: the doorbell saw it come, and only Musa's word said it reached him.",
  },
  hometown: {
    id: 'hometown',
    country: 'ng',
    label: 'Mummy',
    tagline: 'At home in Abeokuta. Her children work in Lagos. A simulated family.',
    simulated: true,
    lede: 'Mummy lives in Abeokuta, where she has always lived. Her son Tolu and daughter Funmi work in Lagos, two hours away. Bisi, her neighbour, looks in. The TV is the screen she already uses every day.',
    recipient: {
      name: 'Mummy',
      role: 'At home in Abeokuta, her children in Lagos',
      playAs:
        "You don't talk to the speaker much. You have the TV remote in your hand every evening.",
      model: 'character-female-c',
      voice: 'Danielle',
      fallbackPitch: 1.0,
    },
    toluRole: 'Her son, in Lagos, coordinating her care from two hours away',
    toluPlayAs: 'You hold it all together from Lagos, between meetings, two hours from her door.',
    helper: {
      name: 'Bisi',
      role: "Mummy's neighbour in Abeokuta",
      playAs: "You live next door. You're the one who is actually there.",
      model: 'character-female-a',
      voice: 'Joanna',
      fallbackPitch: 1.15,
    },
    places: { home: 'Abeokuta', tolu: 'Lagos' },
    away: {
      name: 'Kunle',
      role: 'Her son, in London',
      model: 'character-male-a',
      voice: 'Arthur',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Mummy',
      his: 'her',
      him: 'her',
      intro:
        "Mummy lives in Abeokuta. Her children work in Lagos. She doesn't talk to the speaker much, but she has the TV remote in her hand every day.",
      morningPoint:
        'The person cared for records her own care, on the screen she already uses. Her word, pressed, not spoken.',
      logMorning: 'Alexa, I took my blood pressure tablet.',
      morningSteps: [
        {
          kind: 'remote',
          who: 'daddy',
          keys: [...PRESS_YES],
          expect: 'log_care_event',
          shot: 'daddyTv',
          caption: "Mummy's TV asks about her 8 o'clock tablet. She answers with the OK button.",
        },
        {
          kind: 'caption',
          text: "In Lagos, two hours away, her children's record says the same thing at the same moment.",
          shot: 'both',
          ms: 3400,
        },
      ],
      refill: "Mummy's blood pressure tablets refill",
      ride: 'Mummy to her hospital check-up',
      evening: 'blood pressure tablet',
      use: { present: 'take', past: 'took' },
      handover: 'Good evening, Mummy. Your tablets.',
      order: {
        by: 'Kunle',
        city: 'London',
        intro:
          "In London, her son Kunle can't get to Abeokuta, but he can order Mummy's groceries to her door.",
        line: "Alexa, I've ordered Mummy's groceries from Mama Ronke's shop. They'll be there at one.",
        thing: 'her groceries',
        said: 'at one',
        at: [13, 0],
        handover: 'Good afternoon, Mummy. Your groceries, from Kunle.',
      },
      helper: { name: 'Bisi', they: 'she' },
      toluWhere: 'In Lagos, two hours away',
      askPoint:
        'One sentence in Lagos becomes a question on the phone of the one person who is in Abeokuta.',
      ridePoint:
        "Living in Lagos is not a reason to be left out. Tolu can't be there tonight, but he can be there on Thursday, and he says so.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: "I'll drive down and take Mummy to her hospital check-up on Thursday.",
          expect: ['claim_obligation'],
          shot: 'tolu',
        },
      ],
      ringCaption:
        "Ring sees someone at Mummy's door at 7:58, and the live view opens over her programme. Nobody from the family is in Abeokuta to see it. Ring can say a person. It can't say who.",
      afterDoor:
        "Mummy knows Bisi came. Her children, in Lagos, only know what the record knows: someone did. Bisi goes home, and never says it's done.",
      answerSteps: [
        {
          kind: 'remote',
          who: 'daddy',
          keys: [...PRESS_YES],
          expect: 'log_care_event',
          shot: 'daddyTv',
          caption: 'Mummy sees the same question on her TV, and answers it from her chair.',
        },
      ],
      answered:
        'One press on a remote in Abeokuta. The question cleared for her whole family at once, in Lagos too.',
    },
    ending:
      "Mummy logged her own care with the TV remote she already holds, twice. Her children, two hours away in Lagos, saw it the moment she pressed. Tolu took Thursday from Lagos; Bisi, next door, took tonight. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Kunle ordered her groceries from London, and Bisi's word, not the doorbell's, said they reached her.",
  },
  // An American family. Mom lives alone in Dayton, Ohio; her children are in three other
  // states, and the one fifteen minutes away ends up doing most of it. Simulated, labelled.
  us: {
    id: 'us',
    country: 'us',
    label: 'Mom',
    tagline:
      'Lives alone in Dayton, Ohio. Her kids are spread across three states. A simulated family.',
    simulated: true,
    lede: 'Mom lives alone in Dayton, Ohio. Sarah coordinates from Chicago, four hours away, between meetings. Mike lives fifteen minutes from Mom and ends up doing most of it. Jen is in Seattle, Tom in Phoenix. Mom watches TV every evening.',
    recipient: {
      name: 'Mom',
      role: 'Lives alone in Dayton, Ohio',
      playAs: "You don't talk to the speaker much. The TV remote is always in your hand.",
      model: 'character-female-d',
      voice: 'Kendra',
      fallbackPitch: 1.0,
    },
    toluRole: "Her daughter, in Chicago, coordinating Mom's care around a full-time job",
    toluPlayAs: 'You hold it together from Chicago, between meetings, four hours from her door.',
    tolu: { name: 'Sarah', model: 'character-female-b', voice: 'Joanna', fallbackPitch: 1.1 },
    helper: {
      name: 'Mike',
      role: 'Her son, fifteen minutes away',
      playAs: "You're the one who lives close. You're the one who always gets the call.",
      model: 'character-male-a',
      voice: 'Stephen',
      fallbackPitch: 1.0,
    },
    places: { home: 'Dayton, OH', tolu: 'Chicago, IL' },
    away: {
      name: 'Tom',
      role: 'Her son, in Phoenix',
      model: 'character-male-e',
      voice: 'Matthew',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Mom',
      his: 'her',
      him: 'her',
      intro:
        'Mom lives alone in Dayton, Ohio. Her kids are in Chicago, Seattle and Phoenix, and Mike fifteen minutes away. The TV is on most of the day.',
      morningPoint:
        'The person cared for records her own care, over the show she is already watching. Her word, pressed, not spoken.',
      logMorning: 'Alexa, I took my blood pressure pill.',
      morningSteps: [
        {
          kind: 'remote',
          who: 'daddy',
          keys: [...PRESS_YES],
          expect: 'log_care_event',
          shot: 'daddyTv',
          caption:
            "Mom's morning news is on. Her TV asks about her 8 o'clock pill over it, and she answers with the OK button.",
        },
        {
          kind: 'caption',
          text: 'In Chicago, Sarah\'s record says the same thing at the same moment. No call to check. No "Mom, did you take it?"',
          shot: 'both',
          ms: 3600,
        },
      ],
      refill: "Mom's blood pressure pill refill",
      ride: 'Mom to her cardiology follow-up',
      evening: 'blood pressure pill',
      use: { present: 'take', past: 'took' },
      handover: 'Hey Mom. Got your pills.',
      order: {
        by: 'Tom',
        city: 'Phoenix',
        intro: "In Phoenix, Tom can't bring Mom dinner, but he can order it.",
        line: "Alexa, I ordered Mom's dinner from Rosa's Kitchen. It'll be there at six.",
        thing: 'her dinner',
        said: 'at six',
        at: [18, 0],
        handover: "Hey Mom. Dinner's here, from Rosa's. Tom ordered it.",
      },
      helper: { name: 'Mike', they: 'he' },
      primary: { name: 'Sarah', self: 'herself' },
      toluWhere: 'In Chicago, four hours from Mom',
      askPoint:
        'Seven in ten family caregivers have a job. One sentence in Chicago becomes a question on the phone of the one person fifteen minutes from Mom.',
      ridePoint:
        "Living four hours away is not a reason to be left out. Sarah can't do tonight, but she can do Thursday, and she says so.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: "I'll drive down Wednesday night and take Mom to her cardiology follow-up on Thursday.",
          expect: ['claim_obligation'],
          shot: 'tolu',
        },
      ],
      ringCaption:
        "Ring sees someone at Mom's door at 7:58, and the live view opens over her game show. It can say a person. It can't say who.",
      afterDoor:
        "Mom knows it was Mike. Sarah, in Chicago, only knows what the record knows: someone came. Mike heads home, and never says it's done.",
      answerSteps: [
        {
          kind: 'remote',
          who: 'daddy',
          keys: [...PRESS_YES],
          expect: 'log_care_event',
          shot: 'daddyTv',
          caption: 'Mom sees the same question on her TV, and answers it without getting up.',
        },
      ],
      answered:
        'One press on a remote in Dayton. The question cleared for the whole family at once: Chicago, Seattle and Phoenix too.',
    },
    ending:
      "Mom logged her own care with the remote already in her hand. Sarah, four hours away, saw it the moment she pressed, and took Thursday from Chicago. Mike, fifteen minutes away, took tonight, and was asked, not assumed: three in four caregivers say they get no consistent help from family, and the one nearby is not the only name on the record. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Tom ordered her dinner from Phoenix: the doorbell saw it come, and only Mike's word said it reached her.",
  },
  // A child with Down syndrome in Columbus, Ohio. Her mom coordinates from work; Grandpa
  // Luis, ten minutes away, does most of the driving. Simulated, labelled.
  child: {
    id: 'child',
    country: 'us',
    label: 'Maya',
    tagline: 'Eight, with Down syndrome. Therapy, school, refills. A simulated family.',
    simulated: true,
    lede: 'Maya is eight and has Down syndrome. She has speech therapy every week, a morning medicine and a lot to say. Her mom Danielle works at a hospital across town. Grandpa Luis lives ten minutes away and does most of the driving. Her dad Marcus works shifts; Aunt Priya is in Austin.',
    recipient: {
      name: 'Maya',
      role: 'Eight, with Down syndrome, at home',
      playAs: 'You tell Alexa things yourself. You like being the one who says it.',
      model: 'character-female-b',
      voice: 'Ivy',
      fallbackPitch: 1.4,
      size: 0.72,
    },
    toluRole: 'Her mom, coordinating therapy, school and medicine around hospital shifts',
    toluPlayAs: 'You run it all from your phone at work, between patients.',
    tolu: { name: 'Danielle', model: 'character-female-a', voice: 'Danielle', fallbackPitch: 1.1 },
    helper: {
      name: 'Luis',
      role: 'Her grandpa, ten minutes away',
      playAs: "You're retired and close by. Rides are your job, when you say yes.",
      model: 'character-male-b',
      voice: 'Gregory',
      fallbackPitch: 0.85,
    },
    places: { home: 'Columbus, OH', tolu: 'At work, downtown' },
    away: {
      name: 'Aunt Priya',
      role: "Maya's aunt, in Austin",
      model: 'character-female-f',
      voice: 'Kendra',
      fallbackPitch: 1.1,
    },
    words: {
      who: 'Maya',
      his: 'her',
      him: 'her',
      intro:
        'Maya is eight and has Down syndrome. She talks to Alexa herself. Her mom is at work, her grandpa ten minutes away.',
      morningPoint:
        'A child with a disability is a participant too. Maya says it herself, and her mom sees it at work.',
      logMorning: 'Alexa, I took my morning medicine.',
      refill: "Maya's medicine refill",
      ride: 'Maya to speech therapy',
      evening: 'medicine',
      use: { present: 'take', past: 'took' },
      handover: 'Here you go, Maya. Your medicine.',
      order: {
        by: 'Aunt Priya',
        city: 'Austin',
        intro: "In Austin, Aunt Priya can't do the shopping in Columbus, but she can order it.",
        line: "Alexa, I ordered groceries for Maya's house from Lupe's Market. They'll be there at four.",
        thing: 'the groceries',
        said: 'at four',
        at: [16, 0],
        handover: 'Maya, look what Aunt Priya sent. Groceries!',
        thanks: 'Thank you, Grandpa!',
      },
      helper: { name: 'Luis', they: 'he' },
      primary: { name: 'Danielle', self: 'herself' },
      toluWhere: 'At the hospital, across town',
      askBreak: 'patients',
      askPoint:
        "One sentence between patients becomes a question on Grandpa's phone. Asked, never assigned.",
      ridePoint:
        "Nothing is Grandpa's job until he says yes. Danielle asks; Luis says yes, and everyone can see who has Thursday.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: 'Ask Luis if he can take Maya to speech therapy on Thursday.',
          expect: ['request_owner'],
          shot: 'tolu',
        },
        { kind: 'shot', shot: 'musa', ms: 1800 },
        {
          kind: 'line',
          who: 'musa',
          via: 'phone',
          text: "Yes, I'll take Maya to speech therapy on Thursday.",
          expect: ['respond_to_request'],
          shot: 'musa',
        },
      ],
    },
    ending:
      "Maya logged her own medicine by voice, and her mom saw it at work without a call. Grandpa was asked for Thursday, not assigned, and his yes is on the record for everyone. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Aunt Priya ordered the groceries from Austin, and only Grandpa's word said they reached the house.",
  },
  // A woman who uses a wheelchair and lives on her own in Philadelphia. Her brother checks
  // in from Boston; her friend Sam has a van that takes the chair. Simulated, labelled.
  independent: {
    id: 'independent',
    country: 'us',
    label: 'Erin',
    tagline: 'Uses a wheelchair, lives on her own. A simulated family.',
    simulated: true,
    lede: 'Erin uses a wheelchair and lives on her own in Philadelphia. She runs her own life; getting across town takes a van that carries the chair. Her brother Chris checks in from Boston. Her friend Sam lives nearby and has the van. Their mom Carol is in Tampa.',
    recipient: {
      name: 'Erin',
      role: 'Uses a wheelchair, lives on her own',
      playAs: 'Your life, your call. You ask for help when you want it.',
      model: 'character-female-e',
      voice: 'Ruth',
      fallbackPitch: 1.05,
      aid: 'wheelchair',
    },
    toluRole: 'Her brother, in Boston, who wants to help without hovering',
    toluPlayAs: 'You check in from Boston. Five hours away, and you still want to be useful.',
    tolu: { name: 'Chris', model: 'character-male-e', voice: 'Matthew', fallbackPitch: 1.0 },
    helper: {
      name: 'Sam',
      role: 'Her friend nearby, with a van that takes the chair',
      playAs: "You've got the van. You help when you can, and say so when you can't.",
      model: 'character-male-a',
      voice: 'Stephen',
      fallbackPitch: 1.0,
    },
    places: { home: 'Philadelphia, PA', tolu: 'Boston, MA' },
    away: {
      name: 'Carol',
      role: "Erin's mom, in Tampa",
      model: 'character-female-c',
      voice: 'Kendra',
      fallbackPitch: 1.1,
    },
    words: {
      who: 'Erin',
      his: 'her',
      him: 'her',
      intro:
        'Erin uses a wheelchair and lives on her own. She runs her own day, and she talks to Alexa.',
      morningPoint:
        "Independent, not monitored. Erin's record is hers: she logs her own care, and her brother sees it without asking.",
      logMorning: 'Alexa, I took my daily medication.',
      refill: "Erin's prescription refill",
      ride: 'Erin to her wheelchair seating appointment',
      evening: 'medication',
      use: { present: 'take', past: 'took' },
      handover: 'Hey Erin. Got your prescription.',
      order: {
        by: 'Carol',
        city: 'Tampa',
        intro:
          'Erin asked her mom to sort out the groceries this week. From Tampa, Carol orders them.',
        line: "Alexa, I ordered Erin's groceries from the market on her block. They'll be there at one.",
        thing: 'the groceries',
        said: 'at one',
        at: [13, 0],
        handover: 'Hey Erin. Groceries are here. Where do you want them?',
        thanks: 'On the counter. Thanks, Sam.',
      },
      helper: { name: 'Sam', they: 'he' },
      primary: { name: 'Chris', self: 'himself' },
      toluWhere: 'In Boston, five hours from Erin',
      askPoint:
        'Five hours away, Chris can still help: one sentence becomes a question on the phone of the friend with the van.',
      ridePoint:
        'The ride needs a van that takes the chair. Sam has one, is asked, and says yes, so nobody guesses who is driving.',
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: 'Ask Sam if he can drive Erin to her wheelchair seating appointment on Thursday.',
          expect: ['request_owner'],
          shot: 'tolu',
        },
        { kind: 'shot', shot: 'musa', ms: 1800 },
        {
          kind: 'line',
          who: 'musa',
          via: 'phone',
          text: "Yes. The van takes the chair. I'll drive her on Thursday.",
          expect: ['respond_to_request'],
          shot: 'musa',
        },
      ],
    },
    ending:
      "Erin logged her own care, on her own terms. Chris, in Boston, saw it without a call. Sam was asked for the ride, not assumed, and the van that takes the chair is on the record for Thursday. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Erin asked, and Carol ordered her groceries from Tampa: Sam carried them in, and his word, not the doorbell's, closed it.",
  },
  // Mummy in Ibadan; her children went abroad. Tolu coordinates from London, where in October
  // the clock reads the same as hers. Segun, her nephew, is the only family nearby.
  abroad: {
    id: 'abroad',
    country: 'ng',
    label: 'Mummy abroad',
    tagline: 'In Ibadan. Her children are in London, Toronto and Houston. A simulated family.',
    simulated: true,
    lede: 'Mummy lives in Ibadan. Her children left: Tolu is in London, Funmi in Toronto, Kunle in Houston. Segun, her nephew, lives ten minutes away. Everyone wants to help; only one of them can knock on her door.',
    recipient: {
      name: 'Mummy',
      role: 'At home in Ibadan, her children abroad',
      playAs: 'Your children call every Sunday. The rest of the week, you tell Alexa.',
      model: 'character-female-f',
      voice: 'Danielle',
      fallbackPitch: 1.0,
    },
    toluRole: 'Her son, in London, coordinating her care from five thousand kilometres away',
    toluPlayAs:
      "You hold it together from London, on the Tube and between meetings. You can ask; you can't drive over.",
    tolu: { name: 'Tolu', model: 'character-male-b', voice: 'Brian', fallbackPitch: 1.0 },
    helper: {
      name: 'Segun',
      role: "Mummy's nephew, ten minutes away in Ibadan",
      playAs: "You're the family member who stayed. Every errand finds its way to you.",
      model: 'character-male-c',
      voice: 'Joey',
      fallbackPitch: 1.0,
    },
    places: { home: 'Ibadan', tolu: 'London' },
    away: {
      name: 'Kunle',
      role: 'Her son, in Houston',
      model: 'character-male-a',
      voice: 'Matthew',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Mummy',
      his: 'her',
      him: 'her',
      intro:
        'Mummy lives in Ibadan. Her children are in London, Toronto and Houston. She talks to Alexa, and they read the record.',
      morningPoint:
        "Distance doesn't make her a monitored subject. She records her own care, and three countries see it.",
      logMorning: 'Alexa, I took my blood pressure tablet.',
      refill: "Mummy's blood pressure tablets refill",
      ride: 'Mummy to her hospital check-up',
      evening: 'blood pressure tablet',
      use: { present: 'take', past: 'took' },
      handover: 'Good evening, Mummy. Your tablets.',
      order: {
        by: 'Kunle',
        city: 'Houston',
        intro:
          "In Houston it isn't seven yet. Kunle can't bring Mummy lunch, but he can order it before work.",
        line: "Alexa, I've ordered Mummy's lunch from Iya Sade's kitchen. It'll be there at one.",
        thing: 'her lunch',
        said: 'at one',
        at: [13, 0],
        handover: "Good afternoon, Mummy. Your lunch, from Iya Sade's.",
      },
      helper: { name: 'Segun', they: 'he' },
      toluWhere: 'In London, five thousand kilometres away',
      askPoint:
        'From London, all Tolu can do is ask. One sentence becomes a question on the phone of the one person in Ibadan.',
      ridePoint:
        "Wanting to help from abroad is not the same as being able to. Tolu can't take Thursday, so he asks, and the record only names Segun once Segun says yes.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: 'Ask Segun if he can take Mummy to her hospital check-up on Thursday.',
          expect: ['request_owner'],
          shot: 'tolu',
        },
        { kind: 'shot', shot: 'musa', ms: 1800 },
        {
          kind: 'line',
          who: 'musa',
          via: 'phone',
          text: "Yes, I'll take her.",
          expect: ['respond_to_request'],
          shot: 'musa',
        },
      ],
      ringCaption:
        "Ring sees someone at Mummy's door at 7:58, and the live view opens on her TV. Her children are asleep or at work in three time zones. Ring can say a person. It can't say who.",
      afterDoor:
        "Mummy knows Segun came. London, Toronto and Houston only know what the record knows: someone did. Segun goes home, and never says it's done.",
      answered:
        'One sentence in Ibadan. The question cleared for her whole family at once, in three countries.',
    },
    ending:
      "Mummy logged her own care by voice, and her children abroad saw it without a call. Tolu couldn't take Thursday from London, so he asked, and Segun said yes: nobody was assumed just because they live nearby. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Kunle ordered her lunch from Houston before work, and only Segun's word said it reached her.",
  },
  // A Kenyan family. Mum is at home in Nyeri; Wanjiru coordinates from Nairobi, a few hours'
  // drive; Mwangi works in Dubai. Njeri, the neighbour, is the one who is there. Simulated.
  ke: {
    id: 'ke',
    country: 'ke',
    label: 'Mum',
    tagline: 'At home in Nyeri, managing diabetes. Her daughter is in Nairobi. A simulated family.',
    simulated: true,
    lede: "Mum lives in Nyeri and manages her diabetes herself. Wanjiru coordinates from Nairobi, a few hours' drive away, between meetings. Mwangi works in Dubai. Njeri, next door, is the one who is there.",
    recipient: {
      name: 'Mum',
      role: 'At home in Nyeri, managing diabetes',
      playAs:
        "You have managed your sugar for years. You just tell Alexa when you've taken your tablet.",
      model: 'character-female-e',
      voice: 'Ayanda',
      fallbackPitch: 1.0,
    },
    toluRole: "Her daughter, in Nairobi, coordinating Mum's care around a full-time job",
    toluPlayAs: 'You hold it together from Nairobi, between meetings, a few hours up the road.',
    tolu: { name: 'Wanjiru', model: 'character-female-b', voice: 'Joanna', fallbackPitch: 1.1 },
    helper: {
      name: 'Njeri',
      role: "Mum's neighbour in Nyeri",
      playAs: "You live next door. You're the one who is actually there.",
      model: 'character-female-a',
      voice: 'Salli',
      fallbackPitch: 1.15,
    },
    places: { home: 'Nyeri', tolu: 'Nairobi' },
    away: {
      name: 'Mwangi',
      role: 'Her son, in Dubai',
      model: 'character-male-a',
      voice: 'Gregory',
      fallbackPitch: 0.95,
    },
    words: {
      who: 'Mum',
      his: 'her',
      him: 'her',
      intro:
        'Mum lives in Nyeri and manages her diabetes. Her daughter is in Nairobi, her son in Dubai. She tells Alexa.',
      morningPoint:
        'The person cared for records her own care. She has managed this for years; the record just lets her family stop asking.',
      logMorning: 'Alexa, I took my diabetes tablet.',
      refill: "Mum's diabetes tablets refill",
      ride: 'Mum to her diabetes clinic visit',
      evening: 'diabetes tablet',
      use: { present: 'take', past: 'took' },
      handover: 'Habari ya jioni, Mum. Your tablets.',
      order: {
        by: 'Mwangi',
        city: 'Dubai',
        intro: "In Dubai, Mwangi can't make sure Mum has lunch, but he can order it.",
        line: "Alexa, I've ordered Mum's lunch from Mama Muthoni's kitchen. It'll be there at one.",
        thing: 'her lunch',
        said: 'at one',
        at: [13, 0],
        handover: "Mum, your lunch is here, from Mama Muthoni's.",
      },
      helper: { name: 'Njeri', they: 'she' },
      primary: { name: 'Wanjiru', self: 'herself' },
      toluWhere: "In Nairobi, a few hours' drive away",
      askPoint:
        'One sentence in Nairobi becomes a question on the phone of the one person in Nyeri.',
      ridePoint:
        "Living in Nairobi is not a reason to be left out. Wanjiru can't do tonight, but she can do Thursday, and she says so.",
      rideSteps: [
        {
          kind: 'line',
          who: 'tolu',
          via: 'echo',
          text: "I'll drive up and take Mum to her diabetes clinic visit on Thursday.",
          expect: ['claim_obligation'],
          shot: 'tolu',
        },
      ],
      ringCaption:
        "Ring sees someone at Mum's door at 7:58, and the live view opens on her TV. Nobody from the family is in Nyeri to see it. Ring can say a person. It can't say who.",
      afterDoor:
        "Mum knows Njeri came. Wanjiru, in Nairobi, only knows what the record knows: someone did. Njeri goes home, and never says it's done.",
      answered:
        'One sentence in Nyeri. The question cleared for the whole family at once: Nairobi and Dubai too.',
    },
    ending:
      "Mum logged her own care by voice. Wanjiru, in Nairobi, saw it without a call, and took Thursday herself. Njeri, next door, took tonight, and was asked, not assumed. A doorbell said someone came without claiming to know who, and the agent followed up when the promise slipped. Mwangi ordered her lunch from Dubai, and only Njeri's word said it reached her.",
  },
};

let current: CareCaseId = 'eyes';
let names: FamilyNames | null = null;

/**
 * "Make it yours": what the visitor's own family is called, over one of the families. The
 * family still decides the need, the country and the wording; only names change. They go
 * to the visitor's throwaway copy on the server (src/demo/cases.ts) and nowhere else.
 */
export interface FamilyNames {
  recipient: string;
  primary: string;
  caregiver: string;
  away: string;
  helper: string;
}

/** The names each family already goes by, matching the server's caseNames(). */
export const BASE_NAMES: Record<CareCaseId, FamilyNames> = {
  eyes: { recipient: 'Daddy', primary: 'Tolu', caregiver: 'Funmi', away: 'Kunle', helper: 'Musa' },
  memory: { recipient: 'Mama', primary: 'Tolu', caregiver: 'Funmi', away: 'Kunle', helper: 'Musa' },
  wheelchair: {
    recipient: 'Baba',
    primary: 'Tolu',
    caregiver: 'Funmi',
    away: 'Kunle',
    helper: 'Musa',
  },
  hometown: {
    recipient: 'Mummy',
    primary: 'Tolu',
    caregiver: 'Funmi',
    away: 'Kunle',
    helper: 'Bisi',
  },
  us: { recipient: 'Mom', primary: 'Sarah', caregiver: 'Jen', away: 'Tom', helper: 'Mike' },
  abroad: {
    recipient: 'Mummy',
    primary: 'Tolu',
    caregiver: 'Funmi',
    away: 'Kunle',
    helper: 'Segun',
  },
  ke: { recipient: 'Mum', primary: 'Wanjiru', caregiver: 'Kamau', away: 'Mwangi', helper: 'Njeri' },
  child: {
    recipient: 'Maya',
    primary: 'Danielle',
    caregiver: 'Marcus',
    away: 'Aunt Priya',
    helper: 'Luis',
  },
  independent: {
    recipient: 'Erin',
    primary: 'Chris',
    caregiver: 'Nadia',
    away: 'Carol',
    helper: 'Sam',
  },
};

const NAME = /^\p{L}[\p{L}' -]{0,22}\p{L}$|^\p{L}$/u;
const KEYS = ['recipient', 'primary', 'caregiver', 'away', 'helper'] as const;

/** Why these names can't be used, or null when they can. The server checks the same. */
export function namesProblem(n: FamilyNames): string | null {
  for (const k of KEYS)
    if (!NAME.test(n[k].trim()))
      return n[k].trim()
        ? `"${n[k].trim()}" isn't a name we can use: letters only, up to 24.`
        : 'Every person needs a name.';
  if (new Set(KEYS.map((k) => n[k].trim().toLowerCase())).size < KEYS.length)
    return 'Give each person a different name.';
  return null;
}

/** Whole words, all at once, so a helper the visitor calls "Tolu" is never renamed twice. */
function renameAll<T>(value: T, from: FamilyNames, to: FamilyNames): T {
  const map = new Map(KEYS.map((k) => [from[k], to[k]]));
  const re = new RegExp(
    `(?<![\\p{L}])(${[...map.keys()].sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])`,
    'gu',
  );
  const walk = (x: unknown): unknown =>
    typeof x === 'string'
      ? x.replace(re, (w) => map.get(w) ?? w)
      : Array.isArray(x)
        ? x.map(walk)
        : x && typeof x === 'object'
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
          : x;
  return walk(value) as T;
}

/**
 * The story's "Thursday" is the check-up two days from whenever it is played, and its
 * "Wednesday" the night before, called by their real names as the server records them.
 */
function onTheDays<T>(value: T): T {
  const day = (ahead: number) =>
    weekdayName(new Date(homeToday(12, 0).getTime() + ahead * 86_400_000));
  const map = new Map([
    ['Wednesday', day(1)],
    ['Thursday', day(2)],
  ]);
  const walk = (x: unknown): unknown =>
    typeof x === 'string'
      ? x.replace(/Wednesday|Thursday/g, (w) => map.get(w) ?? w)
      : Array.isArray(x)
        ? x.map(walk)
        : x && typeof x === 'object'
          ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
          : x;
  return walk(value) as T;
}

/** The family being played, in the visitor's own names when they gave them. */
export function family(): Family {
  return onTheDays(
    names ? renameAll(FAMILIES[current], BASE_NAMES[current], names) : FAMILIES[current],
  );
}

/** The visitor's own names, or null when they are playing the family as it is. */
export function familyNames(): FamilyNames | null {
  return names;
}

/**
 * Make this the family the world plays. The people keep their keys - "daddy" is always the
 * person cared for - so the cast and the day are rewritten in place.
 */
export function setFamily(id: CareCaseId, own: FamilyNames | null = null): void {
  current = id;
  names = own
    ? (Object.fromEntries(KEYS.map((k) => [k, own[k].trim()])) as unknown as FamilyNames)
    : null;
  const f = family();
  const mine = <T>(x: T): T => (names ? renameAll(x, BASE_NAMES[id], names) : x);
  // Start from the real recipient each time, so an aid never carries over from another family.
  CAST.daddy = mine({ ...EYES_RECIPIENT, aid: undefined, size: undefined, ...f.recipient });
  CAST.tolu = mine({ ...TOLU, ...f.tolu, role: f.toluRole, playAs: f.toluPlayAs ?? TOLU.playAs });
  CAST.musa = mine({ ...MUSA, ...f.helper });
  // From the family as written, so the visitor's names go on once.
  CAST.kunle = mine({ ...KUNLE, ...FAMILIES[id].away });
  setHomeZone(COUNTRIES[f.country].zone);
  STORY.splice(0, STORY.length, ...onTheDays(mine(storyFor(f.words))));
}

// The family played when nobody picks one still has its days named for today: the story
// it starts with said "Thursday" for a check-up the record had on another day.
setFamily(current);
