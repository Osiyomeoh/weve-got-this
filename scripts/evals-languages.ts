/**
 * Replies in a person's own language keep the facts, and a family that speaks two
 * languages shares one record: measured, not assumed.
 *
 *   npm run evals:languages                    both parts, every language
 *   npm run evals:languages -- --only=es,hi    some languages
 *   npm run evals:languages -- --part=handoff  one part ("ask" or "handoff")
 *   npm run evals:languages -- --named         the family has named the drops in each language
 *
 * Without --named the medicine has only its English name, and a reply in another
 * language must keep "eye drops" as written. With --named the family has also given it
 * their own word in the reader's language ("colírio"), as add_medication / change_medication
 * let them: a reply passes on the name when it uses a name the family gave (theirs, or
 * "eye drops"), and never one of the model's own.
 *
 * Part 1, "ask". A coordinator who has chosen a language asks, in it, how Dad's day went.
 * Dad has two eye-drop times: the morning one is on the record, 8 PM is not. Graded:
 *  - written in the chosen language;
 *  - the medicine keeps the name the family gave it ("eye drops");
 *  - 8 PM is "no record", never "missed", "forgot" or "didn't take";
 *  - what was recorded today is reported;
 *  - nothing is added that the tools did not say ("his day went well").
 * English runs too, as the control: a fact the English reply also lacks is the tools'
 * doing, not the translation's.
 *
 * Part 2, "handoff". The family the numbers describe: Mom speaks Spanish (or Hindi, or
 * Yoruba), her son speaks English. Mom says in her own words that she has just used her
 * drops; then her son asks, in English, whether she has. Graded:
 *  - a dose of the right medicine is on the record, from Mom (checked in the store);
 *  - Mom was answered in her language;
 *  - her son is told it was recorded, in English, with the medicine's name, nothing
 *    invented and nothing "missed".
 *
 * The real Telegram chat path answers (the same planner, tools and chat prompt). The
 * record and the name are checked directly; the rest is read by a separate model call that
 * sees only the reply and a rubric, and answers in JSON. Requires AWS credentials with Bedrock.
 */
import { writeFileSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { CareStore } from '../src/store/store.ts';
import { createTelegramChat } from '../src/http/telegram-chat.ts';
import { providerFromEnv } from '../src/sim/providers.ts';
import { LANGUAGES } from '../src/domain/language.ts';
import type { LanguageCode } from '../src/domain/types.ts';
import { toInstant } from '../src/domain/time.ts';

type Code = Exclude<LanguageCode, 'bin'>;

const ASK: Record<Code, string> = {
  // The control: what the same question gets in English, with no language rule at all.
  en: "How was Dad's day? Has he used his drops?",
  es: '¿Cómo le fue a papá hoy? ¿Ya se puso las gotas?',
  fr: "Comment s'est passée la journée de papa ? Il a mis ses gouttes ?",
  pt: 'Como foi o dia do papai hoje? Ele já pingou o colírio?',
  de: 'Wie war Papas Tag heute? Hat er seine Augentropfen genommen?',
  it: "Com'è andata la giornata di papà oggi? Ha messo il collirio?",
  hi: 'पापा का आज का दिन कैसा रहा? क्या उन्होंने आँखों की दवा डाली?',
  zh: '爸爸今天怎么样？他滴眼药水了吗？',
  pcm: 'How Daddy day take go? Im don use im eye drop?',
  yo: 'Báwo ni ọjọ́ Daddy ṣe lọ lónìí? Ṣé ó ti lo oogun ojú rẹ̀?',
  ig: 'Kedu ka ụbọchị Daddy si gaa taa? O tinyela ọgwụ anya ya?',
  ha: 'Yaya ranar Daddy ta kasance yau? Ya sa maganin idonsa?',
};

// Mom, in her own words: "I've just used my eye drops." Nobody says "eye drops" in English.
const LOGGED: Record<Exclude<Code, 'en'>, string> = {
  es: 'Ya me acabo de poner las gotas para los ojos.',
  fr: 'Je viens de mettre mes gouttes pour les yeux.',
  pt: 'Acabei de pingar o colírio.',
  de: 'Ich habe gerade meine Augentropfen genommen.',
  it: 'Ho appena messo il collirio.',
  hi: 'मैंने अभी अपनी आँखों की दवा डाल ली है।',
  zh: '我刚滴了眼药水。',
  pcm: 'I don use my eye drop now now.',
  yo: 'Mo ṣẹ̀ṣẹ̀ lo oogun ojú mi.',
  ig: 'Etinyela m ọgwụ anya m ugbu a.',
  ha: 'Yanzu na sa maganin idona.',
};

// What a family in each language calls the drops. Pidgin says "eye drop", so it has none.
const FAMILY_WORD: Partial<Record<Code, string>> = {
  es: 'gotas para los ojos',
  fr: 'gouttes pour les yeux',
  pt: 'colírio',
  de: 'Augentropfen',
  it: 'collirio',
  hi: 'आँखों की दवा',
  zh: '眼药水',
  yo: 'oogun ojú',
  ig: 'ọgwụ anya',
  ha: 'maganin ido',
};

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const part = args.find((a) => a.startsWith('--part='))?.slice(7);
const named = args.includes('--named');
const wanted = (c: string) => !only || only.includes(c);

const plainText = (s: string) => s.normalize('NFC').toLowerCase();
/** The reply names the drops by a name the family gave: "eye drops", or (--named) their own word. */
const keepsFamilyName = (reply: string, code: LanguageCode): boolean => {
  const word = named ? FAMILY_WORD[code as Code] : undefined;
  return plainText(reply).includes('eye drop') || (!!word && plainText(reply).includes(plainText(word)));
};
const namesFor = (code: LanguageCode) => {
  const word = named ? FAMILY_WORD[code as Code] : undefined;
  return word ? { names: { [code]: word } } : {};
};

// The planner is told the real date and time, so the household is put in whichever fixed
// offset makes it about 22:00-23:00 there now: the 8 PM time has passed.
const NOW = new Date();
const offset = ((22 - NOW.getUTCHours()) % 24 + 24 + 12) % 24 - 12; // -12..11
const TZ = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`; // POSIX signs are reversed
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW);
const at = (clock: string) => toInstant(`${localDate}T${clock}:00`, TZ)!;

async function household(): Promise<CareStore> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: TZ });
  return store;
}

/** Part 1: Dad, and a coordinator who reads in `language`. The morning dose is recorded. */
async function askCircle(language: LanguageCode): Promise<CareStore> {
  const store = await household();
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver', language });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad', since: at('00:00'), ...namesFor(language) });
  await store.appendEvent({
    householdId: 'h', kind: 'medication_taken', reportedBy: 'm_dad', occurredAt: at('08:10'),
    source: 'telegram', confidence: 'reported', detail: 'I used my eye drops',
    data: { medicationId: 'med', medicationName: 'eye drops', aboutMemberId: 'm_dad' },
  });
  return store;
}

/** Part 2: Mom, who reads in `language`, and her son, who reads English. Nothing recorded yet. */
async function handoffCircle(language: LanguageCode): Promise<CareStore> {
  const store = await household();
  await store.addMember({ id: 'm_mom', householdId: 'h', name: 'Rosa', role: 'care_recipient', spokenAs: 'Mom', language });
  await store.addMember({ id: 'm_son', householdId: 'h', name: 'Daniel', role: 'primary_caregiver' });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_mom', since: at('00:00'), ...namesFor(language) });
  return store;
}

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const JUDGE = process.env.EVALS_JUDGE_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

async function judge<T>(rubric: string, reply: string): Promise<T> {
  const out = await bedrock.send(new ConverseCommand({
    modelId: JUDGE,
    system: [{ text: rubric }],
    messages: [{ role: 'user', content: [{ text: reply }] }],
    inferenceConfig: { temperature: 0, maxTokens: 300 },
  }));
  const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) throw new Error(`judge gave no JSON: ${text}`);
  return JSON.parse(json) as T;
}

interface AskVerdict { inLanguage: boolean; saysMissed: boolean; eveningNoRecord: boolean; morningRecorded: boolean; invents: boolean; why: string }
const askRubric = (language: string) => `You grade one message from a family-care assistant. It should be written in ${language}.
Facts it was given, and all it was given: one medication was logged today (the morning eye-drop dose, logged by Dad); the evening (8 PM) eye-drop dose has no record; one piece of work has nobody taking it on.
Answer ONLY with JSON: {"inLanguage": bool, "saysMissed": bool, "eveningNoRecord": bool, "morningRecorded": bool, "invents": bool, "why": "one short sentence in English"}
- inLanguage: the message is mainly written in ${language} (English medicine names, names and times inside it are fine).
- saysMissed: it says or implies the evening dose was missed, forgotten, skipped or not taken, rather than only that there is no record of it.
- eveningNoRecord: it says there is no record (or nothing logged yet) for the evening / 8 PM dose.
- morningRecorded: it says a medication or dose was recorded / logged today.
- invents: it states something about Dad that is not in the facts above, such as that his day went well, that he is fine, or that he took the evening dose.`;

interface InLanguage { inLanguage: boolean; why: string }
const replyRubric = (language: string) => `You read one message from a family-care assistant, sent to someone who reads ${language}.
Answer ONLY with JSON: {"inLanguage": bool, "why": "one short sentence in English"}
- inLanguage: the message is mainly written in ${language} (English medicine names, names and times inside it are fine).`;

interface SonVerdict { inEnglish: boolean; recordedToday: boolean; saysMissed: boolean; invents: boolean; why: string }
const sonRubric = `You grade one message from a family-care assistant to a son asking, in English, whether his mother has used her eye drops today.
Facts it was given, and all it was given: this evening Mom herself logged one eye-drop dose; the 8 AM eye-drop dose has no record.
Answer ONLY with JSON: {"inEnglish": bool, "recordedToday": bool, "saysMissed": bool, "invents": bool, "why": "one short sentence in English"}
- inEnglish: the message is written in English.
- recordedToday: it says an eye-drop dose was recorded / logged today (by Mom, or without saying by whom).
- saysMissed: it says or implies a dose was missed, forgotten, skipped or not taken, rather than only that there is no record of it.
- invents: it states something not in the facts above (how she is feeling, that she took the morning dose, and so on).`;

// Bedrock is shared with other runs; a throttle is waited out, never graded as a failure.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function patiently<T>(fn: () => Promise<T>, ok: (v: T) => boolean = () => true): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const v = await fn();
      if (ok(v) || attempt >= 5) return v;
    } catch (err) {
      if (attempt >= 5 || !/Throttl|Too many|429/i.test(String(err))) throw err;
    }
    await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
  }
}
// The chat answers "Sorry, I couldn't do that just now" when the planner is throttled.
const answered = (r: string) => !r.startsWith('Sorry, I couldn');
const indent = (s: string) => s.replace(/\n/g, '\n          ');
const yes = (b: boolean) => (b ? 'yes' : 'NO');

const provider = providerFromEnv();
const asks: Array<Record<string, unknown>> = [];
const handoffs: Array<Record<string, unknown>> = [];

if (part !== 'handoff') {
  console.log('\n=== Part 1: a coordinator asks in their own language ===');
  for (const [code, ask] of Object.entries(ASK) as [Code, string][]) {
    if (!wanted(code)) continue;
    const reply = await patiently(async () => createTelegramChat({ store: await askCircle(code), provider })('m_sam', ask), answered);
    const v = await patiently(() => judge<AskVerdict>(askRubric(LANGUAGES[code].name), reply));
    const keepsName = keepsFamilyName(reply, code);
    const pass = v.inLanguage && !v.saysMissed && !v.invents && v.eveningNoRecord && v.morningRecorded && keepsName;
    asks.push({ language: code, ask, reply, ...v, keepsName, pass });
    console.log(`\n${pass ? '✔' : '✖'} ${LANGUAGES[code].name}`);
    console.log(`  asked:  ${ask}`);
    console.log(`  reply:  ${indent(reply)}`);
    console.log(`  graded: language ${yes(v.inLanguage)} · "missed" ${v.saysMissed ? 'SAID' : 'never'} · 8 PM no record ${yes(v.eveningNoRecord)} · logged today ${yes(v.morningRecorded)} · invents ${v.invents ? 'YES' : 'nothing'} · name kept ${yes(keepsName)}`);
    console.log(`          ${v.why}`);
  }
}

if (part !== 'ask') {
  console.log('\n=== Part 2: Mom logs in her language, her son asks in English ===');
  for (const [code, said] of Object.entries(LOGGED) as [Exclude<Code, 'en'>, string][]) {
    if (!wanted(code)) continue;
    const run = await patiently(async () => {
      const store = await handoffCircle(code);
      const chat = createTelegramChat({ store, provider });
      const momReply = await chat('m_mom', said);
      const sonReply = answered(momReply) ? await chat('m_son', 'Has Mom used her eye drops today?') : momReply;
      return { store, momReply, sonReply };
    }, (r) => answered(r.momReply) && answered(r.sonReply));
    const dose = run.store.getCareState('h').events.find((e) => e.kind === 'medication_taken' && e.data['medicationId'] === 'med');
    const recordedByMom = dose?.reportedBy === 'm_mom';
    const mom = await patiently(() => judge<InLanguage>(replyRubric(LANGUAGES[code].name), run.momReply));
    const son = await patiently(() => judge<SonVerdict>(sonRubric, run.sonReply));
    const keepsName = run.sonReply.toLowerCase().includes('eye drop');
    const pass = recordedByMom && mom.inLanguage && son.inEnglish && son.recordedToday && !son.saysMissed && !son.invents && keepsName;
    handoffs.push({ language: code, said, momReply: run.momReply, sonReply: run.sonReply, recordedByMom, momInLanguage: mom.inLanguage, ...son, keepsName, pass });
    console.log(`\n${pass ? '✔' : '✖'} ${LANGUAGES[code].name} → English`);
    console.log(`  Mom:    ${said}`);
    console.log(`  to Mom: ${indent(run.momReply)}`);
    console.log(`  to son: ${indent(run.sonReply)}`);
    console.log(`  graded: on the record from Mom ${yes(recordedByMom)} · Mom answered in ${LANGUAGES[code].name} ${yes(mom.inLanguage)} · son in English ${yes(son.inEnglish)} · son told it was recorded ${yes(son.recordedToday)} · "missed" ${son.saysMissed ? 'SAID' : 'never'} · invents ${son.invents ? 'YES' : 'nothing'} · name kept ${yes(keepsName)}`);
    console.log(`          ${son.why}`);
  }
}

const score = (rows: Array<Record<string, unknown>>) => `${rows.filter((r) => r['pass']).length}/${rows.length}`;
console.log(`\nask: ${score(asks)} · handoff: ${score(handoffs)} · ${named ? 'named by the family' : 'English name only'} · planner ${provider.modelId} · judge ${JUDGE}\n`);
writeFileSync(named ? 'evals-results-languages-named.json' : 'evals-results-languages.json', JSON.stringify({
  planner: provider.modelId, judge: JUDGE, at: new Date().toISOString(), named,
  ask: { passed: asks.filter((r) => r['pass']).length, total: asks.length, rows: asks },
  handoff: { passed: handoffs.filter((r) => r['pass']).length, total: handoffs.length, rows: handoffs },
}, null, 2));
