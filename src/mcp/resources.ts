/**
 * Resources: the care record, readable as a document.
 */

import { attributionOf } from '../domain/attribution.js';
import { capabilitiesOf } from '../domain/auth.js';
import { detectCareGaps } from '../domain/gaps.js';
import { isLocalToday } from '../domain/local-time.js';
import { CARE_BOARD_HTML } from './app/care-board.js';
import { APP_MIME_TYPE } from './app/protocol.js';
import { CARE_BOARD_URI, type ToolContext } from './toolkit.js';

/**
 * Who is speaking.
 *
 * Identity is bound to the session credential and checked on every call, and
 * until now it was never *told* to anybody. So the model had to guess who it was
 * talking to, and we watched it do the only honest thing left: David said "I
 * can't do Thursday" and it replied "Are you David?" - asking the one question
 * the server could already answer, and inviting an answer from the conversation,
 * which is exactly the channel identity must never come from.
 *
 * Any authenticated member may read this. It says who the credential speaks for
 * and what that person may do - nothing about anybody else - so it discloses
 * strictly less than the caller already holds.
 */
export function registerMeResource({ server, actor, state }: ToolContext): void {
  server.registerResource('me', 'carecircle://session/me', {
    title: 'Who this session speaks for',
    description:
      'The member this credential identifies, and what they are allowed to do. A host '
      + 'should read this once and never ask the person who they are.',
    mimeType: 'application/json',
  }, async (uri) => {
    const me = actor();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          memberId: me.id,
          name: me.name,
          spokenAs: me.spokenAs ?? null,
          role: me.role,
          can: capabilitiesOf(me),
          // Who else is in the circle, by name and part only, so a host knows who "Dad"
          // and "Sandra" are without asking. No contact details.
          circle: state().members.map((m) => ({
            name: m.name, spokenAs: m.spokenAs ?? null, role: m.role,
            ...(m.livesAway ? { livesAway: m.livesAway } : {}),
          })),
        }, null, 2),
      }],
    };
  });
}

/**
 * The care record, readable as a document.
 */
export function registerCareStateResource({ server, now, state, nameOf }: ToolContext): void {
  server.registerResource('care-state', 'carecircle://household/state', {
    title: 'Current care state',
    description: 'The full care picture: members, open work, and recent events.',
    mimeType: 'application/json',
  }, async (uri) => {
    const s = state();
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify({
          household: s.household,
          members: s.members.map((m) => ({
            id: m.id, name: m.name, role: m.role, spokenAs: m.spokenAs ?? null,
          })),
          // The names this household actually uses. A voice client needs these to
          // map a transcript back onto real people and real medications - general
          // speech recognition knows nothing about "Renee" or a "thyroid tablet",
          // and those are precisely the words it gets wrong.
          medications: s.medications.map((m) => ({
            id: m.id, name: m.name, times: m.times, forMemberId: m.forMemberId,
          })),
          obligations: s.obligations.map((o) => ({
            id: o.id, what: o.what, status: o.status,
            owner: nameOf(o.ownerId) ?? null, dueAt: o.dueAt ?? null,
            provenance: o.provenance.kind,
          })),
          // Doses recorded today, each carrying who says so. A surface that draws
          // this must not flatten a proxy record into the subject's own word.
          doses: s.events
            .filter((e) => e.kind === 'medication_taken'
              && isLocalToday(e.occurredAt, now(), s.household.timezone))
            .map((e) => ({
              medicationId: e.data['medicationId'] ?? null,
              name: s.medications.find((m) => m.id === e.data['medicationId'])?.name ?? null,
              at: e.occurredAt,
              attribution: attributionOf(e),
              saidBy: nameOf(e.reportedBy) ?? null,
            })),
          gaps: detectCareGaps(s, { now: now() }),
          // Purchase offers still awaiting a decision - the in-place buy moment.
          offers: (() => {
            const settled = new Set(s.events
              .filter((e) => e.kind === 'purchase_completed')
              .map((e) => e.data['offerId'] as string));
            return s.events
              .filter((e) => e.kind === 'purchase_offered')
              .map((e) => e.data['offer'] as unknown)
              .filter((o): o is { offerId: string } => !!o && !settled.has((o as { offerId: string }).offerId));
          })(),
          notifications: s.events
            .filter((e) => e.kind === 'member_notified')
            .slice(-5)
            .map((e) => ({
              from: nameOf(e.reportedBy) ?? 'Someone',
              to: nameOf(e.data['recipientId'] as string) ?? 'someone',
              message: e.detail ?? '',
              at: e.occurredAt,
            })),
        }, null, 2),
      }],
    };
  });
}

/**
 * The Care Board: the same answer, drawn instead of spoken.
 *
 * Declared as an MCP App (SEP-1865). A host that cannot render it ignores
 * this resource entirely and the spoken path is untouched, which is the whole
 * point of the extension being optional.
 */
export function registerCareBoardResource({ server }: ToolContext): void {
  server.registerResource('care-board', CARE_BOARD_URI, {
    title: 'Care board',
    description:
      'The open care gaps as an interactive board: ranked, with the provenance of each '
      + 'one and the arithmetic behind its ranking, and claimable in a tap.',
    mimeType: APP_MIME_TYPE,
    _meta: {
      ui: {
        // The document is entirely self-contained, so it asks for no origins at
        // all - there is nothing for a host to allowlist and nothing that can be
        // injected into a view showing a family's medical coordination.
        csp: { resourceDomains: [], connectDomains: [] },
        prefersBorder: false,
      },
    },
  }, async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: APP_MIME_TYPE,
      text: CARE_BOARD_HTML,
    }],
  }));
}
