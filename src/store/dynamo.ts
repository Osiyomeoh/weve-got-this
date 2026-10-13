import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { StaleRecordError, type Persistence, type StoreSnapshot } from './store.js';

/**
 * DynamoDB persistence.
 *
 * A deployed CareCircle runs on a serverless runtime with no durable filesystem, so
 * the care record has to live somewhere the process does not own. This is the same
 * `Persistence` interface the JSON file implements - the store has no idea which is
 * behind it.
 *
 * Single-table design, one item per entity:
 *
 *   pk = HH#<householdId>      the care circle owns its data
 *   sk = <TYPE>#<id>           EVENT#, OBLIGATION#, MEMBER#, MED#, TRANSITION#, META#
 *
 * Partitioning by household matters beyond performance: it is the same boundary the
 * authorisation model enforces, so a query can never accidentally span families.
 *
 * `save()` receives a whole snapshot, but rewriting every item on every tool call
 * would be wasteful and would burn write capacity for nothing. So we diff against
 * what we last wrote and send only what changed.
 *
 * More than one process can write the table: a second instance, or a script such as the
 * production demo reset. So the record carries a version (pk META, sk VERSION). A save is
 * one transaction: the rows that changed, and "move the version on, if it is still the one
 * I read". If another process wrote first, the whole save is refused - nothing of it lands
 * - and the caller learns it with a StaleRecordError, rather than overwriting a record it
 * has not seen. `stale()` is one read of that version, cheap enough to ask before every
 * request.
 */

type Entity =
  | { kind: 'HOUSEHOLD'; id: string }
  | { kind: 'MEMBER'; id: string }
  | { kind: 'EVENT'; id: string }
  | { kind: 'OBLIGATION'; id: string }
  | { kind: 'MED'; id: string }
  | { kind: 'TRANSITION'; id: string }
  | { kind: 'IDENTITY'; id: string }
  | { kind: 'TGLINK'; id: string }
  | { kind: 'ENTITY'; id: string };

interface Row {
  pk: string;
  sk: string;
  kind: Entity['kind'];
  body: unknown;
}

const HOUSEHOLDLESS = 'HH#_root';

/** The record's version: one item, moved on by every save. Not part of the snapshot. */
const VERSION_KEY = { pk: 'META', sk: 'VERSION' } as const;

/** A transaction holds at most 100 items; one of them is always the version. */
const TRANSACTION_ROWS = 99;

/** Every row the snapshot implies, keyed by `pk|sk` so two snapshots can be diffed. */
function rowsFor(snapshot: StoreSnapshot): Map<string, Row> {
  const rows = new Map<string, Row>();
  const add = (pk: string, kind: Entity['kind'], id: string, body: unknown) => {
    const sk = `${kind}#${id}`;
    rows.set(`${pk}|${sk}`, { pk, sk, kind, body });
  };

  for (const h of snapshot.households) add(`HH#${h.id}`, 'HOUSEHOLD', h.id, h);
  for (const m of snapshot.members) add(`HH#${m.householdId}`, 'MEMBER', m.id, m);
  for (const e of snapshot.events) add(`HH#${e.householdId}`, 'EVENT', e.id, e);
  for (const o of snapshot.obligations) add(`HH#${o.householdId}`, 'OBLIGATION', o.id, o);
  for (const m of snapshot.medications) add(`HH#${m.householdId}`, 'MED', m.id, m);
  for (const i of snapshot.identities) add(`HH#${i.householdId}`, 'IDENTITY', i.subject, i);
  for (const l of snapshot.telegramLinks ?? [])
    add(`HH#${l.householdId}`, 'TGLINK', l.telegramId, l);
  // Non-person nodes (the eye clinic). They were once left out here, so a restart lost them.
  for (const n of snapshot.entities ?? []) add(`HH#${n.householdId}`, 'ENTITY', n.id, n);
  for (const t of snapshot.transitions) {
    // Transitions carry no household of their own; they belong to their obligation.
    const owner = snapshot.obligations.find((o) => o.id === t.obligationId);
    const pk = owner ? `HH#${owner.householdId}` : HOUSEHOLDLESS;
    add(pk, 'TRANSITION', `${t.obligationId}#${t.at}#${t.to}`, t);
  }
  return rows;
}

function emptySnapshot(): StoreSnapshot {
  return {
    households: [],
    members: [],
    events: [],
    obligations: [],
    medications: [],
    transitions: [],
    identities: [],
    telegramLinks: [],
    entities: [],
  };
}

/** Rebuild a snapshot from rows. Order is restored where it carries meaning. */
function snapshotFrom(rows: Row[]): StoreSnapshot {
  const snapshot = emptySnapshot();
  for (const row of rows) {
    switch (row.kind) {
      case 'HOUSEHOLD':
        snapshot.households.push(row.body as never);
        break;
      case 'MEMBER':
        snapshot.members.push(row.body as never);
        break;
      case 'EVENT':
        snapshot.events.push(row.body as never);
        break;
      case 'OBLIGATION':
        snapshot.obligations.push(row.body as never);
        break;
      case 'MED':
        snapshot.medications.push(row.body as never);
        break;
      case 'TRANSITION':
        snapshot.transitions.push(row.body as never);
        break;
      case 'IDENTITY':
        snapshot.identities.push(row.body as never);
        break;
      case 'TGLINK':
        snapshot.telegramLinks!.push(row.body as never);
        break;
      case 'ENTITY':
        snapshot.entities!.push(row.body as never);
        break;
    }
  }
  // The event log is append-only and read in order; DynamoDB does not promise one.
  snapshot.events.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  snapshot.transitions.sort((a, b) => a.at.localeCompare(b.at));
  return snapshot;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface DynamoPersistenceOptions {
  tableName: string;
  region?: string;
  client?: DynamoDBDocumentClient;
}

export class DynamoPersistence implements Persistence {
  readonly #doc: DynamoDBDocumentClient;
  readonly #table: string;
  /** What we believe is in the table, so `save` can send only differences. */
  #written = new Map<string, string>();
  /** The version of the record that `#written` reflects. 0: none has been written yet. */
  #version = 0;

  constructor({ tableName, region, client }: DynamoPersistenceOptions) {
    this.#table = tableName;
    this.#doc =
      client ??
      DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /** The version of the record in the table now. */
  async #currentVersion(): Promise<number> {
    const out = await this.#doc.send(
      new GetCommand({ TableName: this.#table, Key: VERSION_KEY, ConsistentRead: true }),
    );
    return Number(out.Item?.['v'] ?? 0);
  }

  /** Whether another process has written since this one last read or wrote. */
  async stale(): Promise<boolean> {
    return (await this.#currentVersion()) !== this.#version;
  }

  /**
   * A lease is one item under META, so the record's scan never reads it. Taken when it is
   * free, lapsed, or already ours; one conditional put, so two instances cannot both win.
   */
  async lease(name: string, holder: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    try {
      await this.#doc.send(
        new PutCommand({
          TableName: this.#table,
          Item: { pk: VERSION_KEY.pk, sk: `LEASE#${name}`, holder, until: now + ttlMs },
          ConditionExpression: 'attribute_not_exists(pk) OR holder = :me OR #until < :now',
          ExpressionAttributeNames: { '#until': 'until' },
          ExpressionAttributeValues: { ':me': holder, ':now': now },
        }),
      );
      return true;
    } catch (err) {
      if ((err as Error).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  }

  async load(): Promise<StoreSnapshot | null> {
    // A scan is not a single read: a save landing half-way through would give a record
    // that never existed. So read the version on both sides, and scan again if it moved.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = await this.#currentVersion();
      const rows: Row[] = [];
      let startKey: Record<string, unknown> | undefined;
      do {
        const page = await this.#doc.send(
          new ScanCommand({
            TableName: this.#table,
            ConsistentRead: true,
            ...(startKey ? { ExclusiveStartKey: startKey } : {}),
          }),
        );
        for (const item of page.Items ?? [])
          if (item['pk'] !== VERSION_KEY.pk) rows.push(item as Row);
        startKey = page.LastEvaluatedKey;
      } while (startKey);
      if ((await this.#currentVersion()) !== before) continue;

      this.#version = before;
      // Seed the diff baseline so the first save does not rewrite everything we
      // just read back.
      this.#written = new Map(rows.map((r) => [`${r.pk}|${r.sk}`, JSON.stringify(r.body)]));
      return rows.length === 0 ? null : snapshotFrom(rows);
    }
    throw new Error(
      'The care record kept changing while it was being read. Try again in a moment.',
    );
  }

  async save(snapshot: StoreSnapshot): Promise<void> {
    const desired = rowsFor(snapshot);

    const puts: Row[] = [];
    for (const [key, row] of desired) {
      const serialised = JSON.stringify(row.body);
      if (this.#written.get(key) !== serialised) puts.push(row);
    }
    const deletes = [...this.#written.keys()].filter((key) => !desired.has(key));

    if (puts.length === 0 && deletes.length === 0) return;

    type Op = NonNullable<TransactWriteCommandInput['TransactItems']>[number];
    const ops: Array<{ op: Op; key: string; row?: Row }> = [
      ...puts.map((row) => ({
        op: { Put: { TableName: this.#table, Item: row } },
        key: `${row.pk}|${row.sk}`,
        row,
      })),
      ...deletes.map((key) => {
        const [pk = '', sk = ''] = key.split('|');
        return { op: { Delete: { TableName: this.#table, Key: { pk, sk } } }, key };
      }),
    ];

    // Almost every save is a handful of rows and one transaction. One that is larger (a
    // household removed) goes in several, each moving the version on from the last.
    for (const part of chunk(ops, TRANSACTION_ROWS)) {
      const next = this.#version + 1;
      const bump: Op = {
        Update: {
          TableName: this.#table,
          Key: VERSION_KEY,
          UpdateExpression: 'SET #v = :next',
          ConditionExpression: this.#version === 0 ? 'attribute_not_exists(pk)' : '#v = :expected',
          ExpressionAttributeNames: { '#v': 'v' },
          ExpressionAttributeValues:
            this.#version === 0 ? { ':next': next } : { ':next': next, ':expected': this.#version },
        },
      };
      try {
        await this.#doc.send(
          new TransactWriteCommand({ TransactItems: [...part.map((p) => p.op), bump] }),
        );
      } catch (err) {
        const reasons = (err as { CancellationReasons?: Array<{ Code?: string }> })
          .CancellationReasons;
        if (
          (err as Error).name === 'TransactionCanceledException' &&
          reasons?.at(-1)?.Code === 'ConditionalCheckFailed'
        ) {
          throw new StaleRecordError();
        }
        throw err;
      }
      // Only claim what actually landed.
      this.#version = next;
      for (const { key, row } of part) {
        if (row) this.#written.set(key, JSON.stringify(row.body));
        else this.#written.delete(key);
      }
    }
  }
}
