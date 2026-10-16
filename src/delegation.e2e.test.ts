import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createCareCircleApp } from './http/app.ts';
import { CareStore } from './store/store.ts';
import { seedDemoHousehold, DEMO_TOKENS } from './demo/seed.ts';
import { seedScenario } from './demo/scenario.ts';

/**
 * The delegation loop, end to end over the real MCP wire.
 *
 * DETECT -> ASK -> DECLINE -> ASK NEXT -> ACCEPT -> OWNED.
 *
 * The domain tests prove the arithmetic; these prove the protocol actually moves
 * responsibility the way the product claims, including who is allowed to answer.
 */

let server: Server;
let base: string;
const store = new CareStore();

before(async () => {
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
  const app = createCareCircleApp({ store, tokens: new Map(Object.entries(DEMO_TOKENS)) });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const a = server.address();
      base = `http://localhost:${typeof a === 'object' && a ? a.port : 0}/mcp`;
      resolve();
    });
  });
});

// Each test gets the scenario back exactly as it was: the loop MOVES ownership,
// so a test that runs second would otherwise find the work already taken.
beforeEach(async () => {
  await store.reset();
  await seedDemoHousehold(store);
  await seedScenario(store, 'h_margaret');
});

after(() => {
  server?.close();
});

const HEADERS = (token?: string, sessionId?: string) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
  ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
});

async function openSession(token: string): Promise<string> {
  const res = await fetch(base, {
    method: 'POST',
    headers: HEADERS(token),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'loop', version: '1.0' },
      },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id')!;
  await res.text();
  await fetch(base, {
    method: 'POST',
    headers: HEADERS(token, sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  return sessionId;
}

async function call(
  token: string,
  sessionId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(base, {
    method: 'POST',
    headers: HEADERS(token, sessionId),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1e6),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return JSON.parse(await res.text());
}

const spoken = (b: any): string => b?.result?.content?.[0]?.text ?? '';
const structured = (b: any): any => b?.result?.structuredContent ?? {};

/** The unowned cardiology ride the scenario seeds. */
async function theRide(token: string, session: string): Promise<string> {
  const gaps = structured(await call(token, session, 'get_care_gaps')).gaps ?? [];
  const ride = gaps.find((g: any) => /eye check-up/i.test(g.spoken) && g.obligationId);
  assert.ok(ride, 'expected an unowned cardiology ride in the seeded scenario');
  return ride.obligationId;
}

test('the whole loop: ask, decline, ask the next person, accept', async () => {
  const renee = await openSession('renee-token');
  const david = await openSession('david-token');
  const id = await theRide('renee-token', renee);

  // ASK. Funmi asks Tolu.
  const asked = await call('renee-token', renee, 'request_owner', {
    obligationId: id,
    assigneeName: 'Tolu',
  });
  assert.match(spoken(asked), /asked Tolu/i);
  assert.match(spoken(asked), /stays unowned/i);
  assert.equal(structured(asked).status, 'REQUESTED');

  // It is STILL a care gap. Being asked is not being assigned.
  const midGaps = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  const still = midGaps.find((g: any) => g.obligationId === id);
  assert.ok(still, 'a pending request must remain a care gap');
  assert.match(still.spoken, /hasn't answered yet/i);

  // Tolu sees it as his to answer.
  const mine = await call('david-token', david, 'get_my_requests');
  assert.equal(structured(mine).requests.length, 1);
  assert.equal(structured(mine).requests[0].obligationId, id);

  // DECLINE. It goes back to unowned, and the loop proposes the next person.
  const declined = await call('david-token', david, 'respond_to_request', {
    obligationId: id,
    accepted: false,
    note: "I'm away Thursday",
  });
  assert.equal(structured(declined).declined, true);
  assert.match(spoken(declined), /no owner/i);
  assert.ok(structured(declined).nextCandidate, 'a decline should offer somebody next');

  // Tolu is not asked again.
  const reAsk = await call('renee-token', renee, 'request_owner', {
    obligationId: id,
    assigneeName: 'Tolu',
  });
  assert.match(spoken(reAsk), /already said no/i);

  // ACCEPT. Funmi asks herself? No - she claims. Ask Musa, who accepts.
  await call('renee-token', renee, 'request_owner', { obligationId: id, assigneeName: 'Musa' });
  const aide = await openSession('aide-token');
  const accepted = await call('aide-token', aide, 'respond_to_request', {
    obligationId: id,
    accepted: true,
  });
  assert.equal(structured(accepted).status, 'ASSIGNED');
  assert.match(spoken(accepted), /yours now/i);

  // And now it is genuinely owned: no longer a gap.
  const after = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  assert.ok(
    !after.some((g: any) => g.obligationId === id),
    'an accepted request should stop being a care gap',
  );
});

test('paid help hears what they were asked in their shift brief', async () => {
  // Musa cannot read the care gaps, so "yes, I can take him" only lands if his brief says what he was asked.
  const renee = await openSession('renee-token');
  const id = await theRide('renee-token', renee);
  await call('renee-token', renee, 'request_owner', { obligationId: id, assigneeName: 'Musa' });
  const aide = await openSession('aide-token');
  const brief = spoken(await call('aide-token', aide, 'get_shift_brief'));
  assert.match(brief, /Funmi asked if you can .*eye check-up.*You haven't answered yet/i);
});

test('only the person asked can answer for themselves', async () => {
  const renee = await openSession('renee-token');
  const david = await openSession('david-token');
  const id = await theRide('renee-token', renee);

  await call('renee-token', renee, 'request_owner', { obligationId: id, assigneeName: 'Musa' });
  // Tolu tries to accept on Musa's behalf. The system must not invent an
  // agreement that was never given.
  const stolen = await call('david-token', david, 'respond_to_request', {
    obligationId: id,
    accepted: true,
  });
  assert.match(spoken(stolen), /theirs to answer/i);

  const state = structured(await call('renee-token', renee, 'get_care_gaps')).gaps;
  assert.ok(
    state.some((g: any) => g.obligationId === id),
    'it must still be an open gap after a rejected answer',
  );
});

test('the person being cared for can ask for help herself', async () => {
  // Margaret is a participant, not a subject. She cannot assign, but she can ask.
  const renee = await openSession('renee-token');
  const id = await theRide('renee-token', renee);
  const margaret = await openSession('margaret-token');

  const asked = await call('margaret-token', margaret, 'request_owner', {
    obligationId: id,
    assigneeName: 'Tolu',
  });
  assert.match(spoken(asked), /asked Tolu/i);

  // But assigning is still beyond her.
  const assign = await call('margaret-token', margaret, 'assign_obligation', {
    obligationId: id,
    assigneeName: 'Tolu',
  });
  assert.match(spoken(assign), /primary caregiver/i);
});

test('even the primary caregiver giving work away only asks: it is theirs once they say yes', async () => {
  const david = await openSession('david-token');
  const renee = await openSession('renee-token');
  const id = await theRide('david-token', david);

  // Tolu, the primary caregiver, puts it on Funmi's name. The app asks her instead.
  const given = await call('david-token', david, 'assign_obligation', {
    obligationId: id,
    assigneeName: 'Funmi',
  });
  assert.match(spoken(given), /asked Funmi/i);
  assert.equal(structured(given).status, 'REQUESTED');
  assert.equal(structured(given).ownerId, null);
  assert.equal(store.getObligation(id, 'h_margaret').ownerId, null);

  // Nobody can answer for her, not even the person who gave it.
  const forHer = await call('david-token', david, 'respond_to_request', {
    obligationId: id,
    accepted: true,
  });
  assert.match(spoken(forHer), /theirs to answer/i);
  assert.equal(store.getObligation(id, 'h_margaret').ownerId, null);

  // Her own yes is what makes it hers.
  await call('renee-token', renee, 'respond_to_request', { obligationId: id, accepted: true });
  assert.equal(store.getObligation(id, 'h_margaret').ownerId, 'm_renee');
});

test('with no name given, the app picks someone and says why', async () => {
  const renee = await openSession('renee-token');
  const id = await theRide('renee-token', renee);
  const asked = await call('renee-token', renee, 'request_owner', { obligationId: id });
  assert.match(spoken(asked), /I picked \w+ because they're the one who has/i);
  assert.ok(structured(asked).askedOfId, 'it should have chosen somebody');
});
