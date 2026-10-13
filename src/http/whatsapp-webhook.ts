import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CareStore } from '../store/store.js';
import { parseInboundMessages, interpretReply, normalisePhone } from '../domain/whatsapp.js';
import { applyRequestResponse } from '../domain/request-response.js';
import { SeenEvents } from './ring-webhook.js';

/**
 * The WhatsApp webhook - the inbound half of the delegation loop's reply channel.
 *
 * Meta calls this endpoint two ways:
 *  - **GET**, once, to verify the subscription: it echoes a challenge if the caller
 *    knows the verify token we configured. Nothing about the care record here.
 *  - **POST**, for every inbound message, signed `X-Hub-Signature-256` = HMAC-SHA256 of
 *    the raw body with the app secret. Same three refusals as the Ring webhook:
 *      - an unsigned or badly-signed body is rejected before it is parsed (anyone can
 *        POST to a public URL; a forged "yes" would assign a family's medical errand);
 *      - a redelivered message id is acknowledged but not acted on twice;
 *      - a reply is only ever matched to the *sender's own* outstanding request, so a
 *        message answering nothing does nothing.
 *
 * The phone the reply came from is mapped to a member by the same recipients map the
 * outbound notifier uses (`WHATSAPP_RECIPIENTS`). A message from a number we do not
 * know is acknowledged and ignored - we do not act on strangers.
 */

const SIGNATURE_HEADER = 'x-hub-signature-256';

function verifySignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean {
  if (!signature || !appSecret) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = signature
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface WhatsAppWebhookOptions {
  store: CareStore;
  /** The Meta app secret, for signature verification. Without it, POST goes dark. */
  appSecret: string;
  /** The token we chose, echoed back to Meta on GET verification. */
  verifyToken: string;
  /** phone (any format) -> member id. Inverse of the outbound recipients map. */
  memberByPhone: Map<string, string>;
  /** Which household these replies belong to. */
  householdId: string;
  seen?: SeenEvents;
  now?: () => Date;
}

/** GET handler: the one-time subscription verification. */
export function createWhatsAppVerify(opts: Pick<WhatsAppWebhookOptions, 'verifyToken'>) {
  return function verify(req: Request, res: Response): void {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (
      mode === 'subscribe' &&
      typeof token === 'string' &&
      token === opts.verifyToken &&
      opts.verifyToken
    ) {
      res.status(200).send(typeof challenge === 'string' ? challenge : '');
      return;
    }
    res.status(403).json({ error: 'Verification failed.' });
  };
}

/** POST handler: a signed batch of inbound messages. */
export function createWhatsAppWebhook(opts: WhatsAppWebhookOptions) {
  const seen = opts.seen ?? new SeenEvents();
  const now = opts.now ?? (() => new Date());
  // Normalise the phone keys once, so lookups tolerate '+', spaces and dashes.
  const byPhone = new Map<string, string>();
  for (const [phone, memberId] of opts.memberByPhone) byPhone.set(normalisePhone(phone), memberId);

  return async function handle(req: Request, res: Response): Promise<void> {
    const raw: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from((req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}));

    if (!opts.appSecret) {
      res.status(503).json({ error: 'WhatsApp integration is not configured.' });
      return;
    }
    if (!verifySignature(raw, req.header(SIGNATURE_HEADER) ?? undefined, opts.appSecret)) {
      res.status(401).json({ error: 'Bad signature.' });
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Body was not JSON.' });
      return;
    }

    const results: Array<Record<string, unknown>> = [];
    for (const msg of parseInboundMessages(payload)) {
      if (!seen.admit(msg.messageId)) {
        results.push({ messageId: msg.messageId, status: 'duplicate' });
        continue;
      }
      const memberId = byPhone.get(normalisePhone(msg.from));
      if (!memberId) {
        results.push({ messageId: msg.messageId, status: 'unknown-sender' });
        continue;
      }
      const intent = interpretReply(msg.text);
      if (!intent) {
        results.push({ messageId: msg.messageId, status: 'unparsed' });
        continue;
      }
      try {
        const r = await applyRequestResponse(
          opts.store,
          {
            householdId: opts.householdId,
            memberId,
            accepted: intent === 'accepted',
            note: msg.text,
            channel: 'whatsapp',
          },
          now(),
        );
        results.push({
          messageId: msg.messageId,
          status: r.ok ? intent : 'no-open-request',
          ...(r.obligationId ? { obligationId: r.obligationId } : {}),
        });
      } catch (err) {
        results.push({ messageId: msg.messageId, status: 'error', detail: (err as Error).message });
      }
    }

    // Always 200 once the signature is good, so Meta does not redeliver a message we
    // have already recorded a decision about.
    res.status(200).json({ status: 'accepted', results });
  };
}
