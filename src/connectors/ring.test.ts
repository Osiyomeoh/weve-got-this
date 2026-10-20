import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  ringConfigFromEnv,
  parseDevices,
  parseHistory,
  listRingHistory,
  fetchRingSnapshot,
  getRingAccessToken,
} from './ring.ts';

test('a direct access token is the preferred auth mode', () => {
  const c = ringConfigFromEnv({
    RING_ACCESS_TOKEN: 'tok',
    RING_CLIENT_ID: 'x',
    RING_CLIENT_SECRET: 'y',
  });
  assert.deepEqual(c, { accessToken: 'tok' });
});

test('a refresh token needs the client id and secret', () => {
  assert.deepEqual(
    ringConfigFromEnv({ RING_REFRESH_TOKEN: 'r', RING_CLIENT_ID: 'id', RING_CLIENT_SECRET: 's' }),
    { refreshToken: 'r', clientId: 'id', clientSecret: 's' },
  );
  // A refresh token without credentials is not usable.
  assert.equal(ringConfigFromEnv({ RING_REFRESH_TOKEN: 'r' }), null);
});

test('no credentials means no config', () => {
  assert.equal(ringConfigFromEnv({}), null);
});

test('devices parse from a top-level array', () => {
  const devices = parseDevices([
    { id: 'dev_1', kind: 'doorbell', description: 'Front Door' },
    { device_id: 'dev_2', type: 'camera', name: 'Backyard' },
  ]);
  assert.deepEqual(devices, [
    { id: 'dev_1', kind: 'doorbell', description: 'Front Door' },
    { id: 'dev_2', kind: 'camera', description: 'Backyard' },
  ]);
});

test('devices parse from a { devices: [...] } envelope, tolerating junk', () => {
  const devices = parseDevices({ devices: [{ id: 'dev_1' }, null, { noId: true }, 'nope'] });
  assert.deepEqual(devices, [{ id: 'dev_1' }]);
});

test('an unexpected shape yields an empty list, never a throw', () => {
  assert.deepEqual(parseDevices(null), []);
  assert.deepEqual(parseDevices({ unexpected: 1 }), []);
});

// Ring's documented /v1/devices?include=status,capabilities answer (a JSON:API compound
// document), trimmed to what the parser reads.
const DEVICES_DOC = {
  meta: { time: '2026-02-14T22:57:16Z' },
  data: [
    {
      type: 'devices',
      id: 'ava1.ring.device.XXXYYY',
      attributes: { name: 'Office' },
      relationships: {
        status: {
          data: { type: 'device-status', id: 'ava1.ring.device.status.XXXYYY' },
          links: { related: '/v1/devices/ava1.ring.device.XXXYYY/status' },
        },
      },
    },
  ],
  included: [
    { type: 'device-status', id: 'ava1.ring.device.status.XXXYYY', attributes: { online: true } },
  ],
};

test("devices parse from Ring's JSON:API answer, with status from `included`", () => {
  assert.deepEqual(parseDevices(DEVICES_DOC), [
    { id: 'ava1.ring.device.XXXYYY', description: 'Office', online: true },
  ]);
});

// Ring's documented Event History page.
const HISTORY_PAGE = {
  data: [
    {
      type: 'history-events',
      id: 'evt_live',
      attributes: {
        event_type: 'on_demand',
        is_third_party_reviewed: true,
        start: 1699457230000,
        end: 1699457260000,
      },
      relationships: { source: { data: { type: 'devices', id: 'dev_front' } } },
    },
    {
      type: 'history-events',
      id: 'evt_motion',
      attributes: { event_type: 'motion.human', start: 1699457200000, end: 1699457225000 },
      relationships: { source: { data: { type: 'devices', id: 'dev_front' } } },
    },
    { type: 'history-events', id: 'no_time', attributes: { event_type: 'ding' } },
  ],
  links: { next: '/v1/history/devices/dev_front/events?page[key]=2025-07-06T11:11:00Z' },
};

test('a history page parses newest first, keeps the cursor, and skips undated junk', () => {
  const page = parseHistory(HISTORY_PAGE);
  assert.deepEqual(page.events, [
    {
      id: 'evt_live',
      type: 'on_demand',
      deviceId: 'dev_front',
      start: 1699457230000,
      end: 1699457260000,
    },
    {
      id: 'evt_motion',
      type: 'motion',
      subType: 'human',
      deviceId: 'dev_front',
      start: 1699457200000,
      end: 1699457225000,
    },
  ]);
  assert.equal(page.next, '/v1/history/devices/dev_front/events?page[key]=2025-07-06T11:11:00Z');
  assert.deepEqual(parseHistory({ data: [] }), { events: [], next: null });
  assert.deepEqual(parseHistory('nope'), { events: [], next: null });
});

/** Swap in a fetch that records each call and answers from a list. */
function stubFetch(t: TestContext, answers: Array<(url: string, init?: RequestInit) => Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected fetch ${url}`);
    return answer(url, init);
  });
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('history asks Ring for the filtered events, and a one-subtype filter names the subtype', async (t) => {
  const calls = stubFetch(t, [
    () =>
      json({
        data: [{ id: 'e1', attributes: { event_type: 'motion', start: 1700000000000 } }],
      }),
  ]);
  const page = await listRingHistory('tok', 'dev_front', { eventTypes: ['motion.human'] });
  assert.equal(
    calls[0]!.url,
    'https://api.amazonvision.com/v1/history/devices/dev_front/events?event_types=motion.human',
  );
  assert.equal(new Headers(calls[0]!.init?.headers).get('authorization'), 'Bearer tok');
  assert.equal(page.events[0]!.subType, 'human');
  assert.equal(page.next, null);
});

test("history follows Ring's own cursor, and refuses one that points anywhere else", async (t) => {
  const calls = stubFetch(t, [() => json({ data: [] })]);
  await listRingHistory('tok', 'dev_front', { next: HISTORY_PAGE.links.next });
  assert.equal(
    calls[0]!.url,
    'https://api.amazonvision.com/v1/history/devices/dev_front/events?page[key]=2025-07-06T11:11:00Z',
  );
  await assert.rejects(
    listRingHistory('tok', 'dev_front', { next: 'https://evil.example/steal' }),
    /not on https:\/\/api\.amazonvision\.com/,
  );
  assert.equal(calls.length, 1);
});

test('a Ring error is reported with its status, not swallowed', async (t) => {
  stubFetch(t, [() => json({ errors: [{ status: '401', code: 'UNAUTHORIZED' }] }, 401)]);
  await assert.rejects(listRingHistory('old', 'dev_front'), /history fetch failed \(401\)/);
});

test('a snapshot follows the 303 by hand, without sending the token to the download host', async (t) => {
  const calls = stubFetch(t, [
    () =>
      new Response(null, {
        status: 303,
        headers: { location: 'https://download-us.example.com/v1/download?security_token=s' },
      }),
    () =>
      new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'x-media-timestamp': '1699457230000',
          'x-media-origin': 'snapshot',
        },
      }),
  ]);
  const shot = await fetchRingSnapshot('tok', 'dev_front', 1699457230000);
  assert.equal(
    calls[0]!.url,
    'https://api.amazonvision.com/v1/devices/dev_front/media/image/download',
  );
  assert.equal(calls[0]!.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    type: 'at_timestamp',
    timestamp: 1699457230000,
    image_options: { format: 'jpeg' },
  });
  assert.equal(calls[0]!.init?.redirect, 'manual');
  assert.equal(calls[1]!.url, 'https://download-us.example.com/v1/download?security_token=s');
  assert.equal(calls[1]!.init?.headers, undefined);
  assert.deepEqual(shot, {
    bytes: new Uint8Array([0xff, 0xd8, 0xff]),
    contentType: 'image/jpeg',
    capturedAt: 1699457230000,
    origin: 'snapshot',
  });
});

test('a snapshot Ring has no media for fails with its status', async (t) => {
  stubFetch(t, [() => json({ errors: [{ status: '416', code: 'MEDIA_NOT_FOUND' }] }, 416)]);
  await assert.rejects(
    fetchRingSnapshot('tok', 'dev_front', 1),
    /snapshot download failed \(416\)/,
  );
});

test('each refresh uses the refresh token Ring handed back last, since the old one is spent', async (t) => {
  const sent: string[] = [];
  const answer = (access: string, refresh: string) => (_url: string, init?: RequestInit) => {
    sent.push(new URLSearchParams(String(init?.body)).get('refresh_token') ?? '');
    // Already expired, so the next call refreshes again.
    return json({ access_token: access, refresh_token: refresh, expires_in: 0 });
  };
  stubFetch(t, [answer('a1', 'r2'), answer('a2', 'r3')]);
  const config = { refreshToken: 'r1-rotation-test', clientId: 'id', clientSecret: 's' };
  assert.equal(await getRingAccessToken(config), 'a1');
  assert.equal(await getRingAccessToken(config), 'a2');
  assert.deepEqual(sent, ['r1-rotation-test', 'r2']);
});
