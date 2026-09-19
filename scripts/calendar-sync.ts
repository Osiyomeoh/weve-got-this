/**
 * Pull real events from your Google Calendar into a household's care record.
 *
 *   CARECIRCLE_HOUSEHOLD=h_margaret npm run calendar:sync
 *
 * This is the real inbound door, not a simulation: it reads your live calendar (via
 * the refresh token from `npm run google:auth`) and folds each upcoming event into
 * the record through the same path a spoken appointment takes - as an `observed`
 * appointment whose implied work is PROPOSED for a human to confirm. Run it once, or
 * on a schedule; it is idempotent, so re-running never duplicates work.
 *
 * Store selection mirrors the server: DynamoDB when CARECIRCLE_TABLE is set,
 * otherwise the local JSON file - so a sync writes to the same place the server reads.
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { googleCalendarConfigFromEnv, runGoogleCalendarSync } from '../src/connectors/google-calendar.ts';

async function main(): Promise<void> {
  const config = googleCalendarConfigFromEnv();
  if (!config) {
    console.error(
      'Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and\n'
      + 'GOOGLE_REFRESH_TOKEN (run `npm run google:auth` to mint the refresh token).',
    );
    process.exit(1);
  }

  const householdId = process.env['CARECIRCLE_HOUSEHOLD']?.trim() || process.argv[2];
  if (!householdId) {
    console.error('Which household? Set CARECIRCLE_HOUSEHOLD or pass it as the first argument.');
    process.exit(1);
  }
  const forMemberId = process.env['CARECIRCLE_CALENDAR_FOR']?.trim();

  const table = process.env['CARECIRCLE_TABLE']?.trim();
  const region = process.env['AWS_REGION']?.trim();
  const persistence = table
    ? new DynamoPersistence({ tableName: table, ...(region ? { region } : {}) })
    : new FilePersistence(process.env['CARECIRCLE_DB'] ?? 'carecircle.db.json');
  const store = new CareStore(persistence);
  await store.init();

  const result = await runGoogleCalendarSync(
    store, householdId, config, new Date(), forMemberId,
  );

  console.log(`\nGoogle Calendar sync for ${householdId} (${config.calendarId}):`);
  console.log(`  fetched ${result.fetched}, applied ${result.applied.length}, skipped ${result.skipped.length}`);
  for (const a of result.applied) {
    console.log(`  + ${a.kind} — ${a.proposals} proposal(s): ${a.spoken}`);
  }
  for (const s of result.skipped) {
    console.log(`  · skipped ${s.key}: ${s.reason}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
