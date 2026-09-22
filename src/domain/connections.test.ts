import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeConnections } from './connections.ts';

const env = (o: Record<string, string>): NodeJS.ProcessEnv => o as NodeJS.ProcessEnv;

test('an unconfigured door reports not_connected with how to connect it', () => {
  const { connections } = describeConnections(env({}), []);
  const bee = connections.find((c) => c.source === 'bee')!;
  assert.equal(bee.status, 'not_configured');
  assert.match(bee.detail, /BEE_TOKEN/);
});

test('configured but silent is told apart from live', () => {
  const e = env({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_RECIPIENTS: '{"m":"1"}' });
  const quiet = describeConnections(e, []).connections.find((c) => c.source === 'telegram')!;
  assert.equal(quiet.status, 'configured');

  const live = describeConnections(e, [{ source: 'telegram', occurredAt: '2026-09-22T10:00:00Z' }])
    .connections.find((c) => c.source === 'telegram')!;
  assert.equal(live.status, 'live');
  assert.equal(live.lastEventAt, '2026-09-22T10:00:00Z');
});

test('telegram names family-group mode when a group is set', () => {
  const c = describeConnections(
    env({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_RECIPIENTS: '{"m":"1"}', TELEGRAM_GROUP_CHAT_ID: '-5' }),
    [{ source: 'telegram', occurredAt: '2026-09-22T10:00:00Z' }],
  ).connections.find((x) => x.source === 'telegram')!;
  assert.match(c.detail, /family-group mode/);
});

test('gmail is driven by the same Google OAuth vars, and reads the email source', () => {
  const e = env({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', GOOGLE_REFRESH_TOKEN: 'c' });
  const rep = describeConnections(e, [{ source: 'email', occurredAt: '2026-09-20T09:00:00Z' }]);
  const gmail = rep.connections.find((c) => c.source === 'gmail')!;
  const cal = rep.connections.find((c) => c.source === 'calendar')!;
  assert.equal(gmail.status, 'live');       // an 'email' event lights up Gmail
  assert.equal(cal.status, 'configured');   // same creds, but no calendar event yet
});

test('the spoken summary groups live, quiet and unset sources', () => {
  const { spoken } = describeConnections(
    env({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_RECIPIENTS: '{"m":"1"}' }),
    [{ source: 'telegram', occurredAt: '2026-09-22T10:00:00Z' }],
  );
  assert.match(spoken, /Live: Telegram/);
  assert.match(spoken, /Not set up yet:.*Bee/);
});
