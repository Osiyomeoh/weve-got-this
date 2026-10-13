import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../demo/seed.ts';
import { seedScenario } from '../demo/scenario.ts';
import { sandboxCreatedAt, sandboxSuffix, sweepSandboxes } from './sandbox.ts';

/**
 * Per-visitor sandboxes. Judges try the live demo at the same time; each must get the
 * story from the start, and no judge's actions may reach another judge, the real demo
 * household, or a real family.
 */

const KEY = 'test-sandbox-key';
const store = new CareStore();
let server: Server;
let base: string;

before(async () => {
  process.env['CARECIRCLE_OAUTH_SECRET'] = 'test-oauth-secret';
  process.env['CARECIRCLE_PUBLIC_URL'] = 'http://localhost';
  process.env['CARECIRCLE_SANDBOX_KEY'] = KEY;
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}`;
      resolve();
    });
  });
});

after(() => {
  server?.close();
  delete process.env['CARECIRCLE_OAUTH_SECRET'];
  delete process.env['CARECIRCLE_PUBLIC_URL'];
  delete process.env['CARECIRCLE_SANDBOX_KEY'];
});

async function create(key = KEY, body?: object): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}/sandbox`, {
    method: 'POST',
    headers: { 'x-sandbox-key': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

/** Open an MCP session with a bearer token and call one tool. */
async function callTool(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
  extra: Record<string, string> = {},
): Promise<any> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    ...extra,
  };
  const parse = async (r: Response) => {
    const t = await r.text();
    const line = t.split('\n').find((l) => l.startsWith('data:'));
    return JSON.parse(line ? line.slice(5) : t);
  };
  const init = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    }),
  });
  assert.equal(init.status, 200);
  headers['mcp-session-id'] = init.headers.get('mcp-session-id')!;
  await init.text();
  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  const out = await parse(
    await fetch(`${base}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }),
  );
  return out.result;
}

test('without the key, nobody can create a sandbox', async () => {
  assert.equal((await create('wrong')).status, 401);
  assert.equal((await create('')).status, 401);
});

test('a sandbox is a fresh copy of the demo story, reachable with its own tokens', async () => {
  const { status, json } = await create();
  assert.equal(status, 201);
  assert.match(json.householdId, /^h_margaret~/);
  assert.deepEqual(Object.keys(json.tokens).sort(), [
    'm_aide',
    'm_david',
    'm_kunle',
    'm_margaret',
    'm_renee',
  ]);

  const gaps = await callTool(json.tokens.m_david, 'get_care_gaps');
  assert.match(gaps.content[0].text, /Take Daddy to his eye check-up/);
  assert.ok(
    gaps.structuredContent.gaps.every(
      (g: { obligationId?: string }) =>
        !g.obligationId || store.getObligation(g.obligationId, json.householdId),
    ),
  );
});

test('a copy for the 3D world leaves the morning eye drops for the visitor to log', async () => {
  const eyeDrops = (hh: string) =>
    store
      .getCareState(hh)
      .events.filter(
        (e) =>
          e.kind === 'medication_taken' &&
          (e.data as { medicationName?: string }).medicationName === 'eye drops',
      );
  const usual = (await create()).json;
  assert.equal(eyeDrops(usual.householdId).length, 1, 'the console copy has the 8:10 dose');
  const world = (await create(KEY, { liveMorning: true })).json;
  assert.equal(
    eyeDrops(world.householdId).length,
    0,
    'the world copy does not: Daddy logs it at 7:42',
  );
  assert.ok(
    store.getCareState(world.householdId).events.some((e) => e.kind === 'medication_taken'),
    'the supplement is still there, so the morning is not reported as missed',
  );
});

test('a copy can be of a simulated family: memory loss or a wheelchair, same ids, their own words', async () => {
  const recipient = (hh: string) =>
    store.getCareState(hh).members.find((m) => m.role === 'care_recipient')!;
  const memory = (await create(KEY, { careCase: 'memory' })).json;
  assert.equal(recipient(memory.householdId).spokenAs, 'Mama');
  assert.deepEqual(recipient(memory.householdId).attributes, { requiresAssistance: true });
  assert.ok(
    store.getCareState(memory.householdId).obligations.some((o) => /memory clinic/.test(o.what)),
  );

  const chair = (await create(KEY, { careCase: 'wheelchair', liveMorning: true })).json;
  assert.equal(recipient(chair.householdId).spokenAs, 'Baba');
  assert.equal(
    recipient(chair.householdId).id,
    `m_margaret${chair.suffix}`,
    'ids are the same in every case',
  );
  const gaps = await callTool(chair.tokens.m_david, 'get_care_gaps');
  assert.ok(
    gaps.structuredContent.gaps.some((g: { spoken: string }) => /physiotherapy/.test(g.spoken)),
  );

  const odd = (await create(KEY, { careCase: 'not-a-case' })).json;
  assert.equal(
    recipient(odd.householdId).spokenAs,
    'Daddy',
    'an unknown case is the real story, not an error',
  );
});

test('a hometown copy: Mummy in Abeokuta, Bisi next door, and children who live in Lagos', async () => {
  const c = (await create(KEY, { careCase: 'hometown', liveMorning: true })).json;
  const members = store.getCareState(c.householdId).members;
  const by = (id: string) => members.find((m) => m.id === `${id}${c.suffix}`)!;
  assert.equal(by('m_margaret').spokenAs, 'Mummy');
  assert.equal(by('m_aide').name, 'Bisi');
  assert.equal(by('m_david').livesAway, 'Lagos');
  assert.equal(by('m_renee').livesAway, 'Lagos');
  assert.equal(by('m_aide').livesAway, undefined, 'the neighbour is there');
  const gaps = await callTool(c.tokens.m_david, 'get_care_gaps');
  assert.ok(
    gaps.structuredContent.gaps.some((g: { spoken: string }) => /hospital check-up/.test(g.spoken)),
  );
});

test('an American copy: Mom in Dayton on Eastern time, Mike nearby, Sarah in Chicago, Jen and Tom further still', async () => {
  const c = (await create(KEY, { careCase: 'us', liveMorning: true })).json;
  const s = store.getCareState(c.householdId);
  const by = (id: string) => s.members.find((m) => m.id === `${id}${c.suffix}`)!;
  assert.equal(s.household.timezone, 'America/New_York');
  assert.equal(by('m_margaret').spokenAs, 'Mom');
  assert.deepEqual([by('m_david').name, by('m_david').livesAway], ['Sarah', 'Chicago']);
  assert.deepEqual([by('m_renee').name, by('m_renee').livesAway], ['Jen', 'Seattle']);
  assert.deepEqual([by('m_kunle').name, by('m_kunle').livesAway], ['Tom', 'Phoenix']);
  assert.equal(by('m_aide').name, 'Mike');
  assert.equal(by('m_aide').livesAway, undefined, 'her son is fifteen minutes away');
  // Ten, two days from now, is ten in Dayton, not in Lagos.
  const ride = s.obligations.find((o) => /cardiology/.test(o.what))!;
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(ride.dueAt!));
  const twoDaysOn = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
  }).format(Date.now() + 2 * 86_400_000);
  assert.equal(local.replace(',', ''), `${twoDaysOn} 10`);
  const gaps = await callTool(c.tokens.m_david, 'get_care_gaps');
  assert.ok(
    gaps.structuredContent.gaps.some((g: { spoken: string }) => /cardiology/.test(g.spoken)),
  );
});

test('a family abroad, and a Kenyan family: the children far away, the one nearby asked, each clock its own', async () => {
  const a = (await create(KEY, { careCase: 'abroad', liveMorning: true })).json;
  const s = store.getCareState(a.householdId);
  const by = (id: string) => s.members.find((m) => m.id === `${id}${a.suffix}`)!;
  assert.equal(s.household.timezone, 'Africa/Lagos');
  assert.deepEqual([by('m_david').name, by('m_david').livesAway], ['Tolu', 'London']);
  assert.deepEqual([by('m_renee').name, by('m_renee').livesAway], ['Funmi', 'Toronto']);
  assert.deepEqual([by('m_aide').name, by('m_aide').livesAway], ['Segun', undefined]);

  const k = (await create(KEY, { careCase: 'ke', liveMorning: true })).json;
  const t = store.getCareState(k.householdId);
  const kb = (id: string) => t.members.find((m) => m.id === `${id}${k.suffix}`)!;
  assert.equal(t.household.timezone, 'Africa/Nairobi');
  assert.equal(kb('m_margaret').spokenAs, 'Mum');
  assert.deepEqual([kb('m_david').name, kb('m_david').livesAway], ['Wanjiru', 'Nairobi']);
  assert.deepEqual([kb('m_kunle').name, kb('m_kunle').livesAway], ['Mwangi', 'Dubai']);
  assert.equal(kb('m_aide').name, 'Njeri');
  const ride = t.obligations.find((o) => /diabetes clinic/.test(o.what))!;
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(ride.dueAt!));
  const twoDaysOn = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
  }).format(Date.now() + 2 * 86_400_000);
  assert.equal(local.replace(',', ''), `${twoDaysOn} 10`);
});

test("make it yours: a copy carries the visitor's own names, and odd ones are refused", async () => {
  const names = {
    recipient: 'Mum',
    primary: 'Ada',
    caregiver: 'Tolu',
    away: 'Chidi',
    helper: 'Sarah',
  };
  const c = (await create(KEY, { careCase: 'us', liveMorning: true, names })).json;
  const s = store.getCareState(c.householdId);
  const by = (id: string) => s.members.find((m) => m.id === `${id}${c.suffix}`)!;
  assert.equal(s.household.name, "Mum's care circle");
  assert.deepEqual([by('m_margaret').name, by('m_margaret').spokenAs], ['Mum', 'Mum']);
  // Renamed all at once: the visitor's "Tolu" is the caregiver, never renamed again.
  assert.deepEqual(
    [by('m_david').name, by('m_renee').name, by('m_kunle').name, by('m_aide').name],
    ['Ada', 'Tolu', 'Chidi', 'Sarah'],
  );
  assert.equal(by('m_david').livesAway, 'Chicago', 'the case still decides where people live');
  assert.ok(s.obligations.some((o) => o.what === 'Drive Mum to her cardiology follow-up'));
  assert.ok(!JSON.stringify(s).includes('Mom'), "no trace of the case's own names");

  for (const bad of [
    { ...names, helper: 'Ada' },
    { ...names, away: '<script>' },
    { ...names, away: 'x'.repeat(40) },
    { ...names, extra: 'Bob' },
    { recipient: 'Mum' },
  ]) {
    const d = (await create(KEY, { careCase: 'us', names: bad })).json;
    const m = store
      .getCareState(d.householdId)
      .members.find((x) => x.id === `m_margaret${d.suffix}`)!;
    assert.equal(m.spokenAs, 'Mom', `refused: ${JSON.stringify(bad)}`);
  }
});

test('a press on the Fire TV remote is still her word: recorded as pressed on the TV, reported not observed', async () => {
  const c = (await create(KEY, { careCase: 'hometown', liveMorning: true })).json;
  await callTool(
    c.tokens.m_margaret,
    'log_care_event',
    { kind: 'medication_taken', medicationName: 'blood pressure tablet' },
    { 'x-carecircle-channel': 'tv' },
  );
  await callTool(c.tokens.m_margaret, 'log_care_event', { kind: 'check_in', detail: 'said aloud' });
  const events = store.getCareState(c.householdId).events;
  const pressed = events.find(
    (e) =>
      e.kind === 'medication_taken' &&
      (e.data as { medicationName?: string }).medicationName === 'blood pressure tablet',
  )!;
  assert.equal(pressed.source, 'tv');
  assert.equal(
    pressed.reportedBy,
    `m_margaret${c.suffix}`,
    'the channel never changes who said it',
  );
  const spoken = events.filter(
    (e) => e.source === 'voice' && e.reportedBy === `m_margaret${c.suffix}`,
  );
  assert.ok(spoken.length >= 1, 'without the header it is spoken');

  const odd = await callTool(
    c.tokens.m_margaret,
    'log_care_event',
    { kind: 'check_in', detail: 'x' },
    { 'x-carecircle-channel': 'ring' },
  );
  assert.ok(!odd.isError);
  assert.ok(
    !store
      .getCareState(c.householdId)
      .events.some(
        (e) => e.source === ('ring' as string) && e.reportedBy === `m_margaret${c.suffix}`,
      ),
    'only "tv" is a channel; anything else is spoken',
  );
});

test('"I can\'t do Thursday" from someone who was asked names the request and asks; it never answers for them', async () => {
  const c = (await create(KEY, { careCase: 'wheelchair' })).json;
  const ride = store
    .getCareState(c.householdId)
    .obligations.find((o) => /physiotherapy/.test(o.what))!;
  await callTool(c.tokens.m_david, 'request_owner', {
    obligationId: ride.id,
    assigneeName: 'Musa',
  });
  const out = await callTool(c.tokens.m_aide, 'add_note', {
    note: "I can't do Thursday, my car can't take the wheelchair",
    // A day off from the ride's own day, as a planner may get it: still asked about.
    unavailable: { memberName: 'Musa', from: '2030-01-01T00:00:00', to: '2030-01-01T23:59:59' },
  });
  assert.match(
    out.content[0].text,
    /Tolu asked if you can take Baba to physiotherapy.*Is that a no\?/,
  );
  assert.deepEqual(
    out.structuredContent.unanswered.map((u: { obligationId: string }) => u.obligationId),
    [ride.id],
  );
  assert.equal(
    store.getObligation(ride.id, c.householdId).status,
    'REQUESTED',
    'still theirs to answer',
  );
});

test('a no moves the loop on: the gap says who said no, and the next ask is never the asker', async () => {
  const c = (await create(KEY, { careCase: 'wheelchair' })).json;
  const ride = store
    .getCareState(c.householdId)
    .obligations.find((o) => /physiotherapy/.test(o.what))!;
  await callTool(c.tokens.m_david, 'request_owner', {
    obligationId: ride.id,
    assigneeName: 'Musa',
  });
  const no = await callTool(c.tokens.m_aide, 'respond_to_request', {
    obligationId: ride.id,
    accepted: false,
    note: "my car can't take the chair",
  });
  assert.match(no.content[0].text, /back with no owner: take Baba to physiotherapy/);
  assert.notEqual(
    no.structuredContent.nextCandidate,
    'Tolu',
    'Tolu asked; Tolu is not who to ask next',
  );
  const gaps = await callTool(c.tokens.m_david, 'get_care_gaps');
  const gap = gaps.structuredContent.gaps.find(
    (g: { obligationId?: string }) => g.obligationId === ride.id,
  );
  assert.match(gap.spoken, /nobody has taken this yet; Musa said no\./);
});

test('one judge taking the ride does not take it for the next judge, or the real demo', async () => {
  const a = (await create()).json;
  const b = (await create()).json;

  const gapsA = await callTool(a.tokens.m_renee, 'get_care_gaps');
  const ride = gapsA.structuredContent.gaps.find((g: { spoken: string }) =>
    /eye check-up/.test(g.spoken),
  );
  await callTool(a.tokens.m_renee, 'claim_obligation', { obligationId: ride.obligationId });

  const rideIn = (hh: string) =>
    store.getCareState(hh).obligations.find((o) => /eye check-up/.test(o.what))!;
  assert.equal(rideIn(a.householdId).ownerId, `m_renee${a.suffix}`);
  assert.equal(rideIn(b.householdId).ownerId, null, 'the next judge still sees it unowned');
  assert.equal(rideIn('h_margaret').ownerId, null, 'the real demo household is untouched');
});

test("attack: a sandbox token cannot act on another household's obligation", async () => {
  const a = (await create()).json;
  const real = store
    .getCareState('h_margaret')
    .obligations.find((o) => /eye check-up/.test(o.what))!;
  await callTool(a.tokens.m_renee, 'claim_obligation', { obligationId: real.id });
  assert.equal(store.getObligation(real.id, 'h_margaret').ownerId, null);
});

test('the sweeper removes only expired sandboxes, oldest first at the cap, never a real household', async () => {
  const s = new CareStore();
  await seedDemoHousehold(s);
  await s.addHousehold({ id: 'h_real_family', name: 'real', timezone: 'Africa/Lagos' });
  const t0 = new Date('2026-09-23T00:00:00Z');
  const make = async (at: Date) => {
    const suffix = sandboxSuffix(at);
    await seedDemoHousehold(s, { suffix });
    return `h_margaret${suffix}`;
  };
  const old = await make(t0);
  const mid = await make(new Date(t0.getTime() + 3600_000));
  const fresh = await make(new Date(t0.getTime() + 2 * 3600_000));
  assert.ok(sandboxCreatedAt(old)! < sandboxCreatedAt(fresh)!);

  // 13h after t0 with a 12h TTL: only the oldest has expired.
  await sweepSandboxes(s, {
    ttlMs: 12 * 3600_000,
    keepAtMost: 10,
    now: new Date(t0.getTime() + 13 * 3600_000),
  });
  assert.deepEqual(s.householdIds().sort(), ['h_margaret', 'h_real_family', fresh, mid].sort());

  // At a cap of one, the older live copy goes and the newest stays.
  await sweepSandboxes(s, {
    ttlMs: 12 * 3600_000,
    keepAtMost: 1,
    now: new Date(t0.getTime() + 3 * 3600_000),
  });
  assert.deepEqual(s.householdIds().sort(), ['h_margaret', 'h_real_family', fresh].sort());
});

test('a real household id is never mistaken for a sandbox', () => {
  assert.equal(sandboxCreatedAt('h_margaret'), null);
  assert.equal(sandboxCreatedAt('h_0c7a1c1e-2b1d-4c5e-9a55-1f1e2d3c4b5a'), null);
  assert.equal(sandboxCreatedAt('h_other~abc-12345678'), null, 'only copies of the demo household');
});
