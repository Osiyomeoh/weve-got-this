/**
 * Two instances, one real DynamoDB table: the checks src/store/multi-instance.test.ts makes
 * against an in-memory double, made against the real service, so the transaction semantics
 * and the shape of a refusal are DynamoDB's own and not our imitation of them.
 *
 *   CHECK_TABLE=<scratch table> AWS_PROFILE=... npx tsx scripts/dynamo-concurrency-check.ts
 *
 * Use an empty scratch table (pk/sk string keys), never the production one: it writes
 * synthetic rows and removes the household it made.
 */
import { CareStore, RecordChangedError } from '../src/store/store.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';

const table = process.env['CHECK_TABLE'];
if (!table || table === 'carecircle') {
  console.error('Set CHECK_TABLE to an empty scratch table - never the production table.');
  process.exit(1);
}
const region = process.env['AWS_REGION'] ?? 'us-east-1';
const instance = async () => {
  const s = new CareStore(new DynamoPersistence({ tableName: table, region }));
  await s.init();
  return s;
};
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
};
const note = (detail: string) => ({
  householdId: 'h_check', kind: 'note_added' as const, reportedBy: 'm_tolu', occurredAt: new Date().toISOString(), data: {}, detail,
});

const a = await instance();
check(a.householdCount() === 0, 'the scratch table starts empty');
await a.addHousehold({ id: 'h_check', name: 'check', timezone: 'Africa/Lagos' });
await a.addMember({ id: 'm_tolu', householdId: 'h_check', name: 'Tolu', role: 'primary_caregiver' });
await a.addMember({ id: 'm_funmi', householdId: 'h_check', name: 'Funmi', role: 'caregiver' });
await a.createObligation({
  id: 'o_ride', householdId: 'h_check', what: 'Take Daddy to his eye check-up', consequence: 'medical',
  status: 'OPEN', ownerId: null, provenance: { kind: 'CONFIRMED', byMemberId: 'm_tolu', at: new Date().toISOString() },
} as never);

const b = await instance();
check(b.getObligation('o_ride', 'h_check').status === 'OPEN', 'a second instance loads what the first wrote');

await a.transition('o_ride', 'h_check', 'ASSIGNED', 'm_funmi', { ownerId: 'm_funmi' });
let refused = false;
try { await b.transition('o_ride', 'h_check', 'ASSIGNED', 'm_tolu', { ownerId: 'm_tolu' }); } catch (err) { refused = err instanceof RecordChangedError; }
check(refused, 'a write on a stale record is refused by DynamoDB (TransactionCanceledException -> RecordChangedError)');
check(b.getObligation('o_ride', 'h_check').ownerId === 'm_funmi', 'the refused instance reads the record again: Funmi has the ride');
const c = await instance();
check(c.getObligation('o_ride', 'h_check').ownerId === 'm_funmi', 'nothing of the refused write reached the table');

await a.appendEvent(note('Daddy slept well'));
check(await b.refresh(), 'refresh sees the other instance wrote');
check(b.getCareState('h_check').events.at(-1)?.detail === 'Daddy slept well', 'and reloads what it wrote');
check(!(await b.refresh()), 'a refresh with nothing new does not reload');

for (let i = 0; i < 110; i += 1) await b.appendEvent(note(`note ${i}`));
await a.refresh();
const { removed } = await a.removeHousehold('h_check');
check(removed > 99, `a removal of ${removed} rows goes through in more than one transaction`);
const d = await instance();
check(d.householdCount() === 0, 'the scratch household is gone');
