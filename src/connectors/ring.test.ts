import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringConfigFromEnv, parseDevices } from './ring.ts';

test('a direct access token is the preferred auth mode', () => {
  const c = ringConfigFromEnv({ RING_ACCESS_TOKEN: 'tok', RING_CLIENT_ID: 'x', RING_CLIENT_SECRET: 'y' });
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
