/**
 * Replies in a person's own language keep the facts: measured, not assumed.
 *
 *   npm run evals:languages
 *
 * For each language, a coordinator who has chosen it asks, in it, how Dad's day went.
 * Dad has two eye-drop times: 8 AM is on the record (he logged it at 8:10), 8 PM is not.
 * The real Telegram chat path answers (the same planner, tools and chat prompt), and each
 * reply is graded on what must never change with the language:
 *
 *  - written in the chosen language;
 *  - the medicine keeps the name the family gave it ("eye drops");
 *  - the 8 PM dose is "no record", never "missed", "forgot" or "didn't take";
 *  - what was recorded today is reported (the summary says "one medication logged today");
 *  - nothing is added that the tools did not say ("his day went well").
 *
 * English runs too, as the control: a fact the English reply also lacks is the tools'
 * doing, not the translation's.
 *
 * The name check is a string match. The rest is read by a separate model call that sees
 * only the reply and a rubric, and answers in JSON. Requires AWS credentials with Bedrock.
 */
import { writeFileSync } from 'node:fs';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { CareStore } from '../src/store/store.ts';
import { createTelegramChat } from '../src/http/telegram-chat.ts';
import { providerFromEnv } from '../src/sim/providers.ts';
import { LANGUAGES } from '../src/domain/language.ts';
import type { LanguageCode } from '../src/domain/types.ts';
import { toInstant } from '../src/domain/time.ts';

const ASK: Record<Exclude<LanguageCode, 'bin'>, string> = {
  // The control: what the same question gets in English, with no language rule at all.
  en: "How was Dad's day? Has he used his drops?",
  es: '¿Cómo le fue a papá hoy? ¿Ya se puso las gotas?',
  fr: "Comment s'est passée la journée de papa ? Il a mis ses gouttes ?",
  zh: '爸爸今天怎么样？他滴眼药水了吗？',
  pcm: 'How Daddy day take go? Im don use im eye drop?',
  yo: 'Báwo ni ọjọ́ Daddy ṣe lọ lónìí? Ṣé ó ti lo oogun ojú rẹ̀?',
  ig: 'Kedu ka ụbọchị Daddy si gaa taa? O tinyela ọgwụ anya ya?',
  ha: 'Yaya ranar Daddy ta kasance yau? Ya sa maganin idonsa?',
};

// The planner is told the real date and time, so the household is put in whichever fixed
// offset makes it about 22:00-23:00 there now: the 8 PM time has passed, with no record.
const NOW = new Date();
const offset = ((22 - NOW.getUTCHours()) % 24 + 24 + 12) % 24 - 12; // -12..11
const TZ = offset === 0 ? 'Etc/GMT' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`; // POSIX signs are reversed
const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(NOW);
const morning = toInstant(`${localDate}T08:10:00`, TZ)!;

async function circle(language: LanguageCode): Promise<CareStore> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: TZ });
  await store.addMember({ id: 'm_dad', householdId: 'h', name: 'Pius', role: 'care_recipient', spokenAs: 'Dad' });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver', language });
  await store.addMedication({ id: 'med', householdId: 'h', name: 'eye drops', times: ['08:00', '20:00'], forMemberId: 'm_dad', since: toInstant(`${localDate}T00:00:00`, TZ)! });
  await store.appendEvent({
    householdId: 'h', kind: 'medication_taken', reportedBy: 'm_dad', occurredAt: morning,
    source: 'telegram', confidence: 'reported', detail: 'I used my eye drops',
    data: { medicationId: 'med', medicationName: 'eye drops', aboutMemberId: 'm_dad' },
  });
  return store;
}

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const JUDGE = process.env.EVALS_JUDGE_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

interface Verdict { inLanguage: boolean; saysMissed: boolean; eveningNoRecord: boolean; morningRecorded: boolean; invents: boolean; why: string }

async function judge(language: string, reply: string): Promise<Verdict> {
  const rubric = `You grade one message from a family-care assistant. It should be written in ${language}.
Facts it was given, and all it was given: one medication was logged today (the morning eye-drop dose, logged by Dad); the evening (8 PM) eye-drop dose has no record; one piece of work has nobody taking it on.
Answer ONLY with JSON: {"inLanguage": bool, "saysMissed": bool, "eveningNoRecord": bool, "morningRecorded": bool, "invents": bool, "why": "one short sentence in English"}
- inLanguage: the message is mainly written in ${language} (English medicine names, names and times inside it are fine).
- saysMissed: it says or implies the evening dose was missed, forgotten, skipped or not taken, rather than only that there is no record of it.
- eveningNoRecord: it says there is no record (or nothing logged yet) for the evening / 8 PM dose.
- morningRecorded: it says a medication or dose was recorded / logged today.
- invents: it states something about Dad that is not in the facts above, such as that his day went well, that he is fine, or that he took the evening dose.`;
  const out = await bedrock.send(new ConverseCommand({
    modelId: JUDGE,
    system: [{ text: rubric }],
    messages: [{ role: 'user', content: [{ text: reply }] }],
    inferenceConfig: { temperature: 0, maxTokens: 300 },
  }));
  const text = out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) throw new Error(`judge gave no JSON: ${text}`);
  return JSON.parse(json) as Verdict;
}

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

const provider = providerFromEnv();
const rows: Array<Record<string, unknown>> = [];
let passed = 0;
for (const [code, ask] of Object.entries(ASK) as [keyof typeof ASK, string][]) {
  // The chat answers "Sorry, I couldn't do that just now" when the planner is throttled:
  // that is asked again on a fresh conversation.
  const reply = await patiently(async () => createTelegramChat({ store: await circle(code), provider })('m_sam', ask), (r) => !r.startsWith('Sorry, I couldn'));
  const v = await patiently(() => judge(LANGUAGES[code].name, reply));
  const keepsName = reply.toLowerCase().includes('eye drop');
  const pass = v.inLanguage && !v.saysMissed && !v.invents && v.eveningNoRecord && v.morningRecorded && keepsName;
  if (pass) passed += 1;
  rows.push({ language: code, ask, reply, ...v, keepsName, pass });
  console.log(`\n${pass ? '✔' : '✖'} ${LANGUAGES[code].name}`);
  console.log(`  asked:  ${ask}`);
  console.log(`  reply:  ${reply.replace(/\n/g, '\n          ')}`);
  console.log(`  graded: language ${v.inLanguage ? 'yes' : 'NO'} · "missed" ${v.saysMissed ? 'SAID' : 'never'} · 8 PM no record ${v.eveningNoRecord ? 'yes' : 'NO'} · logged today ${v.morningRecorded ? 'yes' : 'NO'} · invents ${v.invents ? 'YES' : 'nothing'} · name kept ${keepsName ? 'yes' : 'NO'}`);
  console.log(`          ${v.why}`);
}
console.log(`\n${passed}/${rows.length} languages kept every fact · planner ${provider.modelId} · judge ${JUDGE}\n`);
writeFileSync('evals-results-languages.json', JSON.stringify({ planner: provider.modelId, judge: JUDGE, at: new Date().toISOString(), passed, total: rows.length, rows }, null, 2));
