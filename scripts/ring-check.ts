/**
 * Prove the Ring account is connected, and list its real devices.
 *
 *   npm run ring:check
 *
 * This confirms the outbound half of the Ring integration: it authenticates with the
 * credentials in .env and reads /v1/devices. Device events themselves arrive by
 * webhook (see http/ring-webhook.ts) - Ring has no polling API - so this does not
 * fetch events; it verifies the link and shows what is behind it.
 *
 * Needs either RING_ACCESS_TOKEN (from the Ring Developer Playground) or
 * RING_REFRESH_TOKEN + RING_CLIENT_ID + RING_CLIENT_SECRET.
 */
import { ringConfigFromEnv, getRingAccessToken, listRingDevices } from '../src/connectors/ring.ts';

async function main(): Promise<void> {
  const config = ringConfigFromEnv();
  if (!config) {
    console.error(
      'Ring is not configured for API calls. Set RING_ACCESS_TOKEN (Ring Developer\n'
      + 'Playground), or RING_REFRESH_TOKEN with RING_CLIENT_ID and RING_CLIENT_SECRET.\n'
      + 'Note: receiving doorbell events needs only RING_HMAC_KEY + the webhook URL set\n'
      + 'in the Ring Developer Portal - this check is for the outbound API link.',
    );
    process.exit(1);
  }

  const token = await getRingAccessToken(config);
  const devices = await listRingDevices(token);

  console.log(`\nRing account connected. ${devices.length} device(s):`);
  for (const d of devices) {
    console.log(`  - ${d.description ?? '(unnamed)'} [${d.kind ?? 'device'}] ${d.id}`);
  }
  if (devices.length === 0) {
    console.log('  (no devices returned — the account may have none, or the token lacks scope)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
