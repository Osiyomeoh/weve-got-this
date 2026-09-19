/**
 * Pull appointment invites from your Gmail into a household's care record.
 *
 *   CARECIRCLE_HOUSEHOLD=h_margaret npm run email:sync
 *
 * The real Gmail door: it searches your mail for messages carrying a calendar invite
 * (.ics) and folds each into the record as an `observed` appointment whose implied
 * work is PROPOSED for a human to confirm. It never guesses a date from email prose -
 * only the invite's machine-readable start is trusted. Idempotent, safe to re-run.
 *
 * Narrow the search with GMAIL_QUERY, e.g. `from:(mercyclinic.com) filename:ics`.
 * Store selection mirrors the server (DynamoDB when CARECIRCLE_TABLE is set).
 */
import { CareStore } from '../src/store/store.ts';
import { FilePersistence } from '../src/store/persistence.ts';
import { DynamoPersistence } from '../src/store/dynamo.ts';
import { gmailConfigFromEnv, runGmailSync } from '../src/connectors/gmail.ts';

async function main(): Promise<void> {
  const config = gmailConfigFromEnv();
  if (!config) {
    console.error(
      'Gmail is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and\n'
      + 'GOOGLE_REFRESH_TOKEN (run `npm run google:auth`).',
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

  const r = await runGmailSync(store, householdId, config, new Date(), forMemberId);
  console.log(`\nGmail sync for ${householdId} (query: ${config.query}):`);
  console.log(`  fetched ${r.fetched}, applied ${r.applied.length}, skipped ${r.skipped.length}`);
  for (const a of r.applied) console.log(`  + ${a.kind} — ${a.proposals} proposal(s): ${a.spoken}`);
  for (const s of r.skipped) console.log(`  · skipped ${s.id}: ${s.reason}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
