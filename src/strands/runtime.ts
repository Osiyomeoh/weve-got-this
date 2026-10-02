import express from 'express';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Model } from '@strands-agents/sdk';
import { createCareCircleServer } from '../mcp/server.js';
import type { Notifier } from '../notify/notifier.js';
import type { CareStore } from '../store/store.js';
import { log } from '../obs/log.js';
import { traceFields } from '../obs/trace.js';
import type { Channel } from '../sim/host.js';
import { StrandsAlexa, type StrandsTurnResult } from './host.js';

/**
 * The CareCircle planner as a Bedrock AgentCore Runtime agent.
 *
 * AgentCore Runtime runs a container and speaks HTTP to it on port 8080: GET /ping for
 * health, POST /invocations for work, and a header naming the runtime session. Each
 * session gets its own microVM, so a conversation kept in this process is the session's
 * own; the care record is not kept here, it is read fresh from the store (DynamoDB when
 * deployed) before every turn, the same as the MCP server does.
 *
 * Who is speaking comes from the caller, which AgentCore has already authenticated with
 * IAM (SigV4): only a principal allowed bedrock-agentcore:InvokeAgentRuntime reaches this
 * code. It is checked against the care record, and every tool still acts as that member
 * with that member's permissions, through the real MCP server in-process.
 *
 *   POST /invocations  {"prompt": "Did Daddy take his drops?", "actorId": "m_david"}
 *   ->                 {"spoken": "...", "outcome": "answered", "tools": [...], "noBlame": {...}}
 */

export const SESSION_HEADER = 'x-amzn-bedrock-agentcore-runtime-session-id';
/** Longer than anything a family says to a voice assistant in one breath. */
const MAX_PROMPT = 2_000;
/** A session's conversation is dropped after this long quiet, as the Telegram chat's is. */
const IDLE_MS = 30 * 60_000;
/** The planner is told the date when a conversation opens; none outlives a few hours. */
const MAX_AGE_MS = 4 * 60 * 60_000;

export interface AgentRuntimeOptions {
  store: CareStore;
  model: Model;
  notifier?: Notifier;
  now?: () => Date;
  channel?: Channel;
}

interface Conversation {
  host: Promise<StrandsAlexa>;
  opened: number;
  lastUsed: number;
  queue: Promise<unknown>;
}

export interface InvocationReply {
  spoken: string;
  outcome: StrandsTurnResult['trace']['outcome'];
  tools: { name: string; isError: boolean }[];
  noBlame: StrandsTurnResult['noBlame'];
}

export function createAgentRuntime(opts: AgentRuntimeOptions): express.Express {
  const channel = opts.channel ?? 'voice';
  const conversations = new Map<string, Conversation>();
  let busy = 0;
  let lastUpdate = Math.floor(Date.now() / 1000);

  const drop = (key: string) => {
    const c = conversations.get(key);
    conversations.delete(key);
    c?.host.then((h) => h.close()).catch(() => undefined);
  };

  const open = async (actorId: string): Promise<StrandsAlexa> => {
    const server = createCareCircleServer({
      store: opts.store, actorId,
      ...(opts.notifier ? { notifier: opts.notifier } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    return StrandsAlexa.over(clientSide, { model: opts.model, channel, ...(opts.now ? { now: opts.now } : {}) });
  };

  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // HealthyBusy tells AgentCore a turn is in flight, so the session is not reclaimed mid-turn.
  app.get('/ping', (_req, res) => {
    res.json({ status: busy > 0 ? 'HealthyBusy' : 'Healthy', time_of_last_update: lastUpdate });
  });

  app.post('/invocations', async (req, res) => {
    const body = (req.body ?? {}) as { prompt?: unknown; actorId?: unknown };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const actorId = typeof body.actorId === 'string' ? body.actorId : '';
    if (!prompt || prompt.length > MAX_PROMPT) {
      res.status(400).json({ error: `prompt must be 1-${MAX_PROMPT} characters of text.` });
      return;
    }
    if (!actorId) {
      res.status(400).json({ error: 'actorId is required: the member who is speaking.' });
      return;
    }

    try { await opts.store.refresh(); } catch (err) {
      // As the MCP server does: serve on what this process holds; a stale write is still refused.
      log.warn('record refresh failed', { reason: (err as Error).name });
    }
    try { opts.store.getMember(actorId); } catch {
      res.status(404).json({ error: 'No such member in the care record.' });
      return;
    }

    const at = Date.now();
    for (const [k, c] of conversations) if (at - c.lastUsed > IDLE_MS || at - c.opened > MAX_AGE_MS) drop(k);
    // One conversation per session and speaker: a session is one microVM, which one device
    // may share between members of a household.
    const key = `${req.get(SESSION_HEADER) ?? 'local'}:${actorId}`;
    let c = conversations.get(key);
    if (!c) {
      c = { host: open(actorId), opened: at, lastUsed: at, queue: Promise.resolve() };
      conversations.set(key, c);
    }
    c.lastUsed = at;
    const conversation = c;

    busy++;
    const turn = conversation.queue.then(async () => (await conversation.host).say(prompt));
    conversation.queue = turn.catch(() => undefined);
    try {
      const result = await turn;
      log.info('agentcore turn', traceFields(result.trace));
      const reply: InvocationReply = {
        spoken: result.spoken,
        outcome: result.trace.outcome,
        tools: result.toolCalls.map((t) => ({ name: t.name, isError: t.isError })),
        noBlame: result.noBlame,
      };
      res.json(reply);
    } catch (err) {
      // A broken conversation is not kept: the next invocation starts a clean one.
      drop(key);
      log.warn('agentcore turn failed', { error: (err as Error).name });
      res.status(500).json({ error: "Sorry, I couldn't do that just now. Please try again in a minute." });
    } finally {
      busy--;
      lastUpdate = Math.floor(Date.now() / 1000);
    }
  });

  return app;
}
