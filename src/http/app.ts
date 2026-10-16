import { createFamilyRoutes } from './family.js';
import { downloadTelegramFile, sendTelegramVoice } from '../notify/telegram.js';
import { transcribeOggOpus } from '../sim/transcribe.js';
import { synthesize } from '../sim/speech.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createCareCircleServer, createCareCircleServerV2 } from '../mcp/server.js';
import { createMcpHandler, isLegacyRequest } from '@modelcontextprotocol/server';
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node';
import type { CareStore } from '../store/store.js';
import { staticTokens, firstOf, BOOTSTRAP_PREFIX, type IdentityResolver } from './identity.js';
import { RecordOnlyNotifier, type Notifier } from '../notify/notifier.js';
import { log } from '../obs/log.js';
import { createRingWebhook } from './ring-webhook.js';
import { createWhatsAppWebhook, createWhatsAppVerify } from './whatsapp-webhook.js';
import { createTelegramWebhook } from './telegram-webhook.js';
import { createTelegramChat } from './telegram-chat.js';
import { providerFromEnv } from '../sim/providers.js';
import { OAuthProvider, oauthResolver } from './oauth.js';
import { createSandboxRoute, agentCopies } from './sandbox.js';
import { DEMO_HOUSEHOLD_ID } from '../demo/seed.js';
import { STORY_TIME_HEADER, storyAware, storyTimeFor, withStoryTime } from './story-clock.js';
import { CHANNEL_HEADER, channelOf, withChannel } from '../mcp/channel.js';
import { agentOfRequest, currentAgent, withAgent } from '../mcp/agent.js';

/**
 * Streamable HTTP transport (MCP spec 2025-11-25).
 *
 * The identity model lives here. Each member of a care circle holds their own
 * credential, and a session is bound to one member at initialize time. Everything
 * afterwards is attributed to that member - never to whoever the conversation
 * claims to be, because a model can be talked into believing anything about who
 * is speaking, and this server assigns responsibility for someone's medical care.
 *
 * A session whose credential later changes is rejected outright rather than
 * re-bound: that would be one person acting with another's authority.
 */

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  /** The member this session speaks for, fixed at initialize. */
  actorId: string;
  /** The AI agent its initialize named, if it is one we know ("Claude"). */
  agent: string | null;
}

const sessions = new Map<string, Session>();

export interface AppOptions {
  store: CareStore;
  /**
   * How a request's member is established. Defaults to the static token map for
   * local development; production passes a JWT resolver. See ./identity.ts.
   */
  identity?: IdentityResolver;
  /** token -> member id, used when no resolver is given. */
  tokens?: Map<string, string>;
  /** How notify_member delivers. Defaults to record-only. */
  notifier?: Notifier;
  /**
   * The clock. Defaults to real time. Injectable so a deterministic walkthrough can
   * run "as of" the moment the story is set - e.g. 8:05pm, when an evening dose is
   * genuinely overdue and the absence beat has something real to surface.
   */
  now?: () => Date;
  /**
   * Whether an authenticated-but-unmapped caller may bootstrap a new household. Only
   * applies to the built-in static resolver (ignored when `identity` is supplied).
   * Defaults to the CARECIRCLE_ALLOW_SELF_SIGNUP env var.
   */
  allowSelfSignup?: boolean;
}

/**
 * Build the MCP HTTP app. Exported as a factory so the identity and session rules
 * can be attacked directly in tests over real HTTP, rather than trusted.
 */
export function createCareCircleApp({
  store,
  identity,
  tokens,
  notifier,
  now,
  allowSelfSignup,
}: AppOptions): express.Express {
  // Runtime-provisioned members authenticate via the persisted identity map.
  const lookup = (subject: string): string | null =>
    store.resolveIdentity(subject)?.memberId ?? null;
  // An OAuth access token this server issued authenticates ahead of a demo token,
  // because it is the one we can actually verify. Composed in one place - see
  // resolverFromEnv - so the factory and the production entrypoint cannot disagree.
  const demoResolver = staticTokens(tokens ?? new Map(), lookup, allowSelfSignup);
  const oauthSecretForAuth = process.env['CARECIRCLE_OAUTH_SECRET'] ?? '';
  const resolver =
    identity ??
    (oauthSecretForAuth
      ? firstOf(oauthResolver(oauthSecretForAuth, lookup), demoResolver)
      : demoResolver);
  const messenger = notifier ?? new RecordOnlyNotifier();
  // What the MCP tools read as "now": the story time inside a sandbox copy that asked for
  // one (see story-clock.ts), the real time everywhere else.
  const clock = storyAware(now ?? (() => new Date()));
  // The record's own times about the work (who asked, who took it on) follow the same clock.
  store.useClock(clock);
  // And what it records says which AI agent carried it, when the client named one we know.
  store.useAgent(currentAgent);
  const app = express();

  // Before anything touches the care record, make sure this process has the latest of it: another
  // instance, or a script, may have written since. One small read when nothing changed. First in
  // the chain so the webhooks, mounted next, are covered too. A failure to check is not a failure
  // to serve: the request goes ahead on what this process holds, and a write made on it is still
  // refused if the record has moved on.
  app.use((req, _res, next) => {
    if (req.path === '/health') {
      next();
      return;
    }
    store
      .refresh()
      .catch((err: unknown) => log.warn('record refresh failed', { reason: (err as Error).name }))
      .finally(() => next());
  });

  // The Ring webhook is mounted BEFORE the JSON parser and takes the raw bytes.
  // An HMAC has to be computed over exactly what was sent: parse-then-restringify
  // changes key order and whitespace, and the signature stops matching.
  const ringKey = process.env['RING_HMAC_KEY'] ?? '';
  const ringHousehold = process.env['RING_HOUSEHOLD_ID'] ?? 'h_margaret';
  app.post(
    '/ring/webhook',
    express.raw({ type: '*/*', limit: '256kb' }),
    createRingWebhook({
      store,
      hmacKey: ringKey,
      householdId: ringHousehold,
      ...(now ? { now } : {}),
    }),
  );

  // The WhatsApp webhook, likewise mounted before the JSON parser so the HMAC is
  // computed over exactly the bytes Meta sent. GET verifies the subscription; POST
  // takes signed inbound replies. Both are absent-of-effect unless configured.
  const waSecret = process.env['WHATSAPP_APP_SECRET'] ?? '';
  const waVerify = process.env['WHATSAPP_VERIFY_TOKEN'] ?? '';
  const waHousehold = process.env['WHATSAPP_HOUSEHOLD_ID'] ?? ringHousehold;
  const waMemberByPhone = ((): Map<string, string> => {
    // Inverse of WHATSAPP_RECIPIENTS (member -> phone): phone -> member, for inbound.
    const raw = process.env['WHATSAPP_RECIPIENTS']?.trim();
    const m = new Map<string, string>();
    if (raw) {
      try {
        for (const [memberId, phone] of Object.entries(JSON.parse(raw) as Record<string, string>)) {
          m.set(phone, memberId);
        }
      } catch {
        /* a malformed map means no inbound mapping, not a crash */
      }
    }
    return m;
  })();
  app.get('/whatsapp/webhook', createWhatsAppVerify({ verifyToken: waVerify }));
  app.post(
    '/whatsapp/webhook',
    express.raw({ type: '*/*', limit: '256kb' }),
    createWhatsAppWebhook({
      store,
      appSecret: waSecret,
      verifyToken: waVerify,
      memberByPhone: waMemberByPhone,
      householdId: waHousehold,
      ...(now ? { now } : {}),
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // The Telegram webhook. Unlike Meta, Telegram does not sign the body - it echoes a
  // secret token in a header - so this needs no raw body and mounts after the JSON
  // parser. Absent-of-effect unless TELEGRAM_WEBHOOK_SECRET is set.
  const tgSecret = process.env['TELEGRAM_WEBHOOK_SECRET'] ?? '';
  const tgHousehold = process.env['TELEGRAM_HOUSEHOLD_ID'] ?? ringHousehold;
  const tgMemberByChat = ((): Map<string, string> => {
    // Inverse of TELEGRAM_RECIPIENTS (member -> chat id): chat id -> member, for inbound.
    const raw = process.env['TELEGRAM_RECIPIENTS']?.trim();
    const m = new Map<string, string>();
    if (raw) {
      try {
        for (const [memberId, chatId] of Object.entries(
          JSON.parse(raw) as Record<string, string>,
        )) {
          m.set(String(chatId), memberId);
        }
      } catch {
        /* a malformed map means no inbound mapping, not a crash */
      }
    }
    return m;
  })();
  const tgBotToken = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  // Talking to the app in Telegram, not only answering its asks. On whenever the bot
  // can reply at all; TELEGRAM_CHAT=off keeps the door to yes/no only. The family's chat is
  // run by the Strands planner, whose NoBlame check stands between the model and the family;
  // CARECIRCLE_PROVIDER=bedrock puts the hand-written loop back.
  const tgChat =
    tgBotToken && process.env['TELEGRAM_CHAT'] !== 'off'
      ? createTelegramChat({
          store,
          provider: providerFromEnv('strands'),
          notifier: messenger,
          ...(now ? { now } : {}),
        })
      : undefined;
  app.post(
    '/telegram/webhook',
    createTelegramWebhook({
      store,
      secretToken: tgSecret,
      botToken: tgBotToken,
      memberByChat: tgMemberByChat,
      householdId: tgHousehold,
      ...(now ? { now } : {}),
      ...(tgChat ? { chat: tgChat } : {}),
      log: (line) => console.info(line),
      calendarUrl: `${(process.env['CARECIRCLE_PUBLIC_URL'] ?? 'https://ypq2dfq2p7.us-east-1.awsapprunner.com').trim().replace(/\/+$/, '')}/family`,
      botUsername: process.env['TELEGRAM_BOT_USERNAME']?.trim() || 'carecircle0111_bot',
      ...(process.env['TELEGRAM_GROUP_CHAT_ID']?.trim()
        ? { groupChatId: process.env['TELEGRAM_GROUP_CHAT_ID'].trim() }
        : {}),
      // Voice notes in, voice notes out: Amazon Transcribe and Polly. For someone whose eyes
      // are recovering from surgery, speaking is easier than typing, and listening than reading.
      ...(tgChat && process.env['TELEGRAM_VOICE'] !== 'off'
        ? {
            // Each person's own language (their /language choice); English when unset.
            hear: async (fileId: string, languageCode: string) =>
              transcribeOggOpus(await downloadTelegramFile(tgBotToken, fileId), { languageCode }),
            speak: async (chatId: string, text: string, voice: string) => {
              const spoken = await synthesize(text, 'gentle', voice);
              await sendTelegramVoice(tgBotToken, chatId, spoken.audio);
            },
          }
        : {}),
    }),
  );

  // The family calendar: the same page in Telegram (a Mini App) and in a browser.
  app.use(
    createFamilyRoutes({
      store,
      botToken: tgBotToken,
      secret: tgSecret,
      demoHouseholdId: 'h_margaret',
      notifier: messenger,
      ...(now ? { now } : {}),
    }),
  );

  // --- OAuth 2.1 + PKCE -----------------------------------------------------
  // Enabled by setting a signing secret. Without one the endpoints are absent
  // rather than present-and-insecure: a half-configured auth server is worse than
  // no auth server, because it looks like protection.
  const oauthSecret = process.env['CARECIRCLE_OAUTH_SECRET'] ?? '';
  const oauthHousehold = process.env['CARECIRCLE_OAUTH_HOUSEHOLD']?.trim() || 'h_margaret';
  let bearerChallenge = 'Bearer realm="carecircle"';
  if (oauthSecret) {
    const oauth = new OAuthProvider({
      secret: oauthSecret,
      issuer: (process.env['CARECIRCLE_PUBLIC_URL'] ?? 'http://localhost:8787').replace(/\/$/, ''),
      // Demo sign-in asks who you are rather than authenticating you, so it must only
      // ever offer the demo household. Offering every household would let anyone who
      // opens this page sign in as a member of a real family and read their care record.
      members: () =>
        store
          .allMembers()
          .filter((m) => m.householdId === oauthHousehold)
          .map((m) => ({ id: m.id, name: m.spokenAs ?? m.name })),
      allowedRedirects: (process.env['CARECIRCLE_OAUTH_REDIRECTS'] ?? '')
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean),
      // Every agent that connects gets its own copy of the demo family (see sandbox.ts),
      // so two judges trying it at once never meet each other's yes. Only the demo family
      // can be copied; `off` keeps everyone in the shared one.
      ...(oauthHousehold === DEMO_HOUSEHOLD_ID && process.env['CARECIRCLE_OAUTH_COPIES'] !== 'off'
        ? { copies: agentCopies({ store, ...(now ? { now } : {}) }) }
        : {}),
      ...(now ? { now } : {}),
    });
    // RFC 9728 - how an MCP client finds the authorization server for this resource.
    app.get('/.well-known/oauth-protected-resource', oauth.protectedResource);
    // Path-suffixed form (RFC 9728 section 3.1), which MCP clients try first.
    app.get('/.well-known/oauth-protected-resource/mcp', oauth.protectedResource);
    app.post('/oauth/register', oauth.register);
    // Per-visitor demo copies for the console (see sandbox.ts). Tokens are signed
    // with the OAuth secret, so they verify through the same resolver as any other.
    app.post(
      '/sandbox',
      createSandboxRoute({
        store,
        key: process.env['CARECIRCLE_SANDBOX_KEY'] ?? '',
        secret: oauthSecret,
        issuer: oauth.issuer,
        ...(now ? { now } : {}),
      }),
    );
    // Point a 401 at the metadata, so a client can start discovery from the challenge.
    bearerChallenge = `Bearer realm="carecircle", resource_metadata="${oauth.resourceMetadataUrl}"`;
    app.get('/.well-known/oauth-authorization-server', oauth.metadata);
    app.get('/oauth/authorize', oauth.authorize);
    app.post('/oauth/token', oauth.token);
  }

  // One operational access line per request. Deliberately no body and no query: the
  // request carries PHI (medication names, notes) and it must never reach the logs.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      log.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - started,
        session: req.header('mcp-session-id') ?? undefined,
      });
    });
    next();
  });

  app.get('/health', (_req, res) => {
    // Report ready even before the store has loaded: the process is up and can serve.
    // A storage problem shows as households:0, not as a dead service.
    let households = -1;
    try {
      households = store.householdCount();
    } catch {
      /* not ready yet */
    }
    res.json({
      ok: true,
      protocol: '2025-11-25',
      sessions: sessions.size,
      identity: resolver.strategy,
      households,
    });
  });

  // The effective actor: a member id, or a bootstrap principal (`bootstrap:<subject>`)
  // that may only create its first household. Everything downstream is attributed to
  // whichever this returns, and the credential must keep resolving to the same one for
  // the life of the session.
  const actorFor = (req: express.Request): string | null => {
    const member = resolver.resolve(req);
    if (member) return member;
    const principal = resolver.principal(req);
    return principal ? `${BOOTSTRAP_PREFIX}${principal}` : null;
  };

  function rpcError(res: express.Response, status: number, code: number, message: string): void {
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
  }

  /** `connect` accepts the SDK's own transport; see docs/FRICTION-LOG.md for the cast. */
  type ConnectArg = Parameters<McpServer['connect']>[0];

  // MCP 2026-07-28: no initialize, no session. Every request carries its protocol version and
  // is answered by a server built for it alone, for the member its credential names, so any
  // instance can answer any request. The credential is checked in front, as for every
  // request; `legacy: 'reject'` because 2025-era requests never reach this handler - they
  // keep the session-based path below, unchanged for every client that speaks it.
  const modern = toNodeHandler(
    createMcpHandler(
      ({ authInfo }) =>
        createCareCircleServerV2({
          store,
          actorId: String(authInfo?.extra?.['actorId']),
          notifier: messenger,
          now: clock,
        }),
      { legacy: 'reject' },
    ),
  );

  // A sandbox copy may run on story time (see story-clock.ts). Set here, around the whole
  // request, so every tool the request reaches reads the same clock.
  app.use('/mcp', (req, _res, next) => {
    const actorId = actorFor(req);
    let householdId: string | undefined;
    try {
      householdId = actorId ? store.getMember(actorId).householdId : undefined;
    } catch {
      /* not a member yet */
    }
    withStoryTime(storyTimeFor(householdId, req.header(STORY_TIME_HEADER) ?? undefined), () =>
      withChannel(channelOf(req.header(CHANNEL_HEADER) ?? undefined), next),
    );
  });

  app.post('/mcp', async (req, res) => {
    const actorId = actorFor(req);
    if (!actorId) {
      res.set('WWW-Authenticate', bearerChallenge);
      rpcError(
        res,
        401,
        -32001,
        'Unauthorized: this server needs to know which member of the care circle you are.',
      );
      return;
    }

    // Which revision is this? The SDK's own classification, so this can never disagree with it.
    if (!(await isLegacyRequest(await toWebRequest(req, req.body), req.body))) {
      const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      (req as express.Request & { auth?: unknown }).auth = {
        token,
        clientId: 'carecircle',
        scopes: [],
        extra: { actorId },
      };
      // No session to remember the client by: each request names it in its own `_meta`.
      await withAgent(agentOfRequest(req.body), () => modern(req, res, req.body));
      return;
    }

    const sessionId = req.header('mcp-session-id');

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session) {
        rpcError(res, 404, -32001, 'Unknown session. Start a new one with initialize.');
        return;
      }
      // The credential and the session must agree for the whole life of the session.
      if (session.actorId !== actorId) {
        rpcError(
          res,
          403,
          -32001,
          'This session belongs to a different member of the care circle.',
        );
        return;
      }
      await withAgent(session.agent, () => session.transport.handleRequest(req, res, req.body));
      return;
    }

    if (!isInitializeRequest(req.body)) {
      rpcError(res, 400, -32000, 'Expected an initialize request to start a session.');
      return;
    }

    const server = createCareCircleServer({ store, actorId, notifier: messenger, now: clock });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport, actorId, agent: agentOfRequest(req.body) });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };

    try {
      await server.connect(transport as unknown as ConnectArg);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error('mcp request failed', { reason: (err as Error).message });
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    }
  });

  /** SSE stream for server-initiated messages, and session teardown. */
  for (const method of ['get', 'delete'] as const) {
    app[method]('/mcp', async (req, res) => {
      const actorId = actorFor(req);
      const sessionId = req.header('mcp-session-id');
      const session = sessionId ? sessions.get(sessionId) : undefined;
      if (!actorId || !session || session.actorId !== actorId) {
        rpcError(res, session ? 403 : 404, -32001, 'No such session for this credential.');
        return;
      }
      await session.transport.handleRequest(req, res);
    });
  }

  // Last-resort error handler: never leak a stack to the client, and keep the shape
  // JSON-RPC so an MCP client sees a well-formed error. The detail goes to the logs.
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      log.error('unhandled request error', { reason: err.message });
      if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
    },
  );

  return app;
}
