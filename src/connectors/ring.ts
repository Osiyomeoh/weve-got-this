/**
 * The Ring API client: authenticating to a real Ring account and reading from it.
 *
 * This is the *outbound* half of the Ring integration - the calls the app makes to
 * Ring. The *inbound* half is the HMAC-verified webhook (`http/ring-webhook.ts`), which
 * is how events arrive in real time once an app is installed on a Ring account. Ring's
 * Event History lists the same events after the fact, so a token alone (no webhook URL,
 * no app install) is enough to read what the doorbell saw: that is what the Ring
 * Developer Playground offers, and what `scripts/ring-watch.ts` uses.
 *
 * Endpoints are the real ones (Ring's published API documentation):
 *  - token:    https://oauth.ring.com/oauth/token   (refresh grant)
 *  - devices:  GET  https://api.amazonvision.com/v1/devices
 *  - history:  GET  https://api.amazonvision.com/v1/history/devices/{id}/events
 *  - snapshot: POST https://api.amazonvision.com/v1/devices/{id}/media/image/download
 *
 * Two auth modes, matching the Ring docs:
 *  - a direct access token (RING_ACCESS_TOKEN, from the Ring Developer Playground);
 *  - a refresh token (RING_REFRESH_TOKEN) + client id/secret, auto-renewing.
 */

const TOKEN_URL = 'https://oauth.ring.com/oauth/token';
const API_BASE = 'https://api.amazonvision.com';
const DEVICES_URL = `${API_BASE}/v1/devices`;

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
  /** From the device's status, when Ring includes it. */
  online?: boolean;
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
 * Each refresh returns a new refresh token and invalidates the old one, so the one in
 * the environment works exactly once. Every later refresh uses the newest.
 */
let rotated: { from: string; to: string } | null = null;

/**
 * Get a usable access token: the direct one if configured, otherwise refresh via
 * Ring's OAuth endpoint (cached until shortly before it expires).
 */
export async function getRingAccessToken(config: RingConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;
  if (!config.refreshToken || !config.clientId || !config.clientSecret) {
    throw new Error(
      'Ring auth not configured: set RING_ACCESS_TOKEN, or RING_REFRESH_TOKEN with client id/secret.',
    );
  }
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const refreshToken = rotated?.from === config.refreshToken ? rotated.to : config.refreshToken;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
  const json = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!json.access_token) throw new Error('Ring token refresh returned no access_token.');
  if (json.refresh_token) rotated = { from: config.refreshToken, to: json.refresh_token };
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 - 60_000,
  };
  return json.access_token;
}

/**
 * Normalise the /v1/devices response into a plain list. Ring answers in JSON:API
 * (`{ data: [{ type: 'devices', id, attributes: { name } }] }`, with related resources
 * such as status in a top-level `included` when asked for). Defensive, like the webhook
 * adapter: takes the id and a human label where present, tolerates an unknown shape,
 * and never throws on a device it doesn't recognise.
 */
export function parseDevices(json: unknown): RingDevice[] {
  const envelope = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const items = Array.isArray(json)
    ? json
    : Array.isArray(envelope['data'])
      ? envelope['data']
      : Array.isArray(envelope['devices'])
        ? envelope['devices']
        : [];
  const included = Array.isArray(envelope['included']) ? envelope['included'] : [];
  const out: RingDevice[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    const attributes = record(d['attributes']);
    const id = str(d['id']) ?? str(d['device_id']);
    if (!id) continue;
    // In JSON:API `type` is the resource type, always "devices": not a kind of device.
    const type = str(d['type']);
    const kind = str(d['kind']) ?? (type && type !== 'devices' ? type : undefined);
    const description = str(d['description']) ?? str(d['name']) ?? str(attributes['name']);
    const statusRef = record(record(record(d['relationships'])['status'])['data']);
    const status = included
      .map(record)
      .find((r) => r['type'] === statusRef['type'] && r['id'] === statusRef['id']);
    const online = status ? record(status['attributes'])['online'] : undefined;
    out.push({
      id,
      ...(kind ? { kind } : {}),
      ...(description ? { description } : {}),
      ...(typeof online === 'boolean' ? { online } : {}),
    });
  }
  return out;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

async function failure(res: Response, what: string): Promise<Error> {
  const text = await res.text().catch(() => '');
  return new Error(`Ring ${what} failed (${res.status}): ${text.slice(0, 300)}`);
}

/** List the real devices on the linked Ring account, with whether each is online. */
export async function listRingDevices(accessToken: string): Promise<RingDevice[]> {
  const res = await fetch(`${DEVICES_URL}?include=status`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw await failure(res, 'devices fetch');
  return parseDevices(await res.json());
}

/**
 * One entry in a device's Event History: what happened and when, never a picture and
 * never who. `type` is Ring's event type (`motion`, `ding` for the doorbell button,
 * `on_demand` for a live view someone opened); `subType` is the motion classification
 * when Ring gives one (`human`, `vehicle`, `animal`, `other_motion`).
 */
export interface RingHistoryEvent {
  id: string;
  type: string;
  subType?: string;
  deviceId?: string;
  /** Epoch milliseconds. */
  start: number;
  end?: number;
}

/**
 * Normalise an Event History page. `next` is Ring's own cursor URL (relative, with the
 * original filters), or null on the last page. An `event_type` written the way the
 * filter is (`motion.human`) is split into type and subtype.
 */
export function parseHistory(json: unknown): { events: RingHistoryEvent[]; next: string | null } {
  const envelope = record(json);
  const items = Array.isArray(envelope['data']) ? envelope['data'] : [];
  const events: RingHistoryEvent[] = [];
  for (const raw of items) {
    const e = record(raw);
    const attributes = record(e['attributes']);
    const id = str(e['id']);
    const eventType = str(attributes['event_type']);
    const start = Number(attributes['start']);
    if (!id || !eventType || !Number.isFinite(start) || start <= 0) continue;
    const [type, subType] = eventType.toLowerCase().split('.', 2) as [string, string | undefined];
    const end = Number(attributes['end']);
    const deviceId = str(record(record(record(e['relationships'])['source'])['data'])['id']);
    events.push({
      id,
      type,
      ...(subType ? { subType } : {}),
      ...(deviceId ? { deviceId } : {}),
      start,
      ...(Number.isFinite(end) && end > 0 ? { end } : {}),
    });
  }
  return { events, next: str(record(envelope['links'])['next']) ?? null };
}

/**
 * One page of a device's Event History, newest first. Ring only returns events from
 * after the account owner consented to the app. Pass `next` from the previous page to
 * continue; `eventTypes` filters by type, or by type and subtype (`motion.human`).
 */
export async function listRingHistory(
  accessToken: string,
  deviceId: string,
  options: { eventTypes?: string[]; next?: string | null } = {},
): Promise<{ events: RingHistoryEvent[]; next: string | null }> {
  const url = options.next
    ? new URL(options.next, API_BASE)
    : new URL(`/v1/history/devices/${encodeURIComponent(deviceId)}/events`, API_BASE);
  // Ring's cursor is only ever a path on its own API; never send the token elsewhere.
  if (url.origin !== API_BASE) throw new Error(`Ring history cursor is not on ${API_BASE}.`);
  if (!options.next && options.eventTypes?.length) {
    url.searchParams.set('event_types', options.eventTypes.join(','));
  }
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw await failure(res, 'history fetch');
  const page = parseHistory(await res.json());
  // A filtered query names the subtype even when the event record does not.
  const only = options.eventTypes?.length === 1 ? options.eventTypes[0]!.split('.', 2) : [];
  if (only[1]) {
    for (const e of page.events) if (e.type === only[0] && !e.subType) e.subType = only[1];
  }
  return page;
}

/** A still from the doorbell: the image Ring returned and what Ring says it is. */
export interface RingSnapshot {
  bytes: Uint8Array;
  contentType: string;
  /** When the frame was captured, epoch ms (`X-Media-Timestamp`). */
  capturedAt?: number;
  /** `recording` (a frame from video) or `snapshot` (a stored still), per `X-Media-Origin`. */
  origin?: string;
}

/**
 * The doorbell's picture at a moment, e.g. an Event History event's start. Ring answers
 * the POST with a 303 to a short-lived pre-signed URL on another host; the redirect is
 * followed by hand so the access token is only ever sent to Ring's API.
 */
export async function fetchRingSnapshot(
  accessToken: string,
  deviceId: string,
  at: number,
  options: { format?: 'jpeg' | 'png' } = {},
): Promise<RingSnapshot> {
  const res = await fetch(`${DEVICES_URL}/${encodeURIComponent(deviceId)}/media/image/download`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'at_timestamp',
      timestamp: Math.round(at),
      image_options: { format: options.format ?? 'jpeg' },
    }),
    redirect: 'manual',
  });
  const location = res.headers.get('location');
  const image = res.status >= 300 && res.status < 400 && location ? await fetch(location) : res;
  if (!image.ok) throw await failure(image, 'snapshot download');
  const capturedAt = Number(image.headers.get('x-media-timestamp'));
  const origin = image.headers.get('x-media-origin');
  return {
    bytes: new Uint8Array(await image.arrayBuffer()),
    contentType: image.headers.get('content-type') ?? 'application/octet-stream',
    ...(Number.isFinite(capturedAt) && capturedAt > 0 ? { capturedAt } : {}),
    ...(origin ? { origin } : {}),
  };
}
