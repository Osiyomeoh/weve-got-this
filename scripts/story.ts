/**
 * The crazy user story, executed end to end.
 *
 * One command. It seeds the exact opening state, starts the real MCP
 * server in-process (Streamable HTTP, spec 2025-11-25), and walks every beat
 * through real MCP clients - one per member of the care circle, each on their own
 * credential. Nothing is faked or narrated by hand: every line the assistant says
 * is a real tool response, and every state change is the server's own.
 *
 *   npm run story
 *
 * This is the sequence the demo video screen-captures. Because it is deterministic
 * and self-contained, anyone who clones the repo sees precisely what the video shows.
 *
 * What is BUILT and exercised here: Alexa+ voice logging, appointment inference,
 * constraint discovery, the Care Gap engine, ownership, the Ring signal adapter,
 * the agent following up a slipping promise with the door's evidence beside it,
 * care beyond medicine (lunch every day, set up once and asked about each time),
 * the Known != Assumed trust model, and the shared record read from four roles.
 * What is deliberately NOT here: Bee (architecturally ready via the same signal
 * adapter, not integrated) and the Fire TV surface (the existing web board). The
 * conversation-derived note stands in for the Bee seam, honestly labelled.
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
import type { Notifier } from '../src/notify/notifier.ts';

const HOUSEHOLD = 'h_margaret';
const TZ = 'Africa/Lagos';

/**
 * The UTC instant for a wall-clock time today in a timezone. The story is set in
 * the evening, so the server clock runs then; individual events (the morning dose,
 * the evening dose) still carry their own true times via occurredAt.
 */
function wallClockToday(hour: number, minute: number, tz: string, base = new Date()): Date {
  // Anchor the day to the calendar date in `tz`, not UTC: in the evening in the
  // Americas the UTC date is already tomorrow, which would misplace "today".
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

function beat(time: string, title: string): void {
  console.log(`\n${bold(cyan(`  ${time}`))}  ${bold(title)}`);
}
function say(who: string, text: string): void {
  console.log(`  ${who}: "${text}"`);
}
function alexa(r: any): any {
  console.log(`    ${amber('Alexa')}: ${r.content?.[0]?.text ?? '(no text)'}`);
  return r;
}
function board(gaps: any[]): void {
  console.log(dim('    ── Care Gaps ─────────────────────────────────'));
  if (gaps.length === 0) {
    console.log(dim('    (nothing unowned)'));
    return;
  }
  for (const g of gaps) {
    const mark = g.obligationId ? '•' : '?';
    console.log(dim(`    ${mark} [${String(g.severity).padEnd(6)}] ${g.spoken}`));
  }
}

const call = (c: Client, name: string, args: Record<string, unknown> = {}) =>
  c.callTool({ name, arguments: args }) as Promise<any>;
const gapsOf = (r: any): any[] => r.structuredContent?.gaps ?? [];

async function connect(baseUrl: string, token: string): Promise<Client> {
  const client = new Client({ name: `carecircle-story-${token}`, version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return client;
}

async function main(): Promise<void> {
  // The story plays out in the evening - 9:10pm, past the grace on the 8pm dose, so
  // the absence beat surfaces a genuinely-overdue record rather than a premature one.
  // The server clock follows the beats, so a signal with no time of its own lands when
  // the beat says it did, and the agent's pass sees the hour it really runs at.
  let clockAt = wallClockToday(7, 42, TZ);
  const clock = () => clockAt;
  // The scenario seeds its dated events off its own `now`; hand it a midday instant
  // so its internal date math lands squarely on today, then run the clock in the
  // evening. Both agree on the calendar day; only the time-of-day differs.
  const seedNow = wallClockToday(12, 0, TZ);

  // 1. A clean, deterministic opening state in a throwaway store.
  const dbPath = join(mkdtempSync(join(tmpdir(), 'carecircle-story-')), 'story.db.json');
  const store = new CareStore(new FilePersistence(dbPath));
  await store.reset();
  await seedDemoHousehold(store);
  const { checkUpAt, rideObligationId } = await seedScenario(store, HOUSEHOLD, {
    now: seedNow,
    // The ride is Funmi's at the open, so the constraint beat can orphan it live.
    rideClaimedByFunmi: true,
    // Beat one logs the eye drops on camera; don't seed a duplicate dose.
    skipMorningEyeDrops: true,
  });

  // An errand Musa promised this afternoon, due at 8pm. Part of the opening state,
  // like the ride: the story is about what happens when a promise slips.
  const errand = await store.createObligation({
    householdId: HOUSEHOLD,
    what: "Pick up Daddy's new eye drops from the pharmacy",
    consequence: 'medical',
    status: 'ASSIGNED',
    ownerId: 'm_aide',
    provenance: {
      kind: 'CONFIRMED',
      byMemberId: 'm_aide',
      at: wallClockToday(15, 0, TZ).toISOString(),
    },
    dueAt: wallClockToday(20, 0, TZ).toISOString(),
  });

  // Messages the agent sends go to this terminal instead of a phone. Record-only, and
  // honest about it: nothing here claims a phone buzzed.
  const phone: Notifier = {
    channel: 'none',
    async deliver({ toName, message }) {
      console.log(`    ${amber(`${toName}'s phone`)}: ${message.replace(/\n+/g, ' ')}`);
      return { delivered: false, channel: 'none' };
    },
  };

  // 2. The real server, in-process. Same factory the deployed server uses.
  const tokens = new Map(Object.entries(DEMO_TOKENS));
  const app = createCareCircleApp({ store, tokens, now: clock, notifier: phone });
  const http = app.listen(0);
  await new Promise<void>((r) => http.once('listening', r));
  const { port } = http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/mcp`;

  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(checkUpAt);
  // The check-up's own day: it is two days from whenever the story runs, so never a fixed name.
  const rideDay = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' }).format(
    checkUpAt,
  );

  // 3. Four members, four credentials, four sessions.
  const daddy = await connect(url, 'margaret-token');
  const tolu = await connect(url, 'david-token');
  const funmi = await connect(url, 'renee-token');
  const musa = await connect(url, 'aide-token');

  const tools = await tolu.listTools();
  console.log(bold("\nWe've Got This - the one-day story, over real MCP"));
  console.log(dim(`  server: ${url}  ·  spec 2025-11-25  ·  ${tools.tools.length} tools`));
  console.log(dim(`  the eye check-up is genuinely ${when} in ${TZ}`));

  // ── Beat 1 · 7:42am - she logs her own care by talking ──────────────────
  beat('7:42am', 'The parent logs his own care by voice');
  say('Daddy (Echo at home)', 'Alexa, I used my eye drops.');
  alexa(
    await call(daddy, 'log_care_event', {
      kind: 'medication_taken',
      medicationName: 'eye drops',
      occurredAt: wallClockToday(7, 42, TZ).toISOString(),
    }),
  );

  // ── Beat 2 · the constraint - work comes loose, silently ────────────────
  clockAt = wallClockToday(9, 15, TZ);
  beat('9:15am', 'A constraint quietly orphans work nobody re-assigned');
  say('Funmi (phone)', `I can't take Daddy to his eye check-up on ${rideDay} after all.`);
  alexa(
    await call(funmi, 'add_note', {
      note: `I can't take Daddy to his eye check-up ${rideDay}.`,
      unavailable: {
        memberName: 'Funmi',
        from: new Date(checkUpAt.getTime() - 3 * 3600_000).toISOString(),
        to: new Date(checkUpAt.getTime() + 3 * 3600_000).toISOString(),
      },
    }),
  );

  // ── Beat 2b · 10:05am - care is more than medicine ───────────────────────
  clockAt = wallClockToday(10, 5, TZ);
  beat('10:05am', 'Not only medicine: lunch comes round every day, and needs a person');
  say('Funmi (phone)', 'Someone needs to bring Daddy lunch every day at one.');
  alexa(
    await call(funmi, 'set_routine', {
      what: 'Bring Daddy lunch',
      area: 'meal',
      times: ['13:00'],
    }),
  );
  const lunch = store
    .getCareState(HOUSEHOLD)
    .obligations.find((o) => o.what === 'Bring Daddy lunch' && o.status === 'OPEN')!;
  say('Musa', "I'll bring it today.");
  alexa(await call(musa, 'claim_obligation', { obligationId: lunch.id }));

  clockAt = wallClockToday(13, 10, TZ);
  say('Musa (1:10pm)', "Daddy's had his lunch.");
  alexa(await call(musa, 'resolve_obligation', { obligationId: lunch.id }));

  // ── Beat 3 · 2:14pm - a doorbell becomes evidence, never a conclusion ────
  clockAt = wallClockToday(14, 14, TZ);
  beat('2:14pm', 'Ring sees a delivery - evidence toward the refill, not proof');
  say('Ring doorbell', "(a package is left at Daddy's door)");
  alexa(
    await call(tolu, 'ingest_signal', {
      source: 'ring',
      kind: 'delivery_arrived',
      detail: 'Package left at front door',
    }),
  );

  // ── Beat 4 · 6:30pm - the question no other assistant answers ────────────
  clockAt = wallClockToday(18, 30, TZ);
  beat('6:30pm', "What's going to fall through the cracks this week?");
  say('Tolu (driving)', "Alexa, what's going to fall through the cracks this week?");
  const gapsRes = alexa(await call(tolu, 'get_care_gaps', { withinDays: 7 }));
  board(gapsOf(gapsRes));

  const ride =
    gapsOf(gapsRes).find((g) => g.obligationId === rideObligationId) ??
    gapsOf(gapsRes).find((g) => /check-up|take daddy/i.test(g.spoken));
  say('Tolu', `I'll take him ${rideDay}.`);
  alexa(await call(tolu, 'claim_obligation', { obligationId: ride.obligationId }));

  // The delivery pointed at the refill; Tolu confirms it and closes it out.
  const rx = gapsOf(gapsRes).find((g) => /refill/i.test(g.spoken));
  say('Tolu', 'And yes - that package was the eye drops refill. Mark it picked up.');
  await call(tolu, 'claim_obligation', { obligationId: rx.obligationId });
  alexa(
    await call(tolu, 'resolve_obligation', {
      obligationId: rx.obligationId,
      note: 'Confirmed via the 2:14pm doorbell delivery.',
    }),
  );

  // ── Beat 5 · 8:16pm - a promise slips, and the agent follows up ─────────
  clockAt = wallClockToday(19, 58, TZ);
  beat('7:58pm', 'Ring sees someone at the door - evidence, not a verdict');
  say('Ring doorbell', '(motion at the front door)');
  alexa(await call(tolu, 'ingest_signal', { source: 'ring', kind: 'motion' }));

  clockAt = wallClockToday(20, 16, TZ);
  beat('8:16pm', 'Saying yes is not doing it: the agent checks in on a slipping promise');
  say(
    'The agent',
    "(its own pass, every 15 minutes - nobody asked; Musa's pharmacy run was due at 8:00)",
  );
  alexa(await call(tolu, 'run_care_agent', {}));
  say('Musa', 'done');
  alexa(await call(musa, 'resolve_obligation', { obligationId: errand.id }));
  say('Tolu', 'How do we know the drops were picked up?');
  alexa(await call(tolu, 'get_provenance', { obligationId: errand.id }));

  // ── Beat 6 · 9:10pm - an absence, refused the shape of an accusation ─────
  clockAt = wallClockToday(21, 10, TZ);
  beat('9:10pm', 'Known != Assumed - an absence is surfaced as a question');
  say('Tolu', 'Did Daddy use his evening eye drops?');
  const eveningRes = alexa(await call(tolu, 'get_care_gaps', {}));
  board(gapsOf(eveningRes));

  // ── Beat 7 · 9:12pm - the living room already knew; the gap clears ───────
  clockAt = wallClockToday(21, 12, TZ);
  beat('9:12pm', 'The ambient board prompts a call; the gap clears everywhere');
  say(
    'Funmi (sees the Fire TV board)',
    'I just called him - he used them at 7:50 and forgot to say.',
  );
  alexa(
    await call(funmi, 'log_care_event', {
      kind: 'medication_taken',
      medicationName: 'eye drops',
      aboutMemberId: 'm_margaret',
      occurredAt: wallClockToday(19, 50, TZ).toISOString(),
      detail: 'Confirmed by phone; Daddy used them at 7:50pm.',
    }),
  );
  const closedRes = await call(tolu, 'get_care_gaps', {});
  console.log(dim('\n    After Funmi confirms:'));
  board(gapsOf(closedRes));

  // ── Coda · one record, four roles ───────────────────────────────────────
  beat('-', 'One record, four people reach it differently');
  say('Daddy (Echo at home)', 'Alexa, what does today look like for me?');
  alexa(await call(daddy, 'get_shift_brief'));
  say('Musa (driver)', 'What do I need to know for today?');
  alexa(await call(musa, 'get_shift_brief'));
  say('Funmi (caregiver)', "Put Daddy's check-up ride on Tolu's name.");
  alexa(
    await call(funmi, 'assign_obligation', {
      obligationId: ride.obligationId,
      assigneeName: 'Tolu',
    }),
  );

  console.log(bold(cyan("\n  It doesn't just tell a family what happened.")));
  console.log(bold(cyan('  It tells them what still needs someone.\n')));

  await Promise.all([daddy.close(), tolu.close(), funmi.close(), musa.close()]);
  await new Promise<void>((r) => http.close(() => r()));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
