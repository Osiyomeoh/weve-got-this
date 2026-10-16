/**
 * What a real family's record shows about their time using the app.
 *
 *   npm run pilot:report                               the one household that isn't the demo
 *   npm run pilot:report -- --household h_abc123       a particular household
 *   npm run pilot:report -- --since 2026-09-28         from a date (household time)
 *   npm run pilot:report -- --json                     machine-readable
 *
 * Reads DynamoDB when CARECIRCLE_TABLE is set (with AWS_REGION and credentials), and the
 * local file store otherwise. Read-only: nothing is written back.
 *
 * Every figure is counted from the log; see src/domain/pilot-report.ts. On the demo
 * household the "logged after the board showed no record" line is not meaningful: its
 * events are seeded back-dated, so they all look recorded late.
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { localParts } from '../src/domain/gaps.ts';
import { pilotReport, renderPilotReport } from '../src/domain/pilot-report.ts';

const DEMO = 'h_margaret';
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const table = process.env['CARECIRCLE_TABLE']?.trim();
const region = process.env['AWS_REGION']?.trim();

const store = new CareStore(
  table
    ? new DynamoPersistence({ tableName: table, ...(region ? { region } : {}) })
    : new FilePersistence(process.env['CARECIRCLE_DB'] ?? 'carecircle.db.json'),
);
await store.init();

const households = [...new Set(store.allMembers().map((m) => m.householdId))];
let householdId = flag('--household');
if (!householdId) {
  // Not the demo household or its per-visitor sandbox copies (`h_margaret~...`), and not
  // a household someone set up and never used.
  const real = households.filter(
    (h) => h !== DEMO && !h.startsWith(`${DEMO}~`) && store.getCareState(h).events.length > 0,
  );
  if (real.length !== 1) {
    console.error(
      real.length === 0
        ? 'No household other than the demo one has any records yet. Pass --household to pick one.'
        : `More than one household has records; pick one with --household: ${real.join(', ')}`,
    );
    process.exit(1);
  }
  householdId = real[0]!;
}
if (!households.includes(householdId)) {
  console.error(`No household ${householdId}. Known: ${households.join(', ')}`);
  process.exit(1);
}

const state = store.getCareState(householdId);
const to = new Date();

/** Midnight at the start of a household-local date, as an instant. */
function startOf(date: string): Date {
  // Start from UTC midnight and step back until the local date is the one before.
  let t = Date.parse(`${date}T00:00:00Z`) + 14 * 3_600_000;
  while (localParts(new Date(t - 60_000), state.household.timezone).date >= date) t -= 60_000 * 15;
  return new Date(t);
}

const since = flag('--since');
if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error('--since takes a date as YYYY-MM-DD.');
  process.exit(1);
}
const first = state.events.map((e) => e.occurredAt).sort()[0];
const from = since
  ? startOf(since)
  : first
    ? startOf(localParts(new Date(first), state.household.timezone).date)
    : to;

const report = pilotReport(state, { from, to });
if (args.includes('--json')) {
  console.log(JSON.stringify({ householdId, ...report }, null, 2));
} else {
  console.log(renderPilotReport(report, `We've Got This pilot · ${state.household.name}`));
}
