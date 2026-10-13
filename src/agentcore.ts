import type { Server } from 'node:http';
import { CareStore } from './store/store.js';
import { FilePersistence } from './store/persistence.js';
import { DynamoPersistence } from './store/dynamo.js';
import { seedDemoHousehold } from './demo/seed.js';
import { notifierFromEnv } from './notify/notifier.js';
import { loadConfig } from './config.js';
import { log } from './obs/log.js';
import { bedrockModel } from './strands/host.js';
import { createAgentRuntime } from './strands/runtime.js';

/**
 * Entrypoint for the CareCircle planner on Bedrock AgentCore Runtime (strands/runtime.ts).
 *
 * The same configuration as the MCP server (config.ts), on AgentCore's port, 8080. Deployed,
 * it reads and writes the same DynamoDB table as the MCP server, so the two are one care
 * record. It never seeds the demo family into a table: the MCP server owns that record.
 * Locally, on a file, it seeds as the MCP server does, so it can be tried with no AWS
 * beyond Bedrock.
 *
 *   PORT=8080 CARECIRCLE_DB=/tmp/cc.json npx tsx src/agentcore.ts
 *   curl -s localhost:8080/invocations -H 'content-type: application/json' \
 *     -d '{"prompt":"How is Daddy doing today?","actorId":"m_david"}'
 */

const config = (() => {
  try {
    return loadConfig({ ...process.env, PORT: process.env['PORT'] ?? '8080' });
  } catch (err) {
    log.error('configuration invalid; refusing to start', { reason: (err as Error).message });
    process.exit(1);
  }
})();

const persistence =
  config.persistence === 'dynamodb'
    ? new DynamoPersistence({
        tableName: config.tableName!,
        ...(config.region ? { region: config.region } : {}),
      })
    : new FilePersistence(config.dbPath);
const store = new CareStore(persistence);
const notifier = notifierFromEnv({ telegramLinked: (memberId) => store.telegramLinkOf(memberId) });
const model = bedrockModel();

const app = createAgentRuntime({ store, model, notifier });
const server: Server = app.listen(config.port, '0.0.0.0', () => {
  log.info('carecircle agent runtime listening', {
    port: config.port,
    storage: config.persistence,
    model: String(model.getConfig().modelId),
    ...(config.tableName ? { table: config.tableName } : {}),
  });
});

try {
  await store.init();
  if (config.persistence === 'file' && config.seedDemo) await seedDemoHousehold(store);
  log.info('care record ready', { households: store.householdCount() });
} catch (err) {
  log.error('storage init failed; serving with an empty record', {
    reason: (err as Error).message,
  });
}

const shutdown = (signal: string) => {
  log.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
