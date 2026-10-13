import {
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

/**
 * A DynamoDB table in memory, for tests: it answers the commands DynamoPersistence
 * sends, and refuses a transaction whose version condition fails the way DynamoDB does -
 * a TransactionCanceledException, with a reason per item and nothing written.
 */

export type Item = { pk: string; sk: string; [k: string]: unknown };

export interface FakeTable {
  client: DynamoDBDocumentClient;
  rows: Map<string, Item>;
  /** Called at the start of every scan: lets a test land a write in the middle of a read. */
  onScan?: () => void;
}

const keyOf = (k: { pk?: unknown; sk?: unknown }) => `${String(k.pk)}|${String(k.sk)}`;

export function fakeTable(): FakeTable {
  const rows = new Map<string, Item>();
  const table: FakeTable = {
    rows,
    client: {
      send: async (cmd: unknown) => {
        if (cmd instanceof ScanCommand) {
          table.onScan?.();
          return { Items: [...rows.values()].map((r) => structuredClone(r)) };
        }
        if (cmd instanceof GetCommand) {
          const item = rows.get(keyOf(cmd.input.Key ?? {}));
          return item ? { Item: structuredClone(item) } : {};
        }
        if (cmd instanceof PutCommand) {
          // Only the lease's condition: free, ours, or lapsed.
          const item = cmd.input.Item as Item;
          const current = rows.get(keyOf(item));
          const v = cmd.input.ExpressionAttributeValues ?? {};
          if (
            current &&
            current['holder'] !== v[':me'] &&
            !((current['until'] as number) < v[':now'])
          ) {
            throw Object.assign(new Error('The conditional request failed'), {
              name: 'ConditionalCheckFailedException',
            });
          }
          rows.set(keyOf(item), structuredClone(item));
          return {};
        }
        if (cmd instanceof TransactWriteCommand) {
          const ops = cmd.input.TransactItems ?? [];
          // Check every condition first: a transaction lands whole or not at all.
          const reasons = ops.map((op) => {
            const u = op.Update;
            if (!u?.ConditionExpression) return { Code: 'None' };
            const current = rows.get(keyOf(u.Key ?? {}));
            const ok = u.ConditionExpression.startsWith('attribute_not_exists')
              ? current === undefined
              : current?.['v'] === u.ExpressionAttributeValues?.[':expected'];
            return { Code: ok ? 'None' : 'ConditionalCheckFailed' };
          });
          if (reasons.some((r) => r.Code !== 'None')) {
            throw Object.assign(new Error('Transaction cancelled'), {
              name: 'TransactionCanceledException',
              CancellationReasons: reasons,
            });
          }
          for (const op of ops) {
            if (op.Put) rows.set(keyOf(op.Put.Item as Item), structuredClone(op.Put.Item) as Item);
            if (op.Delete) rows.delete(keyOf(op.Delete.Key ?? {}));
            if (op.Update) {
              const key = op.Update.Key as { pk: string; sk: string };
              rows.set(keyOf(key), { ...key, v: op.Update.ExpressionAttributeValues?.[':next'] });
            }
          }
          return {};
        }
        throw new Error('unexpected command');
      },
    } as unknown as DynamoDBDocumentClient,
  };
  return table;
}
