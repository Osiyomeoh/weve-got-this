import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AGENT_ID } from '../domain/agent.js';
import type { Member } from '../domain/types.js';
import { RecordOnlyNotifier, type Notifier } from '../notify/notifier.js';
import type { CareStore } from '../store/store.js';
import type { ToolContext } from './toolkit.js';
import {
  registerAddNote,
  registerLogCareEvent,
  registerRecordAppointment,
} from './tools/record.js';
import {
  registerAssignObligation,
  registerClaimObligation,
  registerConfirmProposal,
  registerGetCareGaps,
  registerResolveObligation,
} from './tools/ownership.js';
import {
  registerGetMyRequests,
  registerNotifyMember,
  registerRequestOwner,
  registerRespondToRequest,
  registerRunCareAgent,
} from './tools/delegation.js';
import {
  registerGetCareSummary,
  registerGetConnections,
  registerGetProvenance,
  registerGetShiftBrief,
} from './tools/insight.js';
import { registerIngestSignal } from './tools/signals.js';
import { registerConfirmPurchase, registerReorderPrescription } from './tools/commerce.js';
import {
  registerAddMedication,
  registerAddMember,
  registerCreateHousehold,
  registerGetStarted,
  registerRemoveMember,
} from './tools/onboarding.js';
import {
  registerCareBoardResource,
  registerCareStateResource,
  registerMeResource,
} from './resources.js';
import { registerDailyCheckPrompt, registerWeeklyReviewPrompt } from './prompts.js';

/**
 * The CareCircle MCP server: one per session, bound to the member its credential
 * speaks for.
 *
 * This file only assembles it. Each tool lives with its neighbours in `tools/`, built
 * from the same `ToolContext`; what they share - spoken replies, guidance errors,
 * validators - is in `toolkit.ts`, and every output contract is in `output-schemas.ts`.
 *
 * Tool descriptions are what the planner reads, so they are a measured artifact: the
 * published tool-selection figure is for these exact words, in this order. Some of
 * their examples still use the first demo family's names ("ask David if he can drive
 * her"). They change together with a fresh `npm run evals`, never as a tidy-up.
 */

export interface ServerContext {
  store: CareStore;
  /** Who is speaking. Established by the session credential, never by the conversation. */
  actorId: string;
  /** Injectable for deterministic tests and demos. */
  now?: () => Date;
  /** How a notify_member message is delivered. Defaults to record-only. */
  notifier?: Notifier;
}

type Handler = (...args: unknown[]) => unknown;

export function createCareCircleServer({ store, actorId, ...opts }: ServerContext): McpServer {
  const server = new McpServer(
    { name: 'carecircle', version: '0.1.0' },
    {
      capabilities: { tools: {}, resources: {}, prompts: {} },
      instructions:
        'CareCircle tracks what needs to happen for someone being cared for, and who is '
        + 'responsible for it. Speak results as written - they are phrased for a voice '
        + 'assistant. Never say that someone did not take a medication or did not do '
        + 'something: the system only knows what has been recorded, and an absent record '
        + 'is not evidence. When a tool returns an error, follow the instruction in it.',
    },
  );

  // Hosts check a tool's structured result against its declared output schema and
  // reject any field it does not declare. A field added to a result but not to OUT
  // therefore breaks that tool for every real client while handler-level tests still
  // pass - it happened to ingest_signal and to the purchase tools. So every result is
  // checked here, on every call, and the first test that touches the tool fails.
  const registerTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: { outputSchema?: z.ZodRawShape }, handler: Handler) =>
    registerTool(name, config as never, (async (...args: unknown[]) => {
      const result = await handler(...args) as { structuredContent?: unknown };
      if (config.outputSchema && result.structuredContent !== undefined) {
        const check = z.object(config.outputSchema).strict().safeParse(result.structuredContent);
        if (!check.success) {
          throw new Error(`${name} returned a result its output schema does not declare: ${check.error.message}`);
        }
      }
      return result;
    }) as never)) as typeof server.registerTool;

  const actor = (): Member => store.getMember(actorId);
  const household = () => actor().householdId;
  const ctx: ToolContext = {
    server, store, actorId, actor, household,
    now: opts.now ?? (() => new Date()),
    notifier: opts.notifier ?? new RecordOnlyNotifier(),
    state: () => store.getCareState(household()),
    nameOf: (id) => {
      if (!id) return undefined;
      // The agent is a reporter in the log like anyone else, and must be nameable, or
      // its requests read as coming from nobody. It is not a member and holds no work.
      if (id === AGENT_ID) return 'CareCircle';
      try {
        const m = store.getMember(id);
        return m.spokenAs ?? m.name;
      } catch { return undefined; }
    },
  };

  // Tools, in the order the planner sees them in tools/list. The order is part of what
  // the tool-selection evals measured; change it and re-run them.
  registerLogCareEvent(ctx);
  registerRecordAppointment(ctx);
  registerAddNote(ctx);
  registerGetCareGaps(ctx);
  registerClaimObligation(ctx);
  registerAssignObligation(ctx);
  registerRequestOwner(ctx);
  registerRespondToRequest(ctx);
  registerGetMyRequests(ctx);
  registerGetProvenance(ctx);
  registerGetConnections(ctx);
  registerConfirmProposal(ctx);
  registerResolveObligation(ctx);
  registerRunCareAgent(ctx);
  registerGetCareSummary(ctx);
  registerGetShiftBrief(ctx);
  registerNotifyMember(ctx);
  registerIngestSignal(ctx);
  registerReorderPrescription(ctx);
  registerConfirmPurchase(ctx);
  registerGetStarted(ctx);
  registerCreateHousehold(ctx);
  registerAddMember(ctx);
  registerAddMedication(ctx);
  registerRemoveMember(ctx);

  registerMeResource(ctx);
  registerCareStateResource(ctx);
  registerCareBoardResource(ctx);
  registerDailyCheckPrompt(ctx);
  registerWeeklyReviewPrompt(ctx);

  return server;
}
