/**
 * Build public/proof.json, the numbers behind /proof, from the committed result files.
 *
 *   npx tsx scripts/proof-build.ts --tests=579
 *
 * Every figure on the page is read from a file in evals/results/, and the page names that
 * file next to it, so a judge can open the cases it came from. Nothing is typed in by hand
 * except the test count, which is the last `npm test` run's. The pilot family's record is
 * not on the page: it is theirs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../evals/results/', import.meta.url).pathname;
const read = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'));
const tests = Number(process.argv.find((a) => a.startsWith('--tests='))?.slice(8) ?? 0) || null;

interface Run {
  passed: number;
  total: number;
  modelId: string;
  splits?: { split: string; passed: number; total: number }[];
}
const selection = (file: string, planner: string, prompt: string) => {
  const r = read(file) as Run;
  const held = r.splits?.find((s) => s.split === 'held-out');
  return {
    file,
    planner,
    prompt,
    passed: r.passed,
    total: r.total,
    heldOut: held ? { passed: held.passed, total: held.total } : null,
  };
};

/** The latest of each, by date in the name; a later file supersedes an earlier one. */
const latest = (...files: string[]) => files.filter((f) => existsSync(dir + f)).at(-1)!;

const corpus = latest(
  '2026-09-24-zod4-claude-sonnet-4-5.json',
  '2026-10-02-claude-sonnet-4-5-rename.json',
  '2026-10-02-claude-sonnet-4-5-question-not-report.json',
  '2026-10-08-claude-sonnet-4-5-get-my-requests-key.json',
  '2026-10-16-claude-sonnet-4-5-asks-not-assigns.json',
  '2026-10-16-claude-sonnet-4-5-weve-got-this.json',
  '2026-10-16-claude-sonnet-4-5-get-promises.json',
  '2026-10-17-claude-sonnet-4-5-set-routine.json',
  '2026-10-17-claude-sonnet-4-5-record-order.json',
  '2026-10-20-claude-sonnet-4-5-not-care.json',
);
const dialects = latest(
  '2026-09-24-zod4-dialects-sonnet-4-5.json',
  '2026-10-02-dialects-sonnet-4-5-rename.json',
  '2026-10-02-dialects-sonnet-4-5-question-not-report.json',
  '2026-10-16-dialects-sonnet-4-5-asks-not-assigns.json',
  '2026-10-16-dialects-sonnet-4-5-weve-got-this.json',
  '2026-10-16-dialects-sonnet-4-5-get-promises.json',
);
const bridge = latest(
  '2026-09-24-nova-pro-alexa-bridge-prompt.json',
  '2026-10-02-nova-pro-alexa-bridge-prompt-question-not-report.json',
  '2026-10-16-nova-pro-alexa-bridge-prompt-asks-not-assigns.json',
  '2026-10-16-nova-pro-alexa-bridge-prompt-weve-got-this.json',
  '2026-10-16-nova-pro-alexa-bridge-prompt-get-promises.json',
  '2026-10-17-nova-pro-alexa-bridge-prompt-record-order.json',
  '2026-10-20-nova-pro-alexa-bridge-prompt-not-care.json',
);
const languages = read('2026-09-24-zod4-languages-named-sonnet-4-5.json');
const massiveBefore = read('2026-09-23-massive-nova-pro-alexa-bridge-prompt.json');
const massiveAfter = read('2026-09-24-massive-nova-pro-alexa-bridge-prompt.json');
const massiveDevFile = latest('2026-10-02-massive-dev-nova-pro-alexa-bridge-prompt.json');
const gate = read('2026-09-24-gate-nova-micro.json');
const guardFile = latest('2026-10-02-action-guard-nova-pro-alexa-bridge-prompt.json');

const out = {
  built: new Date().toISOString(),
  tests,
  selection: [
    selection(corpus, 'Claude Sonnet 4.5 (Bedrock)', 'our console'),
    selection(bridge, 'Amazon Nova Pro (Bedrock)', "an Alexa Skill bridge's, not ours"),
  ],
  dialects: {
    file: dialects,
    ...(({ passed, total }) => ({ passed, total }))(read(dialects) as Run),
  },
  languages: {
    file: '2026-09-24-zod4-languages-named-sonnet-4-5.json',
    replies: { passed: languages.ask.passed, total: languages.ask.total },
    handoff: { passed: languages.handoff.passed, total: languages.handoff.total },
  },
  massive: {
    files: [
      '2026-09-23-massive-nova-pro-alexa-bridge-prompt.json',
      '2026-09-24-massive-nova-pro-alexa-bridge-prompt.json',
    ],
    cases: massiveAfter.total,
    before: massiveBefore.notOurs,
    after: massiveAfter.notOurs,
    heldOut: false,
    dev: massiveDevFile
      ? {
          file: massiveDevFile,
          cases: read(massiveDevFile).total,
          ...read(massiveDevFile).notOurs,
          landed: read(massiveDevFile).landed?.total ?? null,
        }
      : null,
  },
  wordGate: {
    file: '2026-09-24-gate-nova-micro.json',
    ...gate.gates['nova-micro'].atThreshold,
    harms: gate.baseline.harms,
    care: gate.care,
  },
  actionGuard: guardFile
    ? (() => {
        type Row = { guarded: boolean; landed?: boolean; held?: boolean };
        const g = read(guardFile) as { harms: Row[]; care: Row[]; threshold: number };
        const landedHarms = g.harms.filter((r) => r.guarded && r.landed);
        const landedCare = g.care.filter((r) => r.guarded && r.landed);
        return {
          file: guardFile,
          threshold: g.threshold,
          harms: g.harms.length,
          harmsWrote: g.harms.filter((r) => r.guarded).length,
          harmsLanded: landedHarms.length,
          harmsHeld: landedHarms.filter((r) => r.held).length,
          care: g.care.length,
          careLanded: landedCare.length,
          careHeld: landedCare.filter((r) => r.held).length,
        };
      })()
    : null,
};

writeFileSync(
  new URL('../public/proof.json', import.meta.url),
  JSON.stringify(out, null, 2) + '\n',
);
// The count is also written into the page itself, so it reads without JavaScript (curl, a reader).
const page = new URL('../public/proof.html', import.meta.url);
writeFileSync(
  page,
  readFileSync(page, 'utf8').replace(
    /<footer id="built">[^<]*<\/footer>/,
    `<footer id="built">${tests ? `${tests} automated tests pass.` : ''}</footer>`,
  ),
);
console.log(
  `public/proof.json written: corpus ${corpus}, dialects ${dialects}${guardFile ? `, guard ${guardFile}` : ''}`,
);
