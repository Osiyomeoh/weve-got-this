/**
 * The Echo's ear: does what a family says reach CareCircle at all on a real Echo?
 *
 *   npx tsx scripts/evals-echo.ts --skill <skill id> [--model <en-US.json>] [--dialects] [--json]
 *
 * Every case in the corpus (or the dialect set) is sent to Alexa's own language model for the
 * skill with `ask smapi profile-nlu`, the intent Alexa would pick in an open session. Nothing
 * is called on CareCircle and nothing is written: this measures only the step before the planner,
 * which the tool-selection evals never see. With the Alexa Skill bridge an utterance can:
 *
 *   words       land in the catch-all (SpokenRequestIntent / FreeTextIntent): the planner gets
 *               the sentence itself, and the tool-selection evals measure what happens next
 *   right tool  land in a tool's own intent, a tool the corpus accepts: the planner gets that
 *               tool as a hint and the slots, not the sentence
 *   wrong tool  land in another tool's intent, so the planner is pointed at the wrong tool
 *   dropped     land in Alexa's fallback, Help, Stop, Cancel or an answer intent: CareCircle
 *               never hears it (right only for a case that is not care, `expectNone`)
 *
 * `--model` is the skill's interaction model; with it, cases whose exact words are in the model
 * (trained) are reported apart from the rest. Held-out cases were left out of the catch-all's
 * training, so they and the dialect set measure phrasing the Echo was never shown.
 *
 * Needs the ASK CLI logged in to the account that owns the skill. Text is sent as Alexa's speech
 * recogniser writes it (lower case, no punctuation); the recogniser's own errors are not measured.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { CORPUS, type EvalCase } from '../src/evals/corpus.ts';
import { DIALECT_CASES } from '../src/evals/dialects.ts';

const run = promisify(execFile);
const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const skill = opt('--skill') ?? process.env.ALEXA_SKILL_ID;
if (!skill) throw new Error('pass --skill <skill id> or set ALEXA_SKILL_ID');
const locale = opt('--locale') ?? 'en-US';
const modelFile = opt('--model');
const asJson = args.includes('--json');
const cases: EvalCase[] = args.includes('--dialects') ? DIALECT_CASES : CORPUS;

/** As the speech recogniser writes it: lower case, no punctuation but apostrophes, any script. */
export const spoken = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Every exact sentence the model was trained on: slot-free samples and catch-all values. */
function trainedSentences(file: string): Set<string> {
  const lm = JSON.parse(readFileSync(file, 'utf8')).interactionModel.languageModel;
  const out = new Set<string>();
  for (const i of lm.intents) for (const s of i.samples ?? []) if (!s.includes('{')) out.add(spoken(s));
  for (const t of lm.types ?? []) {
    for (const v of t.values ?? []) {
      out.add(spoken(v.name.value));
      for (const syn of v.name.synonyms ?? []) out.add(spoken(syn));
    }
  }
  return out;
}

const CATCH_ALL = new Set(['SpokenRequestIntent', 'FreeTextIntent']);
/** LogCareEventIntent -> log_care_event, as the bridge's generator names them. */
const toolOf = (intent: string) =>
  intent.endsWith('Intent') && !intent.startsWith('AMAZON.') && !CATCH_ALL.has(intent) && !/AnswerIntent$/.test(intent)
    ? intent.slice(0, -'Intent'.length).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    : undefined;

type Route = 'words' | 'right tool' | 'wrong tool' | 'dropped';
interface Row { id: string; split: string; trained?: boolean; text: string; intent: string; route: Route; pass: boolean }

async function profile(text: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { stdout } = await run('ask', ['smapi', 'profile-nlu', '-s', skill!, '-l', locale, '-u', text]);
      return JSON.parse(stdout).selectedIntent?.name ?? 'none';
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
    }
  }
}

function grade(c: EvalCase, intent: string): { route: Route; pass: boolean } {
  if (CATCH_ALL.has(intent)) return { route: 'words', pass: true };
  const tool = toolOf(intent);
  // Not care ("play some music"): CareCircle not hearing it is as right as the planner leaving it.
  if (!tool) return { route: 'dropped', pass: c.expectNone === true };
  const right = !c.expectNone && (c.expect ?? []).includes(tool);
  return { route: right ? 'right tool' : 'wrong tool', pass: right };
}

const trained = modelFile ? trainedSentences(modelFile) : undefined;
const splitOf = (c: EvalCase) => (!c.id.startsWith('h') ? 'authored' : c.seen ? 'seen' : 'held-out');
const rows: Row[] = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    const text = spoken(c.utterance);
    const intent = await profile(text);
    rows.push({ id: c.id, split: splitOf(c), ...(trained ? { trained: trained.has(text) } : {}), text, intent, ...grade(c, intent) });
    if (!asJson) process.stdout.write(`\rProfiling on Alexa: ${rows.length}/${cases.length}   `);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
const order = new Map(cases.map((c, i) => [c.id, i]));
rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

const tally = (rs: Row[]) => {
  const by = (r: Route) => rs.filter((x) => x.route === r).length;
  return { total: rs.length, reached: rs.filter((x) => x.pass).length,
    words: by('words'), rightTool: by('right tool'), wrongTool: by('wrong tool'), dropped: by('dropped') };
};
const groups: Record<string, Row[]> = { all: rows };
for (const s of ['authored', 'held-out', 'seen']) groups[s] = rows.filter((r) => r.split === s);
if (trained) {
  groups['trained (exact words in the model)'] = rows.filter((r) => r.trained);
  groups['never shown to the Echo'] = rows.filter((r) => !r.trained);
}
const summary = Object.fromEntries(Object.entries(groups).filter(([, rs]) => rs.length).map(([k, rs]) => [k, tally(rs)]));

if (asJson) {
  console.log(JSON.stringify({ date: new Date().toISOString(), skill, locale, set: args.includes('--dialects') ? 'dialects' : 'corpus', summary, rows }, null, 2));
} else {
  console.log('\n');
  for (const [k, t] of Object.entries(summary)) {
    const pct = ((100 * t.reached) / t.total).toFixed(1);
    console.log(`${k.padEnd(36)} reached ${t.reached}/${t.total} (${pct}%)  words ${t.words} · right tool ${t.rightTool} · wrong tool ${t.wrongTool} · dropped ${t.dropped}`);
  }
  console.log('\nNot reached:');
  for (const r of rows.filter((x) => !x.pass)) {
    console.log(`  ${r.id.padEnd(10)} ${r.route.padEnd(10)} ${r.intent.padEnd(26)} "${r.text}"${r.trained ? ' (trained)' : ''}`);
  }
}
