import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCareCircleApp } from './app.ts';
import { CareStore } from '../store/store.ts';

/**
 * When the answer says a dose has no record, it also says what IS on the record today - in
 * the sentence, because many hosts give the model the text of a result and nothing else.
 * Found by tracing a son's question "has Mom used her eye drops today?": he heard only
 * "no record from 8 AM", about a mother who had logged her evening dose.
 */

let server: Server | undefined;
afterEach(() => server?.close());

async function family(now: Date): Promise<{ store: CareStore; base: string }> {
  const store = new CareStore();
  await store.addHousehold({ id: 'h', name: 'circle', timezone: 'America/New_York' });
  await store.addMember({
    id: 'm_mom',
    householdId: 'h',
    name: 'Rosa',
    role: 'care_recipient',
    spokenAs: 'Mom',
  });
  await store.addMember({
    id: 'm_son',
    householdId: 'h',
    name: 'Daniel',
    role: 'primary_caregiver',
  });
  await store.addMedication({
    id: 'med',
    householdId: 'h',
    name: 'eye drops',
    times: ['08:00', '20:00'],
    forMemberId: 'm_mom',
    since: '2026-09-24T04:00:00Z',
  });
  const app = createCareCircleApp({
    store,
    now: () => now,
    tokens: new Map([
      ['mom', 'm_mom'],
      ['son', 'm_son'],
    ]),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server!.once('listening', r));
  return { store, base: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/mcp` };
}

async function call(
  base: string,
  as: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  const c = new Client({ name: 'whole-record-test', version: '1' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${as}` } },
    }),
  );
  try {
    await c.listTools();
    const out = await c.callTool({ name, arguments: args });
    return (out.content as { text: string }[]).map((p) => p.text).join(' ');
  } finally {
    await c.close();
  }
}

test('a dose with no record is never spoken without the doses that are on the record', async () => {
  const { base } = await family(new Date('2026-09-25T02:10:00Z')); // 10:10 PM in New York
  await call(base, 'mom', 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
  });

  const said = await call(base, 'son', 'get_care_gaps');
  assert.match(said, /There's no record of Mom's eye drops from 8 AM\./);
  assert.match(said, /On the record today: eye drops at 10:10 PM, from Mom\./);
});

test('with no dose missing, the answer stays as short as it was', async () => {
  const { base } = await family(new Date('2026-09-24T13:00:00Z')); // 9 AM: the 8 AM dose is logged, 8 PM not yet due
  await call(base, 'mom', 'log_care_event', {
    kind: 'medication_taken',
    medicationName: 'eye drops',
  });

  const said = await call(base, 'son', 'get_care_gaps');
  assert.doesNotMatch(said, /On the record today/);
});
