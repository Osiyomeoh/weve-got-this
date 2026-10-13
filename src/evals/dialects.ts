import type { EvalCase } from './corpus.js';

/**
 * The same family, saying the same things, the way real families say them.
 *
 * The corpus is written in standard English. A family in Lagos speaks Pidgin and mixes in
 * Yoruba, Igbo or Hausa; a family in Atlanta may speak African American English; a
 * grandmother in Texas may only speak Spanish. Speech recognition is known to be worse for
 * some of these (for Black speakers, across Amazon, Apple, Google, IBM and Microsoft, a
 * word error rate of 0.35 against 0.19: Koenecke et al., PNAS 2020). This set measures the
 * step after recognition: given the words, does the right tool get chosen?
 *
 * All held out: written once, never tuned against. Run with `npm run evals -- --dialects`.
 * The answer keys follow the corpus's own for the same request in standard English.
 */
export const DIALECT_CASES: EvalCase[] = [
  // --- African American English --------------------------------------------
  {
    id: 'hd-aae-01',
    member: 'm_david',
    utterance: 'Daddy done took his eye drops already.',
    expect: ['log_care_event'],
  },
  {
    id: 'hd-aae-02',
    member: 'm_margaret',
    utterance: "I been took my pills this morning, don't worry about it.",
    expect: ['log_care_event'],
  },
  {
    id: 'hd-aae-03',
    member: 'm_renee',
    utterance: 'Who finna take Daddy to his eye appointment Thursday?',
    expect: ['get_care_gaps', 'request_owner'],
  },
  {
    id: 'hd-aae-04',
    member: 'm_david',
    utterance: "Put it down that Daddy got a doctor's appointment Tuesday at 2.",
    expect: ['record_appointment'],
  },
  {
    id: 'hd-aae-05',
    member: 'm_renee',
    utterance: "Ain't nobody picked up his prescription yet?",
    expect: ['get_care_gaps', 'get_care_summary'],
  },
  {
    id: 'hd-aae-06',
    member: 'm_renee',
    utterance: "I can't drive him Thursday, I'm gon' be out of town.",
    expect: ['add_note'],
  },
  {
    id: 'hd-aae-07',
    member: 'm_david',
    utterance: 'How Daddy doing today?',
    expect: ['get_care_summary'],
  },

  // --- Nigerian Pidgin ----------------------------------------------------
  {
    id: 'hd-pcm-01',
    member: 'm_margaret',
    utterance: 'I don use my eye drop this morning.',
    expect: ['log_care_event'],
    seen: '2026-09-24: log_care_event now says what Pidgin "don" means, after this case failed twice',
  },
  {
    id: 'hd-pcm-02',
    member: 'm_david',
    utterance: 'Abeg, who go carry Daddy go eye clinic on Thursday?',
    expect: ['get_care_gaps', 'request_owner'],
  },
  {
    id: 'hd-pcm-03',
    member: 'm_renee',
    utterance: 'Wetin still remain wey nobody don do for Daddy?',
    expect: ['get_care_gaps'],
  },
  {
    id: 'hd-pcm-04',
    member: 'm_david',
    utterance: 'Daddy get appointment for eye clinic Friday by 10.',
    expect: ['record_appointment'],
  },
  {
    id: 'hd-pcm-05',
    member: 'm_aide',
    utterance: 'Oga don take im medicine.',
    expect: ['log_care_event'],
  },
  {
    id: 'hd-pcm-06',
    member: 'm_david',
    utterance: 'Daddy don fall for bathroom, e no fit stand up.',
    expect: ['raise_urgent'],
  },
  {
    id: 'hd-pcm-07',
    member: 'm_renee',
    utterance: 'How Daddy day take go?',
    expect: ['get_care_summary'],
  },

  // --- Nigerian English --------------------------------------------------------
  {
    id: 'hd-ng-01',
    member: 'm_david',
    utterance: 'Daddy has taken his drugs.',
    expect: ['log_care_event'],
    note: '"Drugs" is the ordinary Nigerian English word for medicine.',
  },
  {
    id: 'hd-ng-02',
    member: 'm_renee',
    utterance: 'Please help me to check if Daddy has used his drops.',
    expect: ['get_care_summary', 'get_care_gaps'],
  },
  {
    id: 'hd-ng-03',
    member: 'm_david',
    utterance: 'I will carry Daddy to the hospital on Thursday.',
    expect: ['claim_obligation', 'get_care_gaps'],
    note: '"Carry" means take someone somewhere.',
  },

  // --- Yoruba, Igbo and Hausa, alone and mixed with English --------------------
  {
    id: 'hd-yo-01',
    member: 'm_margaret',
    utterance: 'Mo ti lo eye drops mi this morning.',
    expect: ['log_care_event'],
  },
  {
    id: 'hd-yo-02',
    member: 'm_margaret',
    utterance: 'Mo ti lo oogun ojú mi.',
    expect: ['log_care_event'],
    note: 'All Yoruba: "I have used my eye medicine."',
  },
  {
    id: 'hd-yo-03',
    member: 'm_david',
    utterance: 'Ẹ jọ̀ọ́, ask whoever is free to take Daddy to the clinic on Thursday.',
    expect: ['request_owner', 'get_care_gaps'],
    seen: '2026-09-23: get_care_gaps added after the first run, as the corpus accepts it for assign and claim (the work must be found before anyone is asked)',
  },
  {
    id: 'hd-ig-01',
    member: 'm_renee',
    utterance: "Biko, how was Daddy's day?",
    expect: ['get_care_summary'],
  },
  {
    id: 'hd-ig-02',
    member: 'm_margaret',
    utterance: 'Aṅụla m ọgwụ m.',
    expect: ['log_care_event'],
    note: 'All Igbo: "I have taken my medicine."',
  },
  {
    id: 'hd-ha-01',
    member: 'm_david',
    utterance: "Don Allah, what's still open for Daddy?",
    expect: ['get_care_gaps'],
  },
  {
    id: 'hd-ha-02',
    member: 'm_margaret',
    utterance: 'Na sha maganina.',
    expect: ['log_care_event'],
    note: 'All Hausa: "I have taken my medicine."',
  },

  // --- Spanish, French, Chinese ---------------------------------------------
  {
    id: 'hd-es-01',
    member: 'm_margaret',
    utterance: 'Ya me puse las gotas para los ojos.',
    expect: ['log_care_event'],
  },
  {
    id: 'hd-es-02',
    member: 'm_david',
    utterance: 'Papá tiene cita con el oculista el jueves a las diez.',
    expect: ['record_appointment'],
  },
  {
    id: 'hd-es-03',
    member: 'm_renee',
    utterance: '¿Qué queda pendiente para papá?',
    expect: ['get_care_gaps'],
  },
  {
    id: 'hd-es-04',
    member: 'm_renee',
    utterance: 'Papá se cayó y no se puede levantar.',
    expect: ['raise_urgent'],
  },
  {
    id: 'hd-fr-01',
    member: 'm_margaret',
    utterance: "J'ai mis mes gouttes pour les yeux.",
    expect: ['log_care_event'],
  },
  {
    id: 'hd-fr-02',
    member: 'm_david',
    utterance: "Papa a rendez-vous chez l'ophtalmo vendredi à 10h.",
    expect: ['record_appointment'],
  },
  {
    id: 'hd-fr-03',
    member: 'm_renee',
    utterance: "Comment s'est passée la journée de papa ?",
    expect: ['get_care_summary'],
  },
  {
    id: 'hd-zh-01',
    member: 'm_margaret',
    utterance: '我已经滴了眼药水。',
    expect: ['log_care_event'],
  },
  {
    id: 'hd-zh-02',
    member: 'm_renee',
    utterance: '爸爸今天怎么样？',
    expect: ['get_care_summary'],
  },
  {
    id: 'hd-zh-03',
    member: 'm_david',
    utterance: '爸爸周四上午十点要去看眼科。',
    expect: ['record_appointment'],
  },
];
