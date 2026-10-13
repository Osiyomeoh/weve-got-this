/**
 * Write a household's owned, dated work back to the shared Google Calendar.
 *
 *   CARECIRCLE_HOUSEHOLD=h_margaret npm run calendar:push
 *
 * The other half of the calendar door: once the family settles who owns a dated
 * obligation, this makes it appear on the shared calendar everyone already carries
 * on their phone - "Musa has the Thursday ride" without anyone re-typing it. Only
 * real, dated work is written (OPEN / REQUESTED / ASSIGNED), each entry phrased to
 * match its true status. Idempotent, and safe to run alongside `calendar:sync`
 * because every event it writes is tagged so the inbound door skips it.
 *
 * Writes to GOOGLE_WRITE_CALENDAR_ID if set, otherwise the same calendar it reads.
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import {
  googleCalendarConfigFromEnv,
  runCalendarWriteback,
} from '../src/connectors/google-calendar.ts';

async function main(): Promise<void> {
  const config = googleCalendarConfigFromEnv();
  if (!config) {
    console.error(
      'Google Calendar is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and\n' +
        'GOOGLE_REFRESH_TOKEN (run `npm run google:auth` to mint the refresh token with the\n' +
        'calendar.events scope needed for write-back).',
    );
    process.exit(1);
  }

  const householdId = process.env['CARECIRCLE_HOUSEHOLD']?.trim() || process.argv[2];
  if (!householdId) {
    console.error('Which household? Set CARECIRCLE_HOUSEHOLD or pass it as the first argument.');
    process.exit(1);
  }

  const table = process.env['CARECIRCLE_TABLE']?.trim();
  const region = process.env['AWS_REGION']?.trim();
  const persistence = table
    ? new DynamoPersistence({ tableName: table, ...(region ? { region } : {}) })
    : new FilePersistence(process.env['CARECIRCLE_DB'] ?? 'carecircle.db.json');
  const store = new CareStore(persistence);
  await store.init();

  const r = await runCalendarWriteback(store, householdId, config);
  const target = config.writeCalendarId ?? config.calendarId;
  console.log(`\nCalendar write-back for ${householdId} -> ${target}:`);
  console.log(`  created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
