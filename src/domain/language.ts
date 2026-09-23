import type { LanguageCode, Member } from './types.js';

/**
 * The language a person is written to in.
 *
 * Why these: the families this is for, and where Alexa+ is sold. Nigerian families speak
 * English, Pidgin, Yoruba, Igbo, Hausa and Edo, often in one sentence. In the US, 5.6M
 * people over 65 speak English less than very well, 2.9M of them Spanish speakers (ACS
 * 2024, B16004): the parent in one language, the grown children in another. Alexa+ is
 * launching in Spanish, French, Portuguese, German, Italian and Hindi. The sources are in
 * docs/LANGUAGES.md.
 *
 * What is honest to promise differs by language, so each one says what it can do:
 *
 *  - `ready`: the reminders below are written, and Amazon Transcribe and Polly both
 *    hear and speak it, so voice notes work both ways.
 *  - `draft`: the reminders are written but not yet checked by a native speaker, so the
 *    English goes underneath every one. No AWS service hears or speaks Yoruba, Igbo or
 *    Edo, and Hausa only as a slow batch job; so voice notes are heard in English (or
 *    Pidgin), and answers come back as text.
 *  - `understood`: words in it are understood when mixed into English, and replies are in
 *    English. Edo is here: no speech service and no machine translation covers it, and a
 *    model's written Edo is not good enough to send about someone's medicine. The phrase
 *    slots are ready for a speaker to fill in.
 *
 * A medicine's name, a person's name and an appointment's kind are never translated:
 * they are facts, written the way the family wrote them.
 */

export type LanguageStatus = 'ready' | 'draft' | 'understood';

export interface Language {
  code: LanguageCode;
  /** In English, for the family and for the model. */
  name: string;
  /** In itself, for the button a person taps. */
  native: string;
  status: LanguageStatus;
  /** Locale for dates and times (CLDR has all of these but Edo). */
  locale: string;
  /** Amazon Transcribe streaming code for voice notes. Null when it cannot hear it. */
  hears: string | null;
  /** Amazon Polly voice that speaks it. Null when none can, and answers stay written. */
  voice: string | null;
}

export const LANGUAGES: Record<LanguageCode, Language> = {
  en: { code: 'en', name: 'English', native: 'English', status: 'ready', locale: 'en-US', hears: 'en-US', voice: 'Ruth' },
  es: { code: 'es', name: 'Spanish', native: 'Español', status: 'ready', locale: 'es-US', hears: 'es-US', voice: 'Lupe' },
  fr: { code: 'fr', name: 'French', native: 'Français', status: 'ready', locale: 'fr', hears: 'fr-FR', voice: 'Lea' },
  pt: { code: 'pt', name: 'Portuguese (Brazil)', native: 'Português', status: 'ready', locale: 'pt-BR', hears: 'pt-BR', voice: 'Camila' },
  de: { code: 'de', name: 'German', native: 'Deutsch', status: 'ready', locale: 'de-DE', hears: 'de-DE', voice: 'Vicki' },
  it: { code: 'it', name: 'Italian', native: 'Italiano', status: 'ready', locale: 'it-IT', hears: 'it-IT', voice: 'Bianca' },
  hi: { code: 'hi', name: 'Hindi', native: 'हिन्दी', status: 'ready', locale: 'hi-IN', hears: 'hi-IN', voice: 'Kajal' },
  zh: { code: 'zh', name: 'Chinese (Mandarin, simplified characters)', native: '中文', status: 'ready', locale: 'zh-CN', hears: 'zh-CN', voice: 'Zhiyu' },
  // Pidgin is English-lexified: English recognition follows it well enough to show back
  // ("I heard: ...") for the speaker to correct, and an English voice reads it clearly.
  pcm: { code: 'pcm', name: 'Nigerian Pidgin', native: 'Naijá (Pidgin)', status: 'draft', locale: 'pcm', hears: 'en-US', voice: 'Ruth' },
  yo: { code: 'yo', name: 'Yoruba', native: 'Yorùbá', status: 'draft', locale: 'yo', hears: null, voice: null },
  ig: { code: 'ig', name: 'Igbo', native: 'Igbo', status: 'draft', locale: 'ig', hears: null, voice: null },
  ha: { code: 'ha', name: 'Hausa', native: 'Hausa', status: 'draft', locale: 'ha', hears: null, voice: null },
  bin: { code: 'bin', name: 'Edo (Bini)', native: 'Ẹ̀dó', status: 'understood', locale: 'en-NG', hears: null, voice: null },
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && value in LANGUAGES;
}

export function languageOf(member: Pick<Member, 'language'> | undefined | null): Language {
  return LANGUAGES[member?.language ?? 'en'];
}

/** The fixed messages sent without the model: reminders, and the answers to a tap. */
export type PhraseKey =
  | 'dose' | 'taken' | 'snooze' | 'recorded' | 'alreadyYou' | 'alreadyBy' | 'snoozed' | 'repeat'
  | 'appt' | 'apptWithOne' | 'apptWithMany' | 'apptHolder' | 'apptUnowned' | 'heard' | 'languageSet';

type Phrasebook = Record<PhraseKey, string>;

const EN: Phrasebook = {
  dose: "It's {time}: time for your {med}.",
  taken: '✅ Taken',
  snooze: '⏰ In 15 minutes',
  recorded: '✅ Recorded: {med} at {time}.',
  alreadyYou: "There's already a record of this {med} dose, at {time}, from you. I haven't added another.",
  alreadyBy: "There's already a record of this {med} dose, at {time}, from {by}. I haven't added another.",
  snoozed: "⏰ I'll remind you about the {med} again at {time}.",
  repeat: 'Reminder: your {med}.',
  appt: 'Reminder: {when}, your {kind}.',
  apptWithOne: ' {names} is taking care of {it}.',
  apptWithMany: ' {names} are taking care of {it}.',
  apptHolder: "Reminder: {when}, {them}'s {kind}. You have: {tasks}.",
  apptUnowned: `{them}'s {kind} is {when}, and nobody has taken this on yet: {tasks}. Say "ask whoever's free" and I'll ask someone.`,
  heard: 'I heard: "{text}"',
  languageSet: "Done: I'll write to you in English.",
};

const BOOKS: Partial<Record<LanguageCode, Partial<Phrasebook>>> = {
  es: {
    dose: '{time}: es hora de su {med}.',
    taken: '✅ Ya lo tomé',
    snooze: '⏰ En 15 minutos',
    recorded: '✅ Anotado: {med}, {time}.',
    alreadyYou: 'Ya hay un registro de esta dosis de {med} ({time}), anotado por usted. No añadí otro.',
    alreadyBy: 'Ya hay un registro de esta dosis de {med} ({time}), anotado por {by}. No añadí otro.',
    snoozed: '⏰ Le recordaré su {med} de nuevo: {time}.',
    repeat: 'Recordatorio: su {med}.',
    appt: 'Recordatorio: {when}, su cita: {kind}.',
    apptWithOne: ' {names} se encarga.',
    apptWithMany: ' {names} se encargan.',
    apptHolder: 'Recordatorio: {when}, cita de {them}: {kind}. Usted tiene: {tasks}.',
    apptUnowned: 'La cita de {them} ({kind}) es {when}, y nadie se ha encargado todavía de: {tasks}. Diga "pregúntale a quien esté libre" y le pregunto a alguien.',
    heard: 'Escuché: "{text}"',
    languageSet: 'Listo: le escribiré en español.',
  },
  fr: {
    dose: "{time} : c'est l'heure de votre {med}.",
    taken: "✅ C'est pris",
    snooze: '⏰ Dans 15 minutes',
    recorded: '✅ Noté : {med}, {time}.',
    alreadyYou: "Cette prise de {med} est déjà notée ({time}), par vous. Je n'en ai pas ajouté une autre.",
    alreadyBy: "Cette prise de {med} est déjà notée ({time}), par {by}. Je n'en ai pas ajouté une autre.",
    snoozed: '⏰ Je vous rappellerai votre {med} à {time}.',
    repeat: 'Rappel : votre {med}.',
    appt: 'Rappel : {when}, votre rendez-vous : {kind}.',
    apptWithOne: " {names} s'en occupe.",
    apptWithMany: " {names} s'en occupent.",
    apptHolder: 'Rappel : {when}, rendez-vous de {them} : {kind}. Vous avez : {tasks}.',
    apptUnowned: `Le rendez-vous de {them} ({kind}) est {when}, et personne ne s'en est encore chargé : {tasks}. Dites « demande à quelqu'un de libre » et je demanderai.`,
    heard: "J'ai entendu : « {text} »",
    languageSet: "C'est noté : je vous écrirai en français.",
  },
  pt: {
    dose: '{time}: hora do remédio: {med}.',
    taken: '✅ Já usei',
    snooze: '⏰ Daqui a 15 minutos',
    recorded: '✅ Anotado: {med}, {time}.',
    alreadyYou: 'Esta dose de {med} já está registrada ({time}), por você. Não adicionei outra.',
    alreadyBy: 'Esta dose de {med} já está registrada ({time}), por {by}. Não adicionei outra.',
    snoozed: '⏰ Vou lembrar você de novo ({time}): {med}.',
    repeat: 'Lembrete: {med}.',
    appt: 'Lembrete: {when}, sua consulta: {kind}.',
    apptWithOne: ' {names} vai cuidar disso.',
    apptWithMany: ' {names} vão cuidar disso.',
    apptHolder: 'Lembrete: {when}, consulta de {them}: {kind}. Com você: {tasks}.',
    apptUnowned: 'A consulta de {them} ({kind}) é {when}, e ninguém assumiu ainda: {tasks}. Diga "pergunte a quem estiver livre" e eu pergunto a alguém.',
    heard: 'Eu ouvi: "{text}"',
    languageSet: 'Pronto: vou escrever para você em português.',
  },
  de: {
    dose: '{time}: Zeit für {med}.',
    taken: '✅ Erledigt',
    snooze: '⏰ In 15 Minuten',
    recorded: '✅ Notiert: {med}, {time}.',
    alreadyYou: 'Diese Dosis {med} ist schon eingetragen ({time}), von Ihnen. Ich habe keine zweite hinzugefügt.',
    alreadyBy: 'Diese Dosis {med} ist schon eingetragen ({time}), von {by}. Ich habe keine zweite hinzugefügt.',
    snoozed: '⏰ Ich erinnere Sie um {time} noch einmal: {med}.',
    repeat: 'Erinnerung: {med}.',
    appt: 'Erinnerung: {when}, Ihr Termin: {kind}.',
    apptWithOne: ' {names} kümmert sich darum.',
    apptWithMany: ' {names} kümmern sich darum.',
    apptHolder: 'Erinnerung: {when}, Termin von {them}: {kind}. Ihre Aufgabe: {tasks}.',
    apptUnowned: 'Der Termin von {them} ({kind}) ist {when}, und niemand hat das bisher übernommen: {tasks}. Sagen Sie „frag, wer Zeit hat“, dann frage ich jemanden.',
    heard: 'Ich habe verstanden: „{text}“',
    languageSet: 'Alles klar: Ich schreibe Ihnen ab jetzt auf Deutsch.',
  },
  it: {
    dose: "{time}: è l'ora di {med}.",
    taken: '✅ Fatto',
    snooze: '⏰ Tra 15 minuti',
    recorded: '✅ Annotato: {med}, {time}.',
    alreadyYou: "Questa dose di {med} è già registrata ({time}), da Lei. Non ne ho aggiunta un'altra.",
    alreadyBy: "Questa dose di {med} è già registrata ({time}), da {by}. Non ne ho aggiunta un'altra.",
    snoozed: '⏰ Glielo ricorderò di nuovo alle {time}: {med}.',
    repeat: 'Promemoria: {med}.',
    appt: 'Promemoria: {when}, il Suo appuntamento: {kind}.',
    apptWithOne: ' Se ne occupa {names}.',
    apptWithMany: ' Se ne occupano {names}.',
    apptHolder: 'Promemoria: {when}, appuntamento di {them}: {kind}. A Lei: {tasks}.',
    apptUnowned: "L'appuntamento di {them} ({kind}) è {when}, e nessuno se ne è ancora occupato: {tasks}. Dica «chiedi a chi è libero» e chiederò a qualcuno.",
    heard: 'Ho sentito: «{text}»',
    languageSet: "Fatto: d'ora in poi Le scriverò in italiano.",
  },
  hi: {
    dose: '{time}: {med} का समय हो गया है।',
    taken: '✅ ले लिया',
    snooze: '⏰ 15 मिनट बाद',
    recorded: '✅ दर्ज किया: {med}, {time}।',
    alreadyYou: '{med} की यह खुराक पहले से दर्ज है ({time}, आपके द्वारा)। दोबारा नहीं जोड़ी गई।',
    alreadyBy: '{med} की यह खुराक पहले से दर्ज है ({time}, {by} द्वारा)। दोबारा नहीं जोड़ी गई।',
    snoozed: '⏰ {time} पर फिर याद दिलाया जाएगा: {med}।',
    repeat: 'रिमाइंडर: {med}।',
    appt: 'रिमाइंडर: {when}, आपकी अपॉइंटमेंट: {kind}।',
    apptWithOne: ' {names} इसे संभालेंगे।',
    apptWithMany: ' {names} इसे संभालेंगे।',
    apptHolder: 'रिमाइंडर: {when}, {them} की अपॉइंटमेंट: {kind}। आपके ज़िम्मे: {tasks}।',
    apptUnowned: '{them} की अपॉइंटमेंट ({kind}) {when} है, और अभी तक किसी ने यह नहीं लिया: {tasks}। "जो खाली हो उससे पूछो" कहें, तो किसी से पूछ लिया जाएगा।',
    heard: 'सुना गया: "{text}"',
    languageSet: 'ठीक है, अब से आपको हिंदी में लिखा जाएगा।',
  },
  zh: {
    dose: '{time}：该用{med}了。',
    taken: '✅ 已用',
    snooze: '⏰ 15分钟后',
    recorded: '✅ 已记录：{med}，{time}。',
    alreadyYou: '这次{med}已经有记录了（{time}，由您记录）。我没有重复添加。',
    alreadyBy: '这次{med}已经有记录了（{time}，由{by}记录）。我没有重复添加。',
    snoozed: '⏰ 我会在{time}再提醒您{med}。',
    repeat: '提醒：您的{med}。',
    appt: '提醒：{when}，您的预约：{kind}。',
    apptWithOne: '{names}会负责。',
    apptWithMany: '{names}会负责。',
    apptHolder: '提醒：{when}，{them}的预约：{kind}。您负责：{tasks}。',
    apptUnowned: '{them}的预约（{kind}）在{when}，但还没有人负责：{tasks}。说“问问谁有空”，我就去问。',
    heard: '我听到的是：“{text}”',
    languageSet: '好的，以后我用中文给您发消息。',
  },
  pcm: {
    dose: 'E don reach {time}: time for your {med}.',
    taken: '✅ I don take am',
    snooze: '⏰ Remind me for 15 minutes',
    recorded: '✅ I don write am: {med}, {time}.',
    alreadyYou: 'Record of this {med} dose dey already ({time}, from you). I no add another one.',
    alreadyBy: 'Record of this {med} dose dey already ({time}, from {by}). I no add another one.',
    snoozed: '⏰ I go remind you about the {med} again for {time}.',
    repeat: 'Reminder: your {med}.',
    appt: 'Reminder: {when}, your {kind}.',
    apptWithOne: ' {names} go handle am.',
    apptWithMany: ' {names} go handle am.',
    apptHolder: 'Reminder: {when}, {them} get {kind}. Wetin you go do: {tasks}.',
    apptUnowned: '{them} get {kind} {when}, and nobody don take this one yet: {tasks}. Talk "ask whoever dey free" make I ask person.',
    heard: 'Wetin I hear: "{text}"',
    languageSet: 'No wahala, I go dey write you for Pidgin.',
  },
  yo: {
    dose: 'Ó ti tó {time}: àkókò láti lo {med} yín.',
    taken: '✅ Mo ti lò ó',
    snooze: '⏰ Ní ìṣẹ́jú 15',
    recorded: '✅ Mo ti kọ ọ́ sílẹ̀: {med}, {time}.',
    alreadyYou: 'Àkọsílẹ̀ ti wà fún {med} yìí ({time}, láti ọ̀dọ̀ yín). Mi ò fi òmíràn kún un.',
    alreadyBy: 'Àkọsílẹ̀ ti wà fún {med} yìí ({time}, láti ọ̀dọ̀ {by}). Mi ò fi òmíràn kún un.',
    snoozed: '⏰ Màá tún rán yín létí nípa {med} ní {time}.',
    repeat: 'Ìránnilétí: {med} yín.',
    appt: 'Ìránnilétí: {when}, {kind} yín.',
    apptWithOne: ' {names} ló ń bójú tó o.',
    apptWithMany: ' {names} ló ń bójú tó o.',
    apptHolder: 'Ìránnilétí: {when}, {kind} {them}. Ohun tí ẹ ń ṣe: {tasks}.',
    apptUnowned: '{kind} {them} jẹ́ {when}, kò sì tíì sí ẹni tó gbà á ṣe: {tasks}. Ẹ sọ pé "ask whoever\'s free", màá sì bi ẹnìkan.',
    heard: 'Ohun tí mo gbọ́: "{text}"',
    languageSet: 'Ó dáa, màá máa kọ̀wé sí yín ní Yorùbá.',
  },
  ig: {
    dose: 'Ọ bụzi {time}: oge maka {med} gị.',
    taken: '✅ Emeela m ya',
    snooze: "⏰ N'ime nkeji 15",
    recorded: '✅ Edeela m ya: {med}, {time}.',
    alreadyYou: "E nweelarị ndekọ maka {med} a ({time}, site n'aka gị). Etinyeghị m ọzọ.",
    alreadyBy: "E nweelarị ndekọ maka {med} a ({time}, site n'aka {by}). Etinyeghị m ọzọ.",
    snoozed: '⏰ Aga m echetara gị {med} ọzọ na {time}.',
    repeat: 'Ncheta: {med} gị.',
    appt: 'Ncheta: {when}, {kind} gị.',
    apptWithOne: ' {names} ga-ahụ maka ya.',
    apptWithMany: ' {names} ga-ahụ maka ya.',
    apptHolder: 'Ncheta: {when}, {kind} nke {them}. Ihe ị ga-eme: {tasks}.',
    apptUnowned: '{kind} nke {them} bụ {when}, ma ọ dịbeghị onye weere nke a: {tasks}. Kwuo "ask whoever\'s free", m ga-ajụ mmadụ.',
    heard: 'Ihe m nụrụ: "{text}"',
    languageSet: "Ọ dị mma, m ga na-ede gị n'Igbo.",
  },
  ha: {
    dose: '{time}: lokacin {med} ɗinka ya yi.',
    taken: '✅ Na yi',
    snooze: '⏰ Bayan minti 15',
    recorded: '✅ Na rubuta: {med}, {time}.',
    alreadyYou: 'An riga an rubuta wannan {med} ({time}, daga gare ka). Ban ƙara wani ba.',
    alreadyBy: 'An riga an rubuta wannan {med} ({time}, daga {by}). Ban ƙara wani ba.',
    snoozed: '⏰ Zan sake tunatar da kai game da {med} a {time}.',
    repeat: 'Tunatarwa: {med} ɗinka.',
    appt: 'Tunatarwa: {when}, {kind} ɗinka.',
    apptWithOne: ' {names} ne zai kula da shi.',
    apptWithMany: ' {names} ne za su kula da shi.',
    apptHolder: 'Tunatarwa: {when}, {kind} na {them}. Aikinka: {tasks}.',
    apptUnowned: '{kind} na {them} zai kasance {when}, kuma babu wanda ya ɗauki wannan tukuna: {tasks}. Ka ce "ask whoever\'s free", zan tambayi wani.',
    heard: 'Abin da na ji: "{text}"',
    languageSet: 'To, zan riƙa rubuta maka da Hausa.',
  },
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** One piece of a message: which phrase, filled in for the person, and for the English. */
export type Piece = [key: PhraseKey, vars: Record<string, string>, en?: Record<string, string>];

/**
 * A fixed message in a person's language, built from one or more pieces. Where the
 * translation is a draft, the English of the whole message follows it, so a word that
 * came out wrong can never be the only copy of a medical fact. The English pieces can be
 * filled differently ("8 PM" where Yoruba has "20:00").
 */
export function phrase(lang: LanguageCode | undefined, ...pieces: Piece[]): string {
  const l = LANGUAGES[lang ?? 'en'];
  const english = pieces.map(([key, vars, en]) => fill(EN[key], en ?? vars)).join('');
  const book = BOOKS[l.code];
  if (!book || pieces.some(([key]) => !book[key])) return english;
  const own = pieces.map(([key, vars]) => fill(book[key]!, vars)).join('');
  // What was heard, and "done, I'll write to you in X", carry no fact to lose.
  const factual = pieces.some(([key]) => key !== 'heard' && key !== 'languageSet');
  return l.status === 'draft' && factual ? `${own}\n(${english.trim()})` : own;
}

/** What the person can expect in this language, said plainly when they choose it. */
export function languageNote(lang: LanguageCode): string {
  const l = LANGUAGES[lang];
  if (l.status === 'understood') {
    return `I understand ${l.name} words when you mix them into English, and I'll answer in English: `
      + `no computer voice or translation service handles ${l.name} well enough yet for anything about medicine. `
      + `If you'd like to help write CareCircle's reminders in ${l.name}, tell the family's coordinator.`;
  }
  const lines: string[] = [];
  if (l.status === 'draft') {
    lines.push(`My ${l.name} hasn't been checked by a native speaker yet, so reminders come with the English underneath. If a word is wrong, tell me the right one.`);
  }
  if (l.hears && l.hears.startsWith(l.code)) lines.push(`Voice notes: speak in ${l.name} and I'll understand.`);
  else if (l.hears) lines.push(`Voice notes: speak in ${l.name} or English and I'll show you what I heard, so you can correct it.`);
  else lines.push(`Voice notes: please speak in English or Pidgin. No speech service can hear ${l.name} yet.`);
  if (!l.voice) lines.push(`I'll answer in writing: no computer voice speaks ${l.name} yet.`);
  return lines.join('\n');
}

/** A button's label: in the draft languages the English is added after a slash. */
export function buttonLabel(lang: LanguageCode | undefined, key: 'taken' | 'snooze'): string {
  const l = LANGUAGES[lang ?? 'en'];
  const own = BOOKS[l.code]?.[key];
  if (!own) return EN[key];
  return l.status === 'draft' ? `${own} / ${EN[key].replace(/^\S+\s/, '')}` : own;
}

/** "8:00 PM", "20:00", "晚上8:00", in the person's own way of writing a time. */
export function timeIn(lang: LanguageCode | undefined, iso: string, timezone: string): string {
  const l = LANGUAGES[lang ?? 'en'];
  return new Intl.DateTimeFormat(l.locale, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Friday 2 October at 10:00", in the person's language. */
export function whenIn(lang: LanguageCode | undefined, iso: string, timezone: string): string {
  const l = LANGUAGES[lang ?? 'en'];
  return new Intl.DateTimeFormat(l.locale, {
    timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * What the model is told when the person prefers a language other than English. Only
 * the chat channel gets it: Alexa sets its own language, and the voice prompt is measured.
 */
export function replyLanguageRule(lang: LanguageCode | undefined): string {
  if (!isLanguageCode(lang) || lang === 'en') return '';
  const l = LANGUAGES[lang];
  if (l.status === 'understood') {
    return `\n- This person's language is ${l.name}. Understand any ${l.name} they use, and reply in plain English (or Nigerian Pidgin if they write to you in Pidgin): written ${l.name} is not reliable enough yet for facts about someone's care.`;
  }
  const draft = l.status === 'draft'
    ? ` Your ${l.name} has not been checked by a native speaker, so after each fact about a medicine, a dose, a time or who is doing something, give the key words in English in brackets.`
    : '';
  return `\n- This person prefers ${l.name}. Write every reply in ${l.name}, whatever language the tools answer in.`
    + ` Write a medicine's name exactly as the tools give it, in its own words, even inside a ${l.name} sentence: if the tools say "heart pill", write "heart pill", never only a translation of it; a translation in brackets after it is fine (a family can have two kinds of drops, and the name is how they tell them apart).`
    + ` Keep people's names, times and dates exactly as the tools give them.`
    + ` Translate what the tools said and nothing more: no "his day went well", no reassurance they did not give.`
    + ` "No record" must stay "no record" in ${l.name}: never a word for "missed", "forgot" or "didn't take".${draft}`
    + ` Where ${l.name} marks whether you are speaking to a man or a woman and you do not know which, use the respectful plural or a neutral form.`;
}
