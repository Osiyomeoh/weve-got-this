/**
 * Reset the demo to the state the video opens on.
 *
 *   npm run demo:reset            fresh state, ride unclaimed
 *   npm run demo:reset -- --claimed   ride already claimed by Funmi, so the
 *                                     constraint beat ("I can't drive Thursday")
 *                                     can orphan it live on camera
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { seedDemoHousehold } from '../src/demo/seed.ts';
import { seedScenario } from '../src/demo/scenario.ts';
import { detectCareGaps } from '../src/domain/gaps.ts';

const dbPath = process.env.CARECIRCLE_DB ?? 'carecircle.db.json';
const claimed = process.argv.includes('--claimed');

const store = new CareStore(new FilePersistence(dbPath));
await store.reset();
await seedDemoHousehold(store);
const { checkUpAt } = await seedScenario(store, 'h_margaret', {
  rideClaimedByFunmi: claimed,
});

const state = store.getCareState('h_margaret');
const gaps = detectCareGaps(state);

const when = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Lagos', weekday: 'long', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
}).format(checkUpAt);

console.log(`Demo reset - ${dbPath}`);
console.log(`  Eye check-up: ${when} (Africa/Lagos)`);
console.log(`  Ride: ${claimed ? 'claimed by Funmi' : 'unclaimed'}`);
console.log(`\nOpening Care Gaps (${gaps.length}):`);
for (const g of gaps) console.log(`  [${g.severity.padEnd(6)}] ${g.spoken}`);
