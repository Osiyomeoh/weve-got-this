/**
 * Does any planner say Daddy missed his drops, when all the record shows is that nobody logged them?
 *
 *   npm run evals:blame                         Sonnet 4.5 (BEDROCK_MODEL_ID to change)
 *   npm run evals:blame -- --out <file.json>    and save every turn
 *   npm run evals:blame -- --held-out           the held-out questions instead
 *
 * Every case in src/evals/blame-pressure.ts is asked as a full turn, at 9:30 PM in Lagos with
 * the 8 PM eye drops unrecorded, through two loops over the same server, prompt, tools and model:
 *
 *   console   the hand-written loop in src/sim/host.ts, which relies on the prompt
 *   strands   a Strands Agent with the NoBlame plugin (src/strands), which checks every reply
 *
 * What is spoken is checked against the words CareCircle never says (src/domain/no-blame.ts).
 * Needs AWS credentials with Bedrock access. Each case gets a new in-memory family.
 */
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CareStore } from '../src/store/store.ts';
import { createCareCircleServer } from '../src/mcp/server.ts';
import { seedDemoHousehold } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { SimulatedAlexa } from '../src/sim/host.ts';
import { BedrockProvider } from '../src/sim/providers.ts';
import { StrandsAlexa, bedrockModel } from '../src/strands/host.ts';
import type { NoBlameReport } from '../src/strands/no-blame.ts';
import { BLAME, blameIn } from '../src/domain/no-blame.ts';
import {
  HELD_OUT_PRESSURE_CASES,
  PRESSURE_CASES,
  type PressureCase,
} from '../src/evals/blame-pressure.ts';

const NOW = new Date('2026-10-01T20:30:00Z'); // Thursday, 9:30 PM in Lagos
const now = () => NOW;
const modelId = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const region = process.env.AWS_REGION ?? 'us-east-1';
const outAt = process.argv.indexOf('--out');
const out = outAt > 0 ? process.argv[outAt + 1] : undefined;
const heldOut = process.argv.includes('--held-out');
const CASES = heldOut ? HELD_OUT_PRESSURE_CASES : PRESSURE_CASES;

type Loop = 'console' | 'strands';
interface Turn {
  id: string;
  loop: Loop;
  member: string;
  utterance: string;
  innocent?: true;
  spoken: string;
  blamed: string | null;
  tools: string[];
  noBlame?: NoBlameReport;
  error?: string;
}

async function family(member: string): Promise<InMemoryTransport> {
  const store = new CareStore();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret', { now: NOW });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createCareCircleServer({ store, actorId: member, now }).connect(serverSide);
  return clientSide;
}

const throttled = (err: unknown) => /throttl|too many|rate/i.test((err as Error).message ?? '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ask(c: PressureCase, loop: Loop): Promise<Turn> {
  const base = {
    id: c.id,
    loop,
    member: c.member,
    utterance: c.utterance,
    ...(c.innocent ? { innocent: true } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const transport = await family(c.member);
    try {
      if (loop === 'console') {
        const client = new Client({ name: 'blame-pressure', version: '1' });
        await client.connect(transport);
        const host = await SimulatedAlexa.over(
          client,
          new BedrockProvider({ region, modelId }),
          'voice',
          now,
        );
        const turn = await host.say(c.utterance);
        await host.close();
        return {
          ...base,
          spoken: turn.spoken,
          blamed: blameIn(turn.spoken),
          tools: turn.toolCalls.map((t) => t.name),
        };
      }
      const host = await StrandsAlexa.over(transport, {
        model: bedrockModel({ ...process.env, BEDROCK_MODEL_ID: modelId }),
        now,
      });
      const turn = await host.say(c.utterance);
      await host.close();
      return {
        ...base,
        spoken: turn.spoken,
        blamed: blameIn(turn.spoken),
        tools: turn.toolCalls.map((t) => t.name),
        noBlame: turn.noBlame,
      };
    } catch (err) {
      if (throttled(err) && attempt < 5) {
        await sleep(2_000 * 2 ** attempt);
        continue;
      }
      return { ...base, spoken: '', blamed: null, tools: [], error: (err as Error).message };
    }
  }
}

const turns: Turn[] = [];
for (const c of CASES) {
  for (const loop of ['console', 'strands'] as const) {
    const t = await ask(c, loop);
    turns.push(t);
    const mark = t.error
      ? 'ERR '
      : t.blamed
        ? 'BLAME'
        : t.noBlame?.caught.length
          ? 'held '
          : 'ok   ';
    console.log(
      `${mark} ${t.id} ${loop.padEnd(7)} ${t.error ?? t.spoken.replace(/\s+/g, ' ').slice(0, 140)}`,
    );
  }
}

const summary = (['console', 'strands'] as const).map((loop) => {
  const mine = turns.filter((t) => t.loop === loop && !t.error);
  return {
    loop,
    turns: mine.length,
    errored: turns.filter((t) => t.loop === loop && t.error).length,
    spokeBlame: mine.filter((t) => t.blamed).length,
    caughtByPlugin: mine.filter((t) => t.noBlame?.caught.length).length,
    correctedByModel: mine.filter((t) => t.noBlame?.corrected).length,
    replacedWithToolText: mine.filter((t) => t.noBlame?.replaced).length,
  };
});
console.log(
  `\nBlame under pressure · ${modelId} · ${CASES.length}${heldOut ? ' held-out' : ''} questions at 9:30 PM, 8 PM drops unrecorded`,
);
for (const s of summary) {
  console.log(
    `  ${s.loop.padEnd(8)} spoke blame ${s.spokeBlame}/${s.turns}` +
      (s.loop === 'strands'
        ? ` · plugin stopped ${s.caughtByPlugin} (model corrected ${s.correctedByModel}, replaced ${s.replacedWithToolText})`
        : '') +
      (s.errored ? ` · ${s.errored} errored` : ''),
  );
}
if (out) {
  writeFileSync(
    out,
    JSON.stringify(
      {
        modelId,
        set: heldOut ? 'held-out' : 'pressure',
        blameWords: BLAME.source,
        at: new Date().toISOString(),
        clock: NOW.toISOString(),
        summary,
        turns,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`\nSaved ${out}`);
}
