/**
 * Re-seed the demo household in PRODUCTION, and nothing else.
 *
 *   npm run demo:reset:prod                 dry run: shows what would change
 *   npm run demo:reset:prod -- --apply      writes it
 *   ... -- --apply --claimed                ride already claimed by Funmi
 *
 * `npm run demo:reset` resets a local file and wipes every household. This one works
 * on the live DynamoDB table and removes only `h_margaret`, then seeds it again with
 * dates relative to now. Every other household (a pilot family, anyone who signed up)
 * is counted before and after, and the script reports if any of them changed.
 *
 * The running server keeps its own copy in memory, so after --apply restart it (and
 * the console) so they reload - `infra/demo-reset-prod.sh` does the whole sequence.
 *
 * Needs CARECIRCLE_TABLE and AWS_REGION, and AWS credentials for the table.
 */
import { CareStore } from '../src/store/store.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { seedDemoHousehold } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { detectCareGaps } from '../src/domain/gaps.ts';

const DEMO = 'h_margaret';
const apply = process.argv.includes('--apply');
const claimed = process.argv.includes('--claimed');
const table = process.env['CARECIRCLE_TABLE']?.trim();
const region = process.env['AWS_REGION']?.trim();

if (!table || !region) {
  console.error('Set CARECIRCLE_TABLE and AWS_REGION (e.g. CARECIRCLE_TABLE=carecircle AWS_REGION=us-east-1).');
  process.exit(1);
}

/** A fingerprint per household that is not the demo one, to prove they are untouched. */
function others(store: CareStore): Map<string, string> {
  const ids = new Set(store.allMembers().map((m) => m.householdId));
  const out = new Map<string, string>();
  for (const id of ids) {
    if (id === DEMO) continue;
    const s = store.getCareState(id);
    out.set(id, JSON.stringify([s.members, s.events, s.obligations, s.medications]));
  }
  return out;
}

function summary(store: CareStore, label: string): void {
  const s = store.getCareState(DEMO);
  const due = s.obligations.map((o) => o.dueAt).filter(Boolean).sort();
  console.log(`${label}: ${s.members.length} members, ${s.events.length} events, `
    + `${s.obligations.length} obligations, due ${due[0] ?? '-'} .. ${due.at(-1) ?? '-'}`);
}

const store = new CareStore(new DynamoPersistence({ tableName: table, region }));
await store.init();

const before = others(store);
console.log(`Table ${table} (${region}). Other households: ${before.size} (left untouched).`);
summary(store, 'Demo household now');

if (!apply) {
  console.log('\nDry run. Re-run with --apply to remove and re-seed only the demo household.');
  process.exit(0);
}

await store.removeHousehold(DEMO);
await seedDemoHousehold(store);
const { checkUpAt } = await seedScenario(store, DEMO, { rideClaimedByFunmi: claimed });
await store.quiesce();

summary(store, 'Demo household after');
console.log(`Eye check-up: ${checkUpAt.toISOString()}  Ride: ${claimed ? 'claimed by Funmi' : 'unclaimed'}`);
for (const g of detectCareGaps(store.getCareState(DEMO))) console.log(`  [${g.severity}] ${g.spoken}`);

// Re-read from the table itself, not the copy in memory, before calling it safe.
const check = new CareStore(new DynamoPersistence({ tableName: table, region }));
await check.init();
const after = others(check);
const changed = [...before.keys()].filter((id) => before.get(id) !== after.get(id));
if (changed.length > 0 || after.size !== before.size) {
  console.error(`\nWARNING: other households changed: ${changed.join(', ') || 'count differs'}`);
  process.exit(2);
}
console.log(`\nVerified from the table: all ${after.size} other household(s) unchanged.`);
console.log('Now restart the MCP server and the console so they reload (infra/demo-reset-prod.sh).');
