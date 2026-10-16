/**
 * The 40-second beat, executed end to end.
 *
 * This is the single continuous demo shot, run headless against the
 * real MCP server in-process (Streamable HTTP, spec 2025-11-25). Its job is to
 * make the doc's central claim literally true: the ask -> decline -> re-ask -> accept loop,
 * and the provenance replay that proves it, are reproducible with no cloud and no keys.
 *
 *   npm run beat
 *
 * Every line the assistant "says" is a real tool response; every state change is the
 * server's own, written to the append-only log. Nothing here is narrated by hand.
 *
 * Distinct from `npm run story`, which walks the full seven-beat scenario (constraint
 * discovery, claim, the medication absence beat, four roles). This is only the delegation
 * loop and its proof - the 40 seconds a judge sees if they see nothing else.
 */
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { seedDemoHousehold, DEMO_TOKENS } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { createCareCircleApp } from '../src/http/app.ts';

const HOUSEHOLD = 'h_margaret';
const TZ = 'Africa/Lagos';

/** The UTC instant for a wall-clock time today in a timezone (same helper as story.ts). */
function wallClockToday(hour: number, minute: number, tz: string, base = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
  const [y, mo, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y!, mo! - 1, d!, hour, minute, 0, 0));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  }).formatToParts(guess);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const drift = h * 60 + m - (hour * 60 + minute);
  return new Date(guess.getTime() - drift * 60_000);
}

// --- pretty transcript ------------------------------------------------------
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function beat(time: string, title: string): void {
  console.log(`\n${bold(cyan(`  ${time}`))}  ${bold(title)}`);
}
function say(who: string, text: string): void {
  console.log(`  ${who}: "${text}"`);
}
function alexa(r: any): any {
  console.log(`    ${amber("We've Got This")}: ${r.content?.[0]?.text ?? '(no text)'}`);
  return r;
}
function surfaces(label: string, gaps: any[]): void {
  // Both windows read the same store; one board stands in for both here.
  console.log(dim(`    ── both surfaces · ${label} ─────────────`));
  if (gaps.length === 0) {
    console.log(dim('    (no open Care Gaps)'));
    return;
  }
  for (const g of gaps) {
    console.log(dim(`    • [${String(g.severity).padEnd(6)}] ${g.spoken}`));
  }
}

const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;
const gapsOf = (r: any): any[] => r.structuredContent?.gaps ?? [];

async function connect(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: `carecircle-beat-${token}`, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return client;
}

async function main(): Promise<void> {
  const clock = () => wallClockToday(9, 0, TZ); // morning of the shot
  const seedNow = wallClockToday(12, 0, TZ); // anchor scenario dates to today

  // A clean opening state in a throwaway store: the ride to the eye check-up is OPEN
  // and unowned, its subject Daddy (who needs accessible transport).
  const dbPath = join(mkdtempSync(join(tmpdir(), 'carecircle-beat-')), 'beat.db.json');
  const store = new CareStore(new FilePersistence(dbPath));
  await store.reset();
  await seedDemoHousehold(store);
  const { rideObligationId } = await seedScenario(store, HOUSEHOLD, { now: seedNow });

  // The real server, in-process. Same factory the deployed server uses.
  const tokens = new Map(Object.entries(DEMO_TOKENS));
  const app = createCareCircleApp({ store, tokens, now: clock });
  const http = app.listen(0);
  await new Promise<void>((r) => http.once('listening', r));
  const { port } = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/mcp`;

  const tolu = await connect(url, 'david-token'); // primary caregiver
  const funmi = await connect(url, 'renee-token'); // caregiver (family)
  const musa = await connect(url, 'aide-token'); // paid driver

  console.log(bold("\n  We've Got This · the 40-second beat  (real server, append-only log)"));
  console.log(dim('  ═══════════════════════════════════════════════════════════'));

  // 0:00 - the gap, and why it ranks
  beat('0:00', 'What is going to fall through the cracks?');
  say('Tolu', "What's going to fall through the cracks this week?");
  const gaps0 = alexa(await call(tolu, 'get_care_gaps', { withinDays: 7 }));
  surfaces('open', gapsOf(gaps0));
  const ride =
    gapsOf(gaps0).find((g) => g.obligationId === rideObligationId) ??
    gapsOf(gaps0).find((g) => /check-up|take daddy/i.test(g.spoken));
  if (!ride) throw new Error('the ride gap did not surface - check the opening state');
  const rideId = ride.obligationId as string;
  console.log(dim(`    why it ranks: ${ride.because}`));

  // 0:06 - ask, not assign
  beat('0:06', 'Ask, not assign');
  say('Tolu', 'Ask Funmi to take him.');
  alexa(await call(tolu, 'request_owner', { obligationId: rideId, assigneeName: 'Funmi' }));
  surfaces('after asking Funmi', gapsOf(await call(tolu, 'get_care_gaps', { withinDays: 7 })));

  // 0:16 - a "no" is information, not a failure
  beat('0:16', 'A "no" is information, not a failure');
  say('Funmi', "I can't, I'm working Thursday.");
  alexa(
    await call(funmi, 'respond_to_request', {
      obligationId: rideId,
      accepted: false,
      note: 'working Thursday',
    }),
  );
  say('Tolu', 'Then ask Musa, the driver.');
  alexa(await call(tolu, 'request_owner', { obligationId: rideId, assigneeName: 'Musa' }));
  surfaces('after asking Musa', gapsOf(await call(tolu, 'get_care_gaps', { withinDays: 7 })));

  // 0:26 - the gap clears on both surfaces at once
  beat('0:26', 'The gap clears on both surfaces at once');
  say('Musa', "Yes, I've got Thursday.");
  alexa(await call(musa, 'respond_to_request', { obligationId: rideId, accepted: true }));
  const cleared = gapsOf(await call(tolu, 'get_care_gaps', { withinDays: 7 }));
  surfaces('after Musa accepts', cleared);
  const stillOpen = cleared.some((g) => g.obligationId === rideId);
  console.log(
    stillOpen
      ? amber('    ⚠ ride still shows as a gap - unexpected')
      : green(
          '    ✓ the ride is owned - it is gone from both surfaces, and cannot come back within the shot',
        ),
  );

  // 0:34 - the proof you cannot fake
  beat('0:34', 'The proof you cannot fake');
  say('Tolu', "How do we know Musa's got it?");
  const prov = alexa(await call(tolu, 'get_provenance', { obligationId: rideId }));
  const chain = prov.structuredContent?.chain ?? [];
  console.log(dim('    replayed from the append-only log:'));
  for (const step of chain) {
    console.log(dim(`      · [${step.certainty}] ${step.detail}`));
  }

  console.log(dim('\n  ═══════════════════════════════════════════════════════════'));
  console.log(green('  Reproducible with no cloud and no keys: npm run beat'));

  await Promise.all([tolu.close(), funmi.close(), musa.close()]);
  http.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
