import { randomUUID } from 'node:crypto';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SimulatedAlexa } from './host.js';
import { providerFromEnv } from './providers.js';
import { diagnoseBedrock, describe as describeDiagnosis } from './preflight.js';
import { DEMO_TOKENS } from '../demo/seed.js';
import { buildVocabulary, correctTranscript } from './transcript.js';
import { ensureVocabulary, hasEnoughAudio, transcribePcm, unhyphenate, SAMPLE_RATE } from './transcribe.js';
import { isRate, synthesize } from './speech.js';
import {
  VisitorSandboxes, parseCookies, isVisitorId, newVisitorId, toSandbox, fromSandbox,
  VISITOR_COOKIE, LIVE_COOKIE, type SandboxGrant,
} from './sandbox.js';

/**
 * Simulated Alexa+ experience.
 *
 * Serves the device mock and brokers turns between the browser, a Bedrock model,
 * and the CareCircle MCP server. One host per member, so each device in the demo
 * (Daddy's Echo at home, Tolu's phone) keeps its own conversation.
 */

const PORT = Number(process.env['SIM_PORT'] ?? 5173);
const MCP_ENDPOINT = process.env['CARECIRCLE_URL'] ?? 'http://localhost:8787/mcp';
const REGION = process.env['AWS_REGION'] ?? 'us-east-1';
const provider = providerFromEnv();
const MODEL_ID = provider.modelId;

const here = dirname(fileURLToPath(import.meta.url));

/** member id -> its connected host. Created lazily on first utterance. */
const hosts = new Map<string, SimulatedAlexa>();
const tokenFor = new Map(Object.entries(DEMO_TOKENS).map(([token, member]) => [member, token]));

// The onboarding screen drives setup as a brand-new family. It authenticates with
// a token that maps to no member, so - where the server permits self-signup - it
// arrives as a bootstrap principal whose only move is create_household, then
// becomes that circle's primary caregiver. `__founder__` is a pseudo-member id the
// sim uses to reach that host; it is not a real member and holds no seeded data.
const FOUNDER_ID = '__founder__';
// A fresh token per onboarding run, so each begins as an unmapped bootstrap
// principal. Once a token creates a circle it maps to that member for good and can
// never bootstrap again - so "set up another" mints a new one.
function newFounderToken(): string { return `founder-${randomUUID()}`; }
tokenFor.set(FOUNDER_ID, newFounderToken());

/**
 * Whose copy of the demo a request acts on. `live` is the shared demo household (and
 * onboarding); a sandbox context is one visitor's private copy (see ./sandbox.ts).
 */
interface Ctx { key: string; suffix: string; token: (memberId: string) => string | undefined }
const LIVE: Ctx = { key: 'live', suffix: '', token: (m) => tokenFor.get(m) };

// Per-visitor sandboxes are on when the console shares a key with the MCP server.
const SANDBOX_KEY = process.env['CARECIRCLE_SANDBOX_KEY']?.trim() ?? '';
// The recording operator opts a browser into the shared demo with /live?key=...,
// because the Telegram scene must act on the real demo household.
const LIVE_KEY = process.env['SIM_LIVE_KEY']?.trim() ?? '';
const sandboxes = new VisitorSandboxes({
  create: async (): Promise<SandboxGrant> => {
    const res = await fetch(new URL('/sandbox', MCP_ENDPOINT), {
      method: 'POST', headers: { 'x-sandbox-key': SANDBOX_KEY },
    });
    if (!res.ok) throw new Error(`Could not create a demo copy (${res.status})`);
    const body = await res.json() as { suffix: string; tokens: Record<string, string>; expiresAt: string };
    return { suffix: body.suffix, tokens: body.tokens, expiresAt: Date.parse(body.expiresAt) };
  },
});

async function contextFor(req: express.Request): Promise<Ctx> {
  if (!SANDBOX_KEY) return LIVE;
  const cookies = parseCookies(req.header('cookie'));
  if (LIVE_KEY && cookies[LIVE_COOKIE] === '1') return LIVE;
  // No visitor cookie: the Fire TV app, scripts, curl. They read the shared demo.
  const visitor = cookies[VISITOR_COOKIE];
  if (!isVisitorId(visitor)) return LIVE;
  const grant = await sandboxes.get(visitor);
  return { key: `${visitor}${grant.suffix}`, suffix: grant.suffix, token: (m) => grant.tokens[m] };
}

const MAX_HOSTS = 2_000;

const hostKeyOf = (ctx: Ctx, memberId: string): string => `${ctx.key}|${memberId}`;
/** The founder's session. Onboarding always runs in the live context, never a sandbox. */
const FOUNDER_HOST = hostKeyOf(LIVE, FOUNDER_ID);

async function hostFor(ctx: Ctx, memberId: string): Promise<SimulatedAlexa> {
  // Onboarding is not part of the demo story; it always runs as the founder.
  if (memberId === FOUNDER_ID) ctx = LIVE;
  const hostKey = hostKeyOf(ctx, memberId);
  const existing = hosts.get(hostKey);
  if (existing) return existing;
  const token = ctx.token(memberId);
  if (!token) throw new Error(`No credential for ${memberId}`);
  const host = await SimulatedAlexa.connect({
    endpoint: MCP_ENDPOINT, token, provider,
  });
  hosts.set(hostKey, host);
  // Bounded: an idle visitor's hosts are dropped oldest first and reconnect on use.
  while (hosts.size > MAX_HOSTS) {
    const oldest = hosts.keys().next().value;
    if (oldest === undefined) break;
    hosts.delete(oldest);
  }
  return host;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Model backends throttle and overload transiently; a demo turn should ride that
 *  out rather than surface it. Retries 429/503/overload with backoff; other
 *  failures (bad credentials, a real bug) are returned at once. */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const m = (err as Error).message ?? '';
      const transient = /\b(429|503)\b|overload|high demand|rate.?limit|too many|throttl|RESOURCE_EXHAUSTED|exceeded your current quota/i.test(m);
      if (!transient || attempt === tries - 1) throw err;
      await sleep(Math.min(8_000, 1_200 * 2 ** attempt));
    }
  }
  throw last;
}

const app = express();
app.use(express.json());

// Give each browser that opens a console page its own visitor id, and so its own
// copy of the demo. Only page loads set it; API callers without it (the Fire TV app)
// keep the shared demo.
app.use((req, res, next) => {
  if (SANDBOX_KEY && req.method === 'GET' && !req.path.startsWith('/api/')
    && !isVisitorId(parseCookies(req.header('cookie'))[VISITOR_COOKIE])) {
    const secure = req.header('x-forwarded-proto') === 'https' ? '; Secure' : '';
    res.append('Set-Cookie',
      `${VISITOR_COOKIE}=${newVisitorId()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
  }
  next();
});

// Recording mode: this browser acts on the shared demo household instead of a copy.
app.get('/live', (req, res) => {
  if (!LIVE_KEY || req.query['key'] !== LIVE_KEY) { res.status(404).send('Not found'); return; }
  const secure = req.header('x-forwarded-proto') === 'https' ? '; Secure' : '';
  res.append('Set-Cookie', `${LIVE_COOKIE}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`);
  res.redirect(302, '/console');
});
app.get('/live/off', (_req, res) => {
  res.append('Set-Cookie', `${LIVE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect(302, '/console');
});
// The read-only board endpoints are also consumed by the React Native TV app's
// web build (a different origin), so allow cross-origin GETs. No credentials, no
// cookies - this is public demo state.
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  next();
});
// The built React UI (Vite) is the primary front-end; public/ still holds legacy
// static pages (e.g. tv.html the Fire TV APK points at) and is served as a fallback.
const uiDir = join(here, '../../sim-ui/dist');
app.use(express.static(uiDir));
app.use(express.static(join(here, '../../public')));

/** One spoken turn from one member's device. */
/** Read the whole care picture from the MCP server, as a fresh short session. */
async function readCareState(ctx: Ctx = LIVE): Promise<Record<string, unknown>> {
  const token = ctx.token('m_david');
  const response = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'carecircle-board', version: '0.1.0' },
      },
    }),
  });
  const sessionId = response.headers.get('mcp-session-id');
  await response.text();
  if (!sessionId) throw new Error('No session id returned by the MCP server');

  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-session-id': sessionId,
  };
  await fetch(MCP_ENDPOINT, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  const read = await fetch(MCP_ENDPOINT, {
    method: 'POST', headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'resources/read',
      params: { uri: 'carecircle://household/state' },
    }),
  });
  const body = await read.json() as { result?: { contents?: { text?: string }[] } };
  void fetch(MCP_ENDPOINT, { method: 'DELETE', headers }).catch(() => undefined);
  return fromSandbox(JSON.parse(body.result?.contents?.[0]?.text ?? '{}'), ctx.suffix);
}

/**
 * The household's own names, for repairing a transcript.
 *
 * Cached briefly because it is read on every utterance and changes only when
 * somebody joins the circle or a medication is added. A failure here must never
 * cost us the turn - an uncorrected transcript is still a usable one.
 */
let vocabularyCache: { terms: string[]; at: number } = { terms: [], at: 0 };
const VOCABULARY_TTL_MS = 30_000;

async function vocabulary(): Promise<string[]> {
  if (Date.now() - vocabularyCache.at < VOCABULARY_TTL_MS) return vocabularyCache.terms;
  try {
    const terms = buildVocabulary(await readCareState());
    vocabularyCache = { terms, at: Date.now() };
  } catch {
    vocabularyCache = { ...vocabularyCache, at: Date.now() };
  }
  return vocabularyCache.terms;
}

app.post('/api/say', async (req, res) => {
  const { memberId, text } = req.body as { memberId?: string; text?: string };
  if (!memberId || !text) {
    res.status(400).json({ error: 'memberId and text are required' });
    return;
  }
  try {
    // General speech recognition does not know who lives here, so the words it
    // gets wrong are the ones that matter most: a name, or a medication. Map the
    // transcript back onto the household's own vocabulary before the planner
    // sees it, and report what changed rather than rewriting anyone silently.
    const { text: heard, corrections } = correctTranscript(text, await vocabulary());
    const ctx = await contextFor(req);
    const host = await hostFor(ctx, memberId);
    const turn = fromSandbox(await withRetry(() => host.say(heard)), ctx.suffix);
    res.json({ ...turn, ...(corrections.length ? { heard, corrections } : {}) });
  } catch (err) {
    const message = (err as Error).message;

    // Throttling is the ambiguous one: it means either "you used your budget" or
    // "you never had one", and Bedrock reports both identically. Ask Service
    // Quotas which, rather than telling the user to wait for a refill that will
    // never come.
    // Only Bedrock has the zero-quota failure mode this diagnoses.
    if (provider.name === 'bedrock' && /throttl|too many tokens/i.test(message)) {
      const diagnosis = await diagnoseBedrock({ region: REGION, modelId: MODEL_ID });
      res.status(502).json({
        error: diagnosis.state === 'ok' || diagnosis.state === 'unknown'
          ? `Bedrock is rate limiting: ${message}`
          : describeDiagnosis(diagnosis),
        diagnosis: diagnosis.state,
      });
      return;
    }

    // Credential problems are the most likely failure on a fresh clone, so say so
    // plainly rather than surfacing an opaque SDK error in the UI.
    const isAuth = /credential|security token|AccessDenied|not authorized|region/i.test(message);
    res.status(502).json({
      error: isAuth
        ? `Bedrock could not be reached: ${message}. Check AWS credentials, the region (${REGION}), and that model access is enabled for ${MODEL_ID}.`
        : message,
    });
  }
});

/**
 * A card button tap.
 *
 * This is the feature request in working form: the card carries a bound tool call,
 * and tapping it invokes that tool directly with no model in the loop. Voice is the
 * right input for capture; a tap is the right input for choosing among similar
 * items, where a misheard referring expression would assign a hospital trip to the
 * wrong person.
 */
// Start onboarding over with a brand-new family: a fresh bootstrap token, and no
// cached session, so the next call begins at "create your circle".
app.post('/api/setup/reset', async (_req, res) => {
  hosts.delete(FOUNDER_HOST);
  tokenFor.set(FOUNDER_ID, newFounderToken());
  res.json({ ok: true });
});

// After the circle is created the founder's token maps to a real member, but the
// open session is still bound to the bootstrap principal - and the server refuses
// a mid-session identity change (its credential-swap guard). So drop the session,
// keeping the now-mapped token, and the next call reconnects as that member.
app.post('/api/setup/rebind', async (_req, res) => {
  hosts.delete(FOUNDER_HOST);
  res.json({ ok: true });
});

app.post('/api/act', async (req, res) => {
  const { memberId, tool, args } = req.body as {
    memberId?: string; tool?: string; args?: Record<string, unknown>;
  };
  if (!memberId || !tool) {
    res.status(400).json({ error: 'memberId and tool are required' });
    return;
  }
  try {
    const ctx = await contextFor(req);
    const host = await hostFor(ctx, memberId);
    const out = await withRetry(() => host.callToolDirect(tool, toSandbox(args ?? {}, ctx.suffix)));
    res.json(fromSandbox(out, ctx.suffix));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * The live care board. Read through the MCP server's own resource, so the panel
 * shows exactly what the protocol exposes - not a privileged side channel.
 */
/**
 * Speech to text, for clients that would rather not use the browser's recogniser.
 *
 * Takes raw 16-bit little-endian PCM at 16 kHz mono - no container, no
 * transcoding - and hands it to Amazon Transcribe along with this household's
 * names as a custom vocabulary. The post-hoc corrector still runs on the result,
 * because the vocabulary takes a minute to build after any change to the circle
 * and we would rather be right in the meantime.
 *
 * Failure here is never fatal: the browser keeps its own recogniser, and the UI
 * falls back to it.
 */
app.post('/api/transcribe', express.raw({ type: '*/*', limit: '12mb' }), async (req, res) => {
  const pcm = req.body as Buffer;
  if (!Buffer.isBuffer(pcm) || !hasEnoughAudio(pcm)) {
    res.status(400).json({ error: 'Send at least a quarter second of 16-bit PCM at 16 kHz.' });
    return;
  }
  try {
    const terms = await vocabulary();
    const vocabularyName = await ensureVocabulary(terms).catch(() => undefined);
    const raw = await transcribePcm(pcm, vocabularyName);
    const { text, corrections } = correctTranscript(unhyphenate(raw, terms), terms);
    res.json({
      text,
      ...(corrections.length ? { corrections } : {}),
      vocabulary: vocabularyName ? 'applied' : 'building',
      sampleRate: SAMPLE_RATE,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

/**
 * Speak a line with Polly.
 *
 * Returns audio, or a 502 the browser treats as "use your own voice instead" -
 * losing the nicer voice is a downgrade, never a silence.
 */
app.post('/api/speak', async (req, res) => {
  const { text, rate } = (req.body ?? {}) as { text?: string; rate?: string };
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Nothing to say.' });
    return;
  }
  try {
    const spoken = await synthesize(text, isRate(rate) ? rate : 'normal');
    res.setHeader('content-type', spoken.contentType);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-carecircle-voice', `${spoken.voice}/${spoken.engine}`);
    res.send(spoken.audio);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// "Start over": this visitor gets a brand-new copy of the demo on their next request.
app.post('/api/sandbox/reset', (req, res) => {
  const visitor = parseCookies(req.header('cookie'))[VISITOR_COOKIE];
  if (isVisitorId(visitor)) {
    const old = sandboxes.forget(visitor);
    if (old) for (const k of [...hosts.keys()]) if (k.startsWith(`${visitor}${old.suffix}|`)) hosts.delete(k);
  }
  res.json({ ok: true });
});

app.get('/api/state', async (req, res) => {
  try {
    res.json(await readCareState(await contextFor(req)));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get('/api/config', async (req, res) => {
  const ctx = await contextFor(req).catch(() => LIVE);
  res.json({
    provider: provider.name, region: REGION, modelId: MODEL_ID, endpoint: MCP_ENDPOINT,
    // What the UI tells the visitor: their own copy, or the shared live demo.
    demo: ctx === LIVE ? 'shared' : 'private',
  });
});

// SPA fallback: any non-API GET that isn't a static file serves the React app,
// so client-side routes (/console, /tv) work on direct load and refresh.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(join(uiDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Alexa+ simulator on http://localhost:${PORT}`);
  console.log(`  talking to MCP server at ${MCP_ENDPOINT}`);
  console.log(`  planner: ${provider.name} · ${MODEL_ID}`);
});
