import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { lookupToken, markTokenInvalid } from './credentials';

/**
 * WhatsApp Cloud API sender. Every message goes out with the credentials of the number it is
 * sent from (whatsapp_numbers → whatsapp_secrets, see credentials.ts); callers never see a token.
 */
export interface SendResult {
  waMessageId: string | null;
  /** Meta's numeric error code, or a local reason when nothing was sent. */
  errorCode?: number | string;
}

const META_TOKEN_INVALID = 190;

async function send(phoneNumberId: string, to: string, payload: Record<string, unknown>, what: string): Promise<SendResult> {
  const cfg = loadConfig();
  const db = getServiceClient();
  const creds = await lookupToken(db, phoneNumberId);
  if (!creds.token) {
    logger.warn({ to, phoneNumberId, reason: creds.reason }, `no WhatsApp credentials for this number — skipping ${what}`);
    return { waMessageId: null, errorCode: creds.reason };
  }

  const url = `https://graph.facebook.com/${cfg.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let code: number | undefined;
    try {
      code = (JSON.parse(errText) as { error?: { code?: number } }).error?.code;
    } catch {
      /* not JSON */
    }
    logger.error({ status: res.status, code, err: errText.slice(0, 500), phoneNumberId }, `WhatsApp ${what} failed`);
    if (code === META_TOKEN_INVALID) await markTokenInvalid(db, phoneNumberId);
    return { waMessageId: null, errorCode: code ?? res.status };
  }
  const json = (await res.json()) as { messages?: { id?: string }[] };
  return { waMessageId: json.messages?.[0]?.id ?? null };
}

export function sendText(phoneNumberId: string, to: string, body: string): Promise<SendResult> {
  return send(phoneNumberId, to, { type: 'text', text: { body } }, 'send');
}

/** Send an image (e.g. a product photo) by public link, with an optional caption. */
export function sendImage(phoneNumberId: string, to: string, link: string, caption?: string): Promise<SendResult> {
  return send(phoneNumberId, to, { type: 'image', image: { link, ...(caption ? { caption } : {}) } }, 'image send');
}

/** Send a document (e.g. an order-slip PDF) by public/signed link. */
export function sendDocument(phoneNumberId: string, to: string, link: string, filename: string, caption?: string): Promise<SendResult> {
  return send(phoneNumberId, to, { type: 'document', document: { link, filename, ...(caption ? { caption } : {}) } }, 'document send');
}
