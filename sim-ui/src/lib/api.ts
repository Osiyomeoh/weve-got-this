// Thin client over the sim server's real endpoints (src/sim/app.ts).

export type Provenance = 'CONFIRMED' | 'INFERRED' | 'NOT_LOGGED';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

/** The score's derivation: score = round(cost * pDrop * confidence * 100). */
export interface GapFactors {
  cost: number;
  pDrop: number;
  confidence: number;
}
export interface Gap {
  spoken: string;
  because: string;
  kind: string;
  severity: Severity;
  obligationId?: string;
  score?: number;
  factors?: GapFactors;
}
export interface Obligation {
  id: string;
  what: string;
  status: 'PROPOSED' | 'ASSIGNED' | 'RESOLVED' | 'DISMISSED';
  owner?: string;
  provenance: Provenance;
}
export interface Offer {
  offerId: string;
  item: string;
  merchant: string;
  etaText: string;
  amountCents: number;
}
export interface Notification { from: string; to: string; message: string; at?: string }

export interface BoardMember { id: string; name: string; role: string; spokenAs: string | null; livesAway?: string }
/** One of today's scheduled doses, and the record that answers it (see src/mcp/resources.ts). */
export interface DoseSlot {
  medicationId: string;
  name: string;
  forMemberId: string;
  time: string;
  recorded: { at: string; saidBy: string | null; via?: string } | null;
}

export interface BoardState {
  household?: { id: string; name: string; timezone: string };
  members?: BoardMember[];
  schedule?: DoseSlot[];
  gaps?: Gap[];
  obligations?: Obligation[];
  offers?: Offer[];
  notifications?: Notification[];
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  /** Structured payload the tool returned alongside the spoken line. */
  structured?: unknown;
  isError: boolean;
  ms: number;
}
/** A word the server mapped back onto a name this household actually uses. */
export interface Correction { from: string; to: string }

/** One reply from the model, and the tool calls it asked for (none on the reply that answers). */
export interface TraceStep { plannerMs: number; calls: ToolCall[] }

/** Everything one turn did, in order, and where the time went (see src/sim/host.ts). */
export interface TurnTrace {
  channel: 'voice' | 'chat';
  model: string;
  outcome: 'answered' | 'step_limit';
  steps: TraceStep[];
  plannerMs: number;
  toolMs: number;
  totalMs: number;
}

export interface Turn {
  spoken: string;
  toolCalls: ToolCall[];
  trace: TurnTrace;
  /** The transcript after correction, present only when something was changed. */
  heard?: string;
  corrections?: Correction[];
}

export interface SimConfig {
  provider: string; region: string; modelId: string; endpoint: string;
  /** 'private': this browser has its own copy of the demo. 'shared': the live demo household. */
  demo?: 'shared' | 'private';
}

export interface Transcription {
  text: string;
  corrections?: Correction[];
  /** 'applied' once Amazon has built the household vocabulary, 'building' until then. */
  vocabulary: 'applied' | 'building';
}

async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
  return data;
}

/** Matches the server's RATES. `slow` is an accessibility control, not a demo toggle. */
/** Who the family is caring for in a visitor's copy (mirrors src/demo/cases.ts). */
export type CareCaseId = 'eyes' | 'memory' | 'wheelchair' | 'hometown';

export type SpeechRate = 'slow' | 'gentle' | 'normal';

export const api = {
  /** `storyTime`: what time it is in the world's story (honoured only in this visitor's own copy). */
  state: (storyTime?: Date): Promise<BoardState> =>
    fetch(storyTime ? `/api/state?storyTime=${encodeURIComponent(storyTime.toISOString())}` : '/api/state').then((r) => r.json()),
  config: (): Promise<SimConfig> => fetch('/api/config').then((r) => r.json()),
  say: (memberId: string, text: string, storyTime?: Date): Promise<Turn> =>
    fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId, text, storyTime: storyTime?.toISOString() }),
    }).then(jsonOrThrow),
  transcribe: (pcm: Blob): Promise<Transcription> =>
    fetch('/api/transcribe', {
      method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: pcm,
    }).then(jsonOrThrow),
  /** Polly audio for a line, or null when the service is unavailable. */
  speak: async (text: string, rate: SpeechRate, voice?: string): Promise<Blob | null> => {
    try {
      const res = await fetch('/api/speak', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, rate, voice }),
      });
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  },
  /** `via: 'tv'`: a press on the Fire TV remote, so the record says it was pressed, not spoken. */
  act: (memberId: string, tool: string, args: Record<string, unknown>, storyTime?: Date, via?: 'tv'): Promise<ToolCall> =>
    fetch('/api/act', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberId, tool, args, storyTime: storyTime?.toISOString(), ...(via ? { via } : {}) }),
    }).then(jsonOrThrow),
  /** Throw away this browser's copy of the demo; the next request gets a fresh one. */
  resetSandbox: (opts: { liveMorning?: boolean; careCase?: CareCaseId } = {}): Promise<{ ok: boolean }> =>
    fetch('/api/sandbox/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts),
    }).then(jsonOrThrow),
  /** Reset the onboarding demo so setup starts from a blank new circle. */
  resetSetup: (): Promise<{ ok: boolean }> =>
    fetch('/api/setup/reset', { method: 'POST' }).then(jsonOrThrow),
  /** Refresh the founder's session after the circle is created (see src/sim/app.ts). */
  rebindSetup: (): Promise<{ ok: boolean }> =>
    fetch('/api/setup/rebind', { method: 'POST' }).then(jsonOrThrow),
};

/** The founder pseudo-member the onboarding screen acts as (see src/sim/app.ts). */
export const FOUNDER_ID = '__founder__';

export type OnboardingStep = 'create_circle' | 'add_recipient' | 'add_care_detail' | 'ready';

export interface OnboardingProgress {
  step: OnboardingStep;
  done: OnboardingStep[];
  complete: boolean;
  spoken: string;
  firstGap?: { what: string; because: string };
}

/** Read where setup is, straight from the server's get_started tool. */
export async function getStarted(memberId: string = FOUNDER_ID): Promise<OnboardingProgress> {
  const call = await api.act(memberId, 'get_started', {});
  const s = call.structured as OnboardingProgress | undefined;
  // Fall back to a minimal shape if structured content is absent.
  return s ?? { step: 'create_circle', done: [], complete: false, spoken: call.result };
}

export interface Member { id: string; label: string; sub: string; }
export const MEMBERS: Member[] = [
  { id: 'm_margaret', label: 'Daddy', sub: 'Echo at home · voice-first' },
  { id: 'm_david', label: 'Tolu', sub: 'primary caregiver · phone' },
  { id: 'm_renee', label: 'Funmi', sub: 'caregiver · sister' },
  { id: 'm_aide', label: 'Musa', sub: 'driver · paid help' },
  { id: 'm_kunle', label: 'Kunle', sub: 'brother · London' },
];
