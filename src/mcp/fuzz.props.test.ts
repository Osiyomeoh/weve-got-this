import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CareStore } from '../store/store.ts';
import { createCareCircleServer } from './server.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';

/**
 * Every tool, called with thousands of generated arguments, the way a planner calls them on a
 * bad day: the right shape and the wrong one, real ids and made-up ones, a time in every format
 * a model writes, by every member of the family. Whatever comes in, these must hold:
 *
 *  - no crash:    the answer is a result, or the arguments refused; never an internal error
 *  - speakable:   every result has text, and none of it is "undefined", "NaN", "[object Object]",
 *                 "Invalid Date" or a stack trace, which a voice would read out
 *  - structured:  a success carries structured content (the server checks it against the
 *                 tool's output schema on every call, and the client checks it again)
 *  - no blame:    nothing says someone missed something or did not take it; an absent record
 *                 is not evidence (the server's first instruction)
 *
 * FUZZ_RUNS sets the calls per tool (default 150, so about 4,000 calls in all).
 */

const RUNS = Number(process.env.FUZZ_RUNS ?? 150);
const store = new CareStore();
const clients = new Map<string, Client>();
let tools: { name: string; inputSchema: JsonSchema }[] = [];
let ids: string[] = [];

interface JsonSchema {
  type?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}

before(async () => {
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  for (const actorId of Object.values(DEMO_TOKENS)) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createCareCircleServer({ store, actorId }).connect(serverSide);
    const client = new Client({ name: 'fuzz', version: '1' });
    await client.connect(clientSide);
    clients.set(actorId, client);
  }
  tools = (await clients.get('m_david')!.listTools()).tools as typeof tools;
  const state = store.getCareState('h_margaret');
  ids = [
    ...state.obligations.map((o) => o.id),
    ...state.members.map((m) => m.id),
    ...state.medications.map((m) => m.id),
    ...state.events.slice(-5).map((e) => e.id),
  ];
});
after(async () => { for (const c of clients.values()) await c.close(); });

/** Words a family uses. None of them blames anyone, so "no blame" tests the server, not us. */
const WORDS = [
  'Daddy', 'Dad', 'Mom', 'Margaret', 'David', 'Renee', 'Kunle', 'Funmi', 'Tolu', 'eye drops',
  'pain medication', 'heart pill', 'check-up', 'clinic', 'pharmacy', 'refill', 'ride', 'Thursday',
  'tomorrow', 'tonight', 'at 8', 'took', 'gave', 'done', 'pick up', 'drive', 'groceries', 'is',
  'he', 'she', 'his', 'the', 'to', 'okay', 'tired', 'slept well', 'ọ̀la', 'ó ti lo', '爸爸', 'mañana',
];
const NOW = Date.now();
const H = 3_600_000;
const iso = fc.integer({ min: -60 * 24, max: 60 * 24 }).map((h) => new Date(NOW + h * H).toISOString());

/** Strings as a planner fills them: sentences, names, real and made-up ids, times, and junk. */
const text: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: fc.array(fc.constantFrom(...WORDS), { minLength: 1, maxLength: 8 }).map((w) => w.join(' ')) },
  { weight: 3, arbitrary: fc.nat().map((i) => ids[i % ids.length] ?? 'o_1') },
  { weight: 2, arbitrary: fc.constantFrom('Dad', 'Daddy', 'Mom', 'Renee', 'Kunle', 'David', 'Funmi', 'nobody', 'me') },
  { weight: 3, arbitrary: iso },
  { weight: 2, arbitrary: iso.map((s) => s.slice(0, 19)) },
  { weight: 1, arbitrary: iso.map((s) => s.slice(0, 10)) },
  { weight: 1, arbitrary: iso.map((s) => s.slice(0, 19) + '+01:00') },
  { weight: 1, arbitrary: fc.constantFrom('', ' ', 'tomorrow', '25:99', '2026-02-30T10:00', 'o_does_not_exist', 'null', '0') },
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 30 }) },
  { weight: 1, arbitrary: fc.constant('x'.repeat(5_000)) },
);

/** A value for a schema; now and then the wrong type, which a planner also sends. */
function value(s: JsonSchema, depth = 0): fc.Arbitrary<unknown> {
  const right = rightValue(s, depth);
  const wrong = fc.oneof(fc.constant(null), fc.integer(), fc.boolean(), text, fc.constant({}), fc.constant([]));
  return fc.oneof({ weight: 12, arbitrary: right }, { weight: 1, arbitrary: wrong });
}

function rightValue(s: JsonSchema, depth: number): fc.Arbitrary<unknown> {
  if (s.enum) return fc.constantFrom(...s.enum);
  switch (s.type) {
    case 'string': return text;
    case 'boolean': return fc.boolean();
    case 'integer':
    case 'number': {
      const min = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : -5);
      const max = s.maximum ?? Math.max(min + 100, 100);
      const inRange = s.type === 'integer' ? fc.integer({ min, max }) : fc.double({ min, max, noNaN: true });
      return fc.oneof({ weight: 5, arbitrary: inRange }, { weight: 1, arbitrary: fc.constantFrom(-1, 0, 1e9, 0.5) });
    }
    case 'array': return fc.array(s.items && depth < 3 ? value(s.items, depth + 1) : text, { maxLength: 4 });
    case 'object': return args(s, depth + 1);
    default: return text;
  }
}

/** Arguments: required ones nearly always there, optional ones sometimes, now and then a stray. */
function args(s: JsonSchema, depth = 0): fc.Arbitrary<Record<string, unknown>> {
  const props = Object.entries(s.properties ?? {});
  const required = new Set(s.required ?? []);
  const fields = props.map(([key, sub]) =>
    fc.oneof(
      { weight: required.has(key) ? 20 : 5, arbitrary: value(sub, depth).map((v) => [key, v] as const) },
      { weight: required.has(key) ? 1 : 5, arbitrary: fc.constant(null) },
    ));
  return fc.tuple(fc.tuple(...fields), fc.option(text, { freq: 15 })).map(([pairs, stray]) => {
    const out: Record<string, unknown> = Object.fromEntries(pairs.filter((p) => p !== null));
    if (stray !== null) out['inventedArgument'] = stray;
    return out;
  });
}

const LEAKS = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|TypeError|ReferenceError|Cannot read prop|is not a function|\n\s+at .+:\d+:\d+/;
const BLAME = /\bmissed\b|\bskipped\b|\bforgot\b|\bdid(?:n['’]t| not) take\b|\bhas(?:n['’]t| not) taken\b|\bfailed to take\b/i;
const ACTORS = Object.values(DEMO_TOKENS);

test('every tool holds under generated arguments from every member', async (t) => {
  assert.ok(tools.length >= 20, 'the server lists its tools');
  let calls = 0;
  for (const tool of tools) {
    await t.test(tool.name, async () => {
      await fc.assert(fc.asyncProperty(fc.constantFrom(...ACTORS), args(tool.inputSchema), async (actor, input) => {
        calls++;
        let out;
        try {
          out = await clients.get(actor)!.callTool({ name: tool.name, arguments: input });
        } catch (err) {
          // The SDK refusing arguments outright is a clean answer; anything else is a crash.
          const code = (err as { code?: number }).code;
          assert.equal(code, -32602, `${tool.name} threw ${String(err)}`);
          return;
        }
        const parts = (out.content ?? []) as { type: string; text?: string }[];
        const spoken = parts.map((p) => p.text ?? '').join(' ');
        assert.ok(spoken.trim(), `${tool.name} answered with no text`);
        // The SDK turned the arguments away against the schema, before any handler ran: the
        // planner reads that, not the family.
        if (out.isError === true && spoken.startsWith('MCP error -32602')) return;
        assert.doesNotMatch(spoken, LEAKS, `${tool.name} said: ${spoken.slice(0, 300)}`);
        if (out.isError !== true) {
          assert.ok(out.structuredContent, `${tool.name} succeeded without structured content`);
          assert.doesNotMatch(JSON.stringify(out.structuredContent), /"Invalid Date"|NaN/);
        }
        // Input text can't put these words in: none of the generated words blame anyone.
        assert.doesNotMatch(spoken, BLAME, `${tool.name} blamed someone: ${spoken.slice(0, 300)}`);
      }), { numRuns: RUNS });
    });
  }
  t.diagnostic(`${calls} tool calls`);
});

/**
 * The promise the server makes first: it only knows what was recorded, and never says anyone
 * missed anything. Over days of random use (writes from every member, the clock running on
 * through the night and past doses that were never logged), the three tools a family asks
 * "is he okay?" through must hold to it after every step, and never read out a broken value.
 *
 * TRUST_RUNS sets the households (default 150, each up to 14 steps and 3 reads per step).
 */
const TRUST_RUNS = Number(process.env.TRUST_RUNS ?? 150);
const READS = ['get_care_summary', 'get_care_gaps', 'get_shift_brief'];

test('no read says anyone missed anything, across days of random use', async (t) => {
  const writes = tools.filter((x) => !(x as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint
    && !['create_household', 'remove_member'].includes(x.name));
  assert.ok(writes.length >= 15, 'the server lists its write tools');
  const step = fc.oneof(
    { weight: 3, arbitrary: fc.record({ hours: fc.integer({ min: 1, max: 30 }) }) },
    {
      weight: 5,
      arbitrary: fc.constantFrom(...writes).chain((w) =>
        fc.record({ tool: fc.constant(w.name), actor: fc.constantFrom(...ACTORS), input: args(w.inputSchema) })),
    },
  );
  // Any hour of any day of the year: the record is read at 3 AM as well as at noon.
  const start = fc.integer({ min: 0, max: 365 * 24 }).map((h) => new Date(Date.UTC(2026, 0, 1) + h * H));
  let calls = 0;
  let gaps = 0;
  await fc.assert(fc.asyncProperty(start, fc.array(step, { minLength: 1, maxLength: 14 }), fc.constantFrom(...ACTORS), async (from, steps, reader) => {
    let clock = from.getTime();
    const local = new CareStore();
    await seedDemoHousehold(local);
    await seedScenario(local, 'h_margaret', { now: new Date(clock) });
    const open = new Map<string, Client>();
    for (const actorId of ACTORS) {
      const [c, s] = InMemoryTransport.createLinkedPair();
      await createCareCircleServer({ store: local, actorId, now: () => new Date(clock) }).connect(s);
      const client = new Client({ name: 'trust', version: '1' });
      await client.connect(c);
      open.set(actorId, client);
    }
    try {
      for (const s of steps) {
        if ('hours' in s) clock += s.hours * H;
        else await open.get(s.actor)!.callTool({ name: s.tool, arguments: s.input }).catch(() => undefined);
        for (const name of READS) {
          calls++;
          const out = await open.get(reader)!.callTool({ name, arguments: {} });
          const spoken = ((out.content ?? []) as { text?: string }[]).map((p) => p.text ?? '').join(' ');
          assert.ok(spoken.trim(), `${name} said nothing`);
          assert.doesNotMatch(spoken, LEAKS, `${name} said: ${spoken.slice(0, 400)}`);
          assert.doesNotMatch(spoken, BLAME, `${name} blamed someone: ${spoken.slice(0, 400)}`);
          if (/no record/i.test(spoken)) gaps++;
        }
      }
    } finally {
      for (const c of open.values()) await c.close();
    }
  }), { numRuns: TRUST_RUNS });
  // Not vacuous: the reads did meet doses with no record, and said so without blame.
  assert.ok(gaps > calls / 20, `only ${gaps} of ${calls} reads spoke of a gap`);
  t.diagnostic(`${calls} reads, ${gaps} of them about a dose with no record`);
});
