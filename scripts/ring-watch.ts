/**
 * Read what a real Ring doorbell saw, and put it through the app the way a webhook would.
 *
 *   RING_ACCESS_TOKEN=... npm run ring:watch                 # poll every 15 s
 *   RING_ACCESS_TOKEN=... npm run ring:watch -- --once       # one read, then stop
 *   npm run ring:watch -- --pictures out/ring --capture out/ring/capture.json
 *
 * It lists the account's devices, then reads each new entry in the doorbell's Event
 * History, maps it with the same adapter as the webhook, and applies it with the same
 * `applySignal` to an in-memory copy of the demo household. So it prints what the family
 * would hear, from Ring's real API, without touching anyone's record. A token from the
 * Ring Developer Playground is enough: no app install and no webhook URL.
 *
 * Options:
 *   --device <id>      which device (default: the first)
 *   --every <seconds>  how often to read the history (default 15)
 *   --once             read once and stop
 *   --pictures <dir>   save the doorbell's picture at each new event
 *   --capture <file>   write Ring's raw answers, with ids replaced, as evidence of the run
 *
 * Ring classifies motion as a person or a vehicle, and never says who. A live view
 * (`on_demand`) is someone looking through the camera, so it is shown but never counts
 * as anyone at the door.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  classifyRingMotion,
  fetchRingSnapshot,
  getRingAccessToken,
  listRingDevices,
  listRingHistory,
  ringConfigFromEnv,
  type RingHistoryEvent,
} from '../src/connectors/ring.ts';
import { ringHistoryToSignal } from '../src/domain/ring.ts';
import { applySignal } from '../src/domain/ingest.ts';
import { CareStore } from '../src/store/store.ts';
import { seedDemoHousehold, DEMO_HOUSEHOLD_ID } from '../src/demo/seed.ts';

/** How many of the events already in the history to show on the first read. */
const FIRST_READ = 5;

const { values: args } = parseArgs({
  options: {
    device: { type: 'string' },
    every: { type: 'string', default: '15' },
    once: { type: 'boolean', default: false },
    pictures: { type: 'string' },
    capture: { type: 'string' },
  },
});

/** Ring's answers, kept for --capture. Ids are swapped for stable placeholders. */
const captured: Array<{ at: string; call: string; answer: unknown }> = [];
const placeholders = new Map<string, string>();
function placeholder(id: string, prefix: string): string {
  if (!placeholders.has(id)) placeholders.set(id, `${prefix}_${placeholders.size + 1}`);
  return placeholders.get(id)!;
}

async function main(): Promise<void> {
  const config = ringConfigFromEnv();
  if (!config) {
    console.error(
      'Set RING_ACCESS_TOKEN (Ring Developer Playground: generate a token), or\n' +
        'RING_REFRESH_TOKEN with RING_CLIENT_ID and RING_CLIENT_SECRET.',
    );
    process.exit(1);
  }
  const token = await getRingAccessToken(config);

  const devices = await listRingDevices(token);
  captured.push({
    at: new Date().toISOString(),
    call: 'GET /v1/devices?include=status',
    answer: devices.map((d) => ({ ...d, id: placeholder(d.id, 'device') })),
  });
  console.log(`Ring account: ${devices.length} device(s)`);
  for (const d of devices) {
    const online = d.online === undefined ? '' : d.online ? ' [online]' : ' [offline]';
    console.log(`  ${d.description ?? '(unnamed)'}${online}  ${d.id}`);
  }
  const device = args.device ? devices.find((d) => d.id === args.device) : devices[0];
  if (!device) {
    console.error(args.device ? `No device ${args.device} on this account.` : 'No devices.');
    process.exit(1);
  }

  // A copy of the demo household, in memory only: nothing here is anyone's real record.
  const store = new CareStore();
  await seedDemoHousehold(store);
  const tz = store.getCareState(DEMO_HOUSEHOLD_ID).household.timezone;
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });

  const seen = new Set<string>();
  let first = true;
  const read = async (): Promise<void> => {
    const page = await listRingHistory(token, device.id);
    captured.push({
      at: new Date().toISOString(),
      call: 'GET /v1/history/devices/{device}/events',
      answer: page.events.map((e) => ({
        ...e,
        id: placeholder(e.id, 'event'),
        deviceId: placeholder(device.id, 'device'),
      })),
    });
    const fresh = page.events.filter((e) => !seen.has(e.id));
    for (const e of page.events) seen.add(e.id);
    const shown = first ? fresh.slice(0, FIRST_READ) : fresh;
    first = false;
    await classifyRingMotion(token, device.id, shown);
    // History is newest first; the family hears it in the order it happened.
    for (const e of [...shown].reverse()) await report(e);
  };

  const report = async (e: RingHistoryEvent): Promise<void> => {
    const what = e.subType ? `${e.type}.${e.subType}` : e.type;
    const signal = ringHistoryToSignal(e);
    let line = `${clock(e.start)}  ${what.padEnd(14)} `;
    if (signal) {
      const result = await applySignal(store, DEMO_HOUSEHOLD_ID, signal, new Date());
      line += `${signal.detail}. The family hears: "${result.spoken}"`;
      if (result.resolvesCandidate) line += ` (evidence toward ${result.resolvesCandidate})`;
    } else if (e.type === 'on_demand') {
      line += 'A live view: someone looked through the camera. Not counted as anyone at the door.';
    } else {
      line += 'Not something the app acts on.';
    }
    console.log(line);
    if (args.pictures) await picture(e);
  };

  const picture = async (e: RingHistoryEvent): Promise<void> => {
    try {
      const shot = await fetchRingSnapshot(token, device.id, e.start);
      mkdirSync(args.pictures!, { recursive: true });
      const file = join(
        args.pictures!,
        `${placeholder(e.id, 'event')}.${shot.contentType.includes('png') ? 'png' : 'jpg'}`,
      );
      writeFileSync(file, shot.bytes);
      const taken = shot.capturedAt ? ` taken ${clock(shot.capturedAt)}` : '';
      console.log(
        `${' '.repeat(16)}picture: ${file} (${shot.origin ?? 'image'}${taken}, ${shot.bytes.length} bytes)`,
      );
      captured.push({
        at: new Date().toISOString(),
        call: 'POST /v1/devices/{device}/media/image/download',
        answer: {
          contentType: shot.contentType,
          origin: shot.origin,
          capturedAt: shot.capturedAt,
          bytes: shot.bytes.length,
        },
      });
    } catch (err) {
      console.log(`${' '.repeat(16)}no picture: ${(err as Error).message}`);
    }
  };

  await read();
  if (!args.once) {
    const every = Math.max(5, Number(args.every) || 15) * 1000;
    console.log(`Reading the history every ${every / 1000} s. Ctrl-C to stop.`);
    const timer = setInterval(
      () => read().catch((err) => console.error((err as Error).message)),
      every,
    );
    process.on('SIGINT', () => {
      clearInterval(timer);
      finish();
      process.exit(0);
    });
  } else {
    finish();
  }
}

function finish(): void {
  if (!args.capture) return;
  writeFileSync(
    args.capture,
    JSON.stringify({ source: 'Ring API (api.amazonvision.com)', calls: captured }, null, 2),
  );
  console.log(`Wrote ${args.capture}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
