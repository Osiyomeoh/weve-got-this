import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchWriteCommand, ScanCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoPersistence } from './dynamo.ts';
import { CareStore } from './store.ts';

/** A table in memory that answers the two commands the persistence layer sends. */
function fakeTable(): DynamoDBDocumentClient {
  const items = new Map<string, Record<string, unknown>>();
  return {
    send: async (cmd: unknown) => {
      if (cmd instanceof ScanCommand) return { Items: [...items.values()] };
      if (cmd instanceof BatchWriteCommand) {
        for (const reqs of Object.values(cmd.input.RequestItems ?? {})) {
          for (const r of reqs) {
            if (r.PutRequest) items.set(`${r.PutRequest.Item['pk']}|${r.PutRequest.Item['sk']}`, r.PutRequest.Item);
            if (r.DeleteRequest) items.delete(`${r.DeleteRequest.Key!['pk']}|${r.DeleteRequest.Key!['sk']}`);
          }
        }
        return {};
      }
      throw new Error('unexpected command');
    },
  } as unknown as DynamoDBDocumentClient;
}

test('a Telegram link survives a restart, and goes when the member does', async () => {
  const client = fakeTable();
  const first = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await first.init();
  await first.addHousehold({ id: 'h1', name: 'circle', timezone: 'Africa/Lagos' });
  await first.addMember({ id: 'm_ann', householdId: 'h1', name: 'Ann', role: 'primary_caregiver' });
  await first.linkTelegram({ telegramId: '222', memberId: 'm_ann', householdId: 'h1', linkedAt: '2026-09-24T10:00:00Z' });
  await first.quiesce();

  const second = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await second.init();
  assert.equal(second.telegramLinkFor('222')?.memberId, 'm_ann');

  await second.removeMember('h1', 'm_ann');
  await second.quiesce();
  const third = new CareStore(new DynamoPersistence({ tableName: 't', client }));
  await third.init();
  assert.equal(third.telegramLinkFor('222'), undefined);
});
