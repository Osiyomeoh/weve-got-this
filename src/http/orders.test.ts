import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';
import { RecordOnlyNotifier } from '../notify/notifier.ts';

/**
 * Ordering in, through the real SDK client. Nothing is bought: the order is placed wherever
 * the family shops, and this records who ordered it and whether it reached Dad. Clock pinned
 * to 10 AM in Lagos on a Thursday; Kunle lives in Houston.
 */

let server: Server | undefined;
afterEach(() => server?.close());
const NOW = new Date('2026-09-24T09:00:00Z');
let clock = NOW;
afterEach(() => {
  clock = NOW;
});

async function family() {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'Dad care circle', timezone: 'Africa/Lagos' });
  await store.addMember({
    id: 'm_dad',
    householdId: 'h',
    name: 'Pius',
    role: 'care_recipient',
    spokenAs: 'Dad',
  });
  await store.addMember({ id: 'm_sam', householdId: 'h', name: 'Sam', role: 'primary_caregiver' });
  await store.addMember({ id: 'm_sandra', householdId: 'h', name: 'Sandra', role: 'caregiver' });
  await store.addMember({
    id: 'm_kunle',
    householdId: 'h',
    name: 'Kunle',
    role: 'caregiver',
    livesAway: 'Houston',
  });
  const app = createCareCircleApp({
    store,
    notifier: new RecordOnlyNotifier(),
    now: () => clock,
    tokens: new Map([
      ['sam', 'm_sam'],
      ['dad', 'm_dad'],
      ['sandra', 'm_sandra'],
      ['kunle', 'm_kunle'],
    ]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp`;
  const use = async (token: string, name: string, args: Record<string, unknown> = {}) => {
    const c = new Client({ name: 't', version: '1' });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(base), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    try {
      await c.listTools();
      const out = await c.callTool({ name, arguments: args });
      return {
        isError: out.isError === true,
        text: (out.content as { text: string }[]).map((p) => p.text).join(' '),
        structured: out.structuredContent as Record<string, unknown> | undefined,
      };
    } finally {
      await c.close();
    }
  };
  const order = (token: string, args: Record<string, unknown>) => use(token, 'record_order', args);
  await use('sam', 'set_routine', {
    what: 'Bring Dad lunch',
    area: 'meal',
    times: ['13:00'],
    orderFrom: "Mama Titi's kitchen",
  });
  const work = (what: string) => store.getCareState('h').obligations.find((o) => o.what === what);
  return { store, use, order, work };
}

test('a routine says where it can be ordered from, without buying anything', async () => {
  const { store } = await family();
  const set = store.getCareState('h').events.find((e) => e.kind === 'routine_set')!;
  assert.equal(set.data['orderFrom'], "Mama Titi's kitchen");
});

test('"I ordered Dad\'s lunch from Houston, it\'ll be there at one": on Kunle, and someone nearby takes it in', async () => {
  const { order, work } = await family();
  const r = await order('kunle', { obligationId: 'Bring Dad lunch', arrives: '13:00' });
  assert.equal(r.isError, false, r.text);
  assert.equal(
    r.text,
    `Noted - you ordered "Bring Dad lunch" from Mama Titi's kitchen, due today at 1 PM. It's on your name until someone says it reached Dad. Since you're away, I'll ask someone nearby to take it in.`,
  );
  const lunch = work('Bring Dad lunch')!;
  assert.equal(lunch.status, 'ASSIGNED');
  assert.equal(lunch.ownerId, 'm_kunle');
  const takeIn = work("Take the delivery from Mama Titi's kitchen in to Dad")!;
  assert.equal(takeIn.status, 'OPEN');
  assert.equal(takeIn.dueAt, '2026-09-24T12:00:00.000Z');
  assert.deepEqual(r.structured, {
    obligationId: lunch.id,
    orderId: r.structured?.['orderId'],
    takeInId: takeIn.id,
  });
});

test('"ask Sandra to take it in", said about the lunch he ordered: she is asked about the delivery', async () => {
  const { use, order, work } = await family();
  await order('kunle', { obligationId: 'Bring Dad lunch', arrives: '13:00' });
  const lunch = work('Bring Dad lunch')!;
  const asked = await use('kunle', 'request_owner', {
    obligationId: lunch.id,
    assigneeName: 'Sandra',
  });
  assert.equal(asked.isError, false, asked.text);
  assert.match(
    asked.text,
    /^I've asked Sandra whether they can take the delivery from Mama Titi's/,
  );
  const takeIn = work("Take the delivery from Mama Titi's kitchen in to Dad")!;
  assert.equal(takeIn.status, 'REQUESTED');
  assert.equal(takeIn.request?.askedOfId, 'm_sandra');
  assert.equal(work('Bring Dad lunch')!.ownerId, 'm_kunle', 'the lunch stays on his name');
});

test('"done, I took the lunch in", said about the lunch by whoever is taking it in: the taking in closes, and the lunch with it', async () => {
  const { use, order, work } = await family();
  await order('kunle', { obligationId: 'Bring Dad lunch', arrives: '13:00' });
  const takeIn = work("Take the delivery from Mama Titi's kitchen in to Dad")!;
  await use('sandra', 'claim_obligation', { obligationId: takeIn.id });
  clock = new Date('2026-09-24T11:58:00Z');
  const done = await use('sandra', 'resolve_obligation', {
    obligationId: work('Bring Dad lunch')!.id,
  });
  assert.equal(done.isError, false, done.text);
  assert.equal(
    done.text,
    `Marked done - Take the delivery from Mama Titi's kitchen in to Dad. That closes "Bring Dad lunch" too.`,
  );
  assert.equal(work("Take the delivery from Mama Titi's kitchen in to Dad")!.status, 'RESOLVED');
  assert.equal(work('Bring Dad lunch')!.resolutionNote, 'Sandra took the delivery in');
});

test('said as the thing ordered, with nothing on the board for it: it goes on as theirs', async () => {
  const { order, work } = await family();
  const r = await order('sandra', {
    what: 'Groceries for Dad',
    from: 'the market app',
    arrives: '16:00',
  });
  assert.equal(
    r.text,
    `Noted - you ordered "Groceries for Dad" from the market app, due today at 4 PM. It's on your name until someone says it reached Dad.`,
  );
  const groceries = work('Groceries for Dad')!;
  assert.equal(groceries.ownerId, 'm_sandra');
  assert.equal(groceries.consequence, 'logistical');
  assert.equal(groceries.dueAt, '2026-09-24T15:00:00.000Z');
});

test('work someone else already has stays theirs; the order is only noted on it', async () => {
  const { use, order, work } = await family();
  const lunch = work('Bring Dad lunch')!;
  await use('sandra', 'claim_obligation', { obligationId: lunch.id });
  const r = await order('kunle', { obligationId: lunch.id });
  assert.equal(
    r.text,
    `Noted - you ordered "Bring Dad lunch" from Mama Titi's kitchen. Sandra has it, so it stays with them until it reaches Dad.`,
  );
  assert.equal(work('Bring Dad lunch')!.ownerId, 'm_sandra');
  assert.equal(r.structured?.['takeInId'], null);
});

test('ordered twice, already done, or ordered by Dad himself: said, not recorded', async () => {
  const { use, order, work, store } = await family();
  const lunch = work('Bring Dad lunch')!;
  const dad = await order('dad', { obligationId: lunch.id });
  assert.equal(dad.isError, true);

  await order('kunle', { obligationId: lunch.id, arrives: '13:00' });
  const twice = await order('sandra', { obligationId: lunch.id });
  assert.equal(
    twice.text,
    `"Bring Dad lunch" already has an order on record: Kunle ordered it from Mama Titi's kitchen, due today at 1 PM. Tell the person that.`,
  );
  const bad = await order('kunle', { what: 'Water for Dad', arrives: 'soon' });
  assert.match(bad.text, /I couldn't read "soon" as a time/);
  assert.equal(store.getCareState('h').events.filter((e) => e.kind === 'order_placed').length, 1);

  clock = new Date('2026-09-24T12:05:00Z');
  await use('kunle', 'resolve_obligation', { obligationId: lunch.id });
  const after = await order('kunle', { obligationId: lunch.id });
  assert.match(after.text, /already marked done/);
});

test('"I ordered it" heard as done, minutes after ordering: nothing has reached Dad yet', async () => {
  const { use, order, work } = await family();
  await order('kunle', { obligationId: 'Bring Dad lunch', arrives: '13:00' });
  const r = await use('kunle', 'resolve_obligation', { obligationId: work('Bring Dad lunch')!.id });
  assert.equal(r.isError, true);
  assert.equal(
    r.text,
    `"Bring Dad lunch" was only just ordered, due today at 1 PM. It isn't done until someone says it reached Dad, so it stays open. Tell the person that.`,
  );
  assert.equal(work('Bring Dad lunch')!.status, 'ASSIGNED');
  assert.equal(work("Take the delivery from Mama Titi's kitchen in to Dad")!.status, 'OPEN');
});

test('the doorbell asks about the order; taking it in closes both, and Dad hears who did what', async () => {
  const { use, order, work } = await family();
  await order('kunle', { obligationId: 'Bring Dad lunch', arrives: '13:00' });
  const takeIn = work("Take the delivery from Mama Titi's kitchen in to Dad")!;
  await use('sandra', 'claim_obligation', { obligationId: takeIn.id });

  const pending = await use('dad', 'get_shift_brief');
  assert.match(
    pending.text,
    /Bring Dad lunch at 1 PM: Kunle ordered it from Mama Titi's kitchen; Sandra is taking it in\./,
  );

  clock = new Date('2026-09-24T11:55:00Z');
  const rang = await use('sam', 'ingest_signal', { source: 'ring', kind: 'delivery_arrived' });
  assert.equal(
    rang.text,
    `A delivery arrived at Dad's door. It may be "Bring Dad lunch", which Kunle ordered from Mama Titi's kitchen, due today at 1 PM. Has it reached Dad?`,
  );
  assert.equal(rang.structured?.['resolvesCandidate'], takeIn.id);
  assert.equal(work('Bring Dad lunch')!.status, 'ASSIGNED', 'the doorbell closes nothing');

  clock = new Date('2026-09-24T11:58:00Z');
  const done = await use('sandra', 'resolve_obligation', { obligationId: takeIn.id });
  assert.match(done.text, /That closes "Bring Dad lunch" too\.$/);
  assert.equal(work('Bring Dad lunch')!.status, 'RESOLVED');

  const brief = await use('dad', 'get_shift_brief');
  assert.match(
    brief.text,
    /Bring Dad lunch at 1 PM: Kunle ordered it from Mama Titi's kitchen, and Sandra took it in at 12:58 PM\./,
  );
});
