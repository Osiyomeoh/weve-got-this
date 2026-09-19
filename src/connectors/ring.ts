/**
 * The Ring API client: authenticating to a real Ring account and reading its devices.
 *
 * This is the *outbound* half of the Ring integration - the calls CareCircle makes to
 * Ring. The *inbound* half (device events) already exists as the HMAC-verified webhook
 * (`http/ring-webhook.ts`), because Ring has no polling API: events are delivered only
 * by webhook POST. So this client's job is not to fetch events - it is to prove the
 * account is linked and to enumerate the real devices behind it.
 *
 * Endpoints are the real ones (verified against the official ring-api-helloworld):
 *  - token:   https://oauth.ring.com/oauth/token   (refresh grant)
 *  - devices: https://api.amazonvision.com/v1/devices
 *
 * Two auth modes, matching the Ring docs:
 *  - a direct access token (RING_ACCESS_TOKEN, from the Ring Developer Playground);
 *  - a refresh token (RING_REFRESH_TOKEN) + client id/secret, auto-renewing.
 */

const TOKEN_URL = 'https://oauth.ring.com/oauth/token';
const DEVICES_URL = 'https://api.amazonvision.com/v1/devices';

export interface RingConfig {
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
}

/** A Ring device, normalised away from the raw API shape. */
export interface RingDevice {
  id: string;
  kind?: string;
  description?: string;
}

/**
 * Resolve Ring credentials from the environment, or null when none are usable. A
 * direct access token wins; otherwise a refresh token needs the client id/secret.
 */
export function ringConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RingConfig | null {
  const accessToken = env['RING_ACCESS_TOKEN']?.trim();
  const refreshToken = env['RING_REFRESH_TOKEN']?.trim();
  const clientId = env['RING_CLIENT_ID']?.trim();
  const clientSecret = env['RING_CLIENT_SECRET']?.trim();

  if (accessToken) return { accessToken };
  if (refreshToken && clientId && clientSecret) return { refreshToken, clientId, clientSecret };
  return null;
}

let cached: { token: string; expiresAt: number } | null = null;

/**
 * Get a usable access token: the direct one if configured, otherwise refresh via
 * Ring's OAuth endpoint (cached until shortly before it expires).
 */
export async function getRingAccessToken(config: RingConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;
  if (!config.refreshToken || !config.clientId || !config.clientSecret) {
    throw new Error('Ring auth not configured: set RING_ACCESS_TOKEN, or RING_REFRESH_TOKEN with client id/secret.');
  }
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ring token refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error('Ring token refresh returned no access_token.');
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
  return json.access_token;
}

/**
 * Normalise the /v1/devices response into a plain list. Defensive, like the webhook
 * adapter: takes the id and a human label where present, tolerates an unknown shape,
 * and never throws on a device it doesn't recognise.
 */
export function parseDevices(json: unknown): RingDevice[] {
  const items = Array.isArray(json)
    ? json
    : (json && typeof json === 'object' && Array.isArray((json as { devices?: unknown[] }).devices))
      ? (json as { devices: unknown[] }).devices
      : [];
  const out: RingDevice[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const id = typeof d['id'] === 'string' ? d['id']
      : typeof d['device_id'] === 'string' ? d['device_id'] : null;
    if (!id) continue;
    const kind = typeof d['kind'] === 'string' ? d['kind']
      : typeof d['type'] === 'string' ? d['type'] : undefined;
    const description = typeof d['description'] === 'string' ? d['description']
      : typeof d['name'] === 'string' ? d['name'] : undefined;
    out.push({ id, ...(kind ? { kind } : {}), ...(description ? { description } : {}) });
  }
  return out;
}

/** List the real devices on the linked Ring account. */
export async function listRingDevices(accessToken: string): Promise<RingDevice[]> {
  const res = await fetch(DEVICES_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ring devices fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return parseDevices(await res.json());
}
