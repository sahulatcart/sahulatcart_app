import { loadConfig } from '../config';
import { logger } from '../lib/logger';

/**
 * WhatsApp Cloud API sender. Path C: uses the platform system-user token from env.
 * (Multi-tenant: dereference whatsapp_numbers.access_token_ref → whatsapp_secrets — Phase 6.)
 */
export interface SendResult {
  waMessageId: string | null;
}

export async function sendText(phoneNumberId: string, to: string, body: string): Promise<SendResult> {
  const cfg = loadConfig();
  const token = cfg.META_SYSTEM_USER_TOKEN;
  if (!token) {
    logger.warn({ to }, 'META_SYSTEM_USER_TOKEN not set — skipping WhatsApp send (dev/no-creds mode)');
    return { waMessageId: null };
  }

  const url = `https://graph.facebook.com/${cfg.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.error({ status: res.status, err: errText }, 'WhatsApp send failed');
    return { waMessageId: null };
  }
  const json = (await res.json()) as { messages?: { id?: string }[] };
  return { waMessageId: json.messages?.[0]?.id ?? null };
}
