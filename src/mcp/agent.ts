import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which AI agent a request came through, when it is one people know by name.
 *
 * Anyone's agent can connect: Claude, ChatGPT, Cursor, the MCP Inspector. The record keeps
 * who said a thing (the credential) and, beside it, the agent that carried it, so the trail
 * can read "Funmi, through ChatGPT, took it on". The agent never changes who is speaking or
 * what they may do. Like the channel, it is the client's own description of itself, so a
 * client that misnames itself mislabels only its own reports.
 *
 * Only names on the list below are kept. Our own clients (the simulator, the Telegram
 * bridge, the tests) and anything unrecognised carry no label rather than a made-up one.
 */

/** The `_meta` key a 2026-07-28 request names its client under. */
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';

const OURS = /^(carecircle|alexa-plus-simulator)/i;

/** First match wins, so the more specific names come first. */
const KNOWN: Array<[RegExp, string]> = [
  [/claude[-_ ]?code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/chatgpt|openai/i, 'ChatGPT'],
  [/cursor/i, 'Cursor'],
  [/inspector/i, 'MCP Inspector'],
  [/mcpjam/i, 'MCPJam'],
  [/copilot|visual studio code|vs ?code/i, 'VS Code'],
  [/kiro/i, 'Kiro'],
  [/amazon[-_ ]?q\b|q[-_ ]?developer/i, 'Amazon Q'],
  [/gemini/i, 'Gemini'],
  [/goose/i, 'Goose'],
  [/windsurf/i, 'Windsurf'],
  [/\bzed\b/i, 'Zed'],
  [/le[-_ ]?chat|mistral/i, 'Le Chat'],
  [/perplexity/i, 'Perplexity'],
  [/\bcline\b/i, 'Cline'],
  [/raycast/i, 'Raycast'],
  [/lm[-_ ]?studio/i, 'LM Studio'],
  [/postman/i, 'Postman'],
];

/** The agent a client's own `clientInfo` names, if it is one we know. */
export function agentOf(info: unknown): string | null {
  if (!info || typeof info !== 'object') return null;
  const { name, title } = info as { name?: unknown; title?: unknown };
  const said = [title, name].filter((v): v is string => typeof v === 'string').join(' ');
  if (!said || OURS.test(typeof name === 'string' ? name : '')) return null;
  return KNOWN.find(([pattern]) => pattern.test(said))?.[1] ?? null;
}

/** The agent an MCP request body names: on initialize, or in a stateless request's `_meta`. */
export function agentOfRequest(body: unknown): string | null {
  const msg = Array.isArray(body) ? body[0] : body;
  const params = (msg as { params?: Record<string, unknown> } | undefined)?.params;
  if (!params) return null;
  const meta = params['_meta'] as Record<string, unknown> | undefined;
  return agentOf(params['clientInfo'] ?? meta?.[CLIENT_INFO_META_KEY]);
}

const current = new AsyncLocalStorage<string>();

/** Run `fn` with the agent set, so what it records says which agent carried it. */
export function withAgent<T>(agent: string | null | undefined, fn: () => T): T {
  return agent ? current.run(agent, fn) : fn();
}

/** The agent of the request being served, if it named one we know. */
export function currentAgent(): string | undefined {
  return current.getStore();
}
