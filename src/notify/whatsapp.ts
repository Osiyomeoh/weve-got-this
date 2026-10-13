import type { Notifier, DeliveryResult } from './notifier.js';

/**
 * Delivering a message to a member over the WhatsApp Business Cloud API.
 *
 * The outbound half of the WhatsApp door: when CareCircle asks someone to take a job
 * on, this is what makes their phone actually buzz. It sits behind the same `Notifier`
 * seam as SNS and record-only, so the request flow is identical whether or not WhatsApp
 * is configured - and, like the others, a send failure is reported, never thrown: the
 * ask is already safely in the care record.
 *
 * Members are mapped to phone numbers by an explicit env map (`WHATSAPP_RECIPIENTS`),
 * not a field on the person - a phone number is contact data we take in deliberately for
 * exactly the people who agreed to be reached, and a member with no mapping simply is
 * not messaged (`delivered: false`), never guessed at.
 *
 * Meta only permits sending from a Business number, and a personal WhatsApp account
 * cannot be driven by the API - so the *sender* is always the business line, which the
 * demo states on screen. That is the only honest way this connects.
 */

const GRAPH_VERSION = 'v21.0';

export interface WhatsAppConfig {
  /** A permanent or temporary access token for the WhatsApp Business app. */
  token: string;
  /** The Business phone-number id that sends (not a phone number - Meta's numeric id). */
  phoneNumberId: string;
  /** member id -> recipient phone in E.164 (e.g. "+2348012345678"). */
  recipients: Map<string, string>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function whatsAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig | null {
  const token = env['WHATSAPP_TOKEN']?.trim();
  const phoneNumberId = env['WHATSAPP_PHONE_NUMBER_ID']?.trim();
  const rawMap = env['WHATSAPP_RECIPIENTS']?.trim();
  if (!token || !phoneNumberId || !rawMap) return null;
  let recipients: Map<string, string>;
  try {
    recipients = new Map(Object.entries(JSON.parse(rawMap) as Record<string, string>));
  } catch {
    return null; // a malformed map is a misconfiguration, not a reason to send blind
  }
  return { token, phoneNumberId, recipients };
}

export class WhatsAppNotifier implements Notifier {
  readonly channel = 'whatsapp' as const;
  readonly #cfg: WhatsAppConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: WhatsAppConfig) {
    this.#cfg = cfg;
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async deliver(input: {
    to: string;
    toName: string;
    from: string;
    message: string;
  }): Promise<DeliveryResult> {
    const phone = this.#cfg.recipients.get(input.to);
    if (!phone) {
      // Honest: we did not message someone we have no agreed number for.
      return {
        delivered: false,
        channel: 'whatsapp',
        detail: 'no WhatsApp number for this member',
      };
    }
    try {
      const res = await this.#fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${this.#cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.#cfg.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { preview_url: false, body: input.message },
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          delivered: false,
          channel: 'whatsapp',
          detail: `send failed (${res.status}): ${text.slice(0, 200)}`,
        };
      }
      const json = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> };
      const id = json.messages?.[0]?.id;
      return { delivered: true, channel: 'whatsapp', ...(id ? { detail: id } : {}) };
    } catch (err) {
      return {
        delivered: false,
        channel: 'whatsapp',
        detail: `send failed: ${(err as Error).message}`,
      };
    }
  }
}
