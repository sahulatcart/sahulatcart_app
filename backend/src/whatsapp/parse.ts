import type { MessageType } from '@app/shared';
import type {
  NormalizedMessage,
  NormalizedStatus,
  ParsedChange,
  RawMessage,
  WebhookPayload,
} from './types';

const KNOWN_TYPES: MessageType[] = [
  'text',
  'image',
  'interactive',
  'document',
  'audio',
  'location',
  'video',
  'sticker',
  'reaction',
  'order',
];

/** Map a Meta message type to our message_type enum, preserving the raw type. */
export function normalizeType(rawType: string): MessageType {
  if (rawType === 'button') return 'interactive';
  if ((KNOWN_TYPES as string[]).includes(rawType)) return rawType as MessageType;
  return 'text'; // contacts/unknown/etc. fall back; rawType is preserved separately
}

/** Best-effort text extraction from an inbound message. */
export function extractText(msg: RawMessage): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? null;
    case 'interactive':
      return msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? null;
    case 'button':
      return msg.button?.text ?? null;
    case 'image':
      return msg.image?.caption ?? null;
    default:
      return null;
  }
}

/** Pure: turn a raw webhook payload into normalized per-change messages/statuses. */
export function parseWebhook(payload: WebhookPayload): ParsedChange[] {
  const out: ParsedChange[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const profileName = value?.contacts?.[0]?.profile?.name ?? null;

      const messages: NormalizedMessage[] = (value?.messages ?? []).map((m) => ({
        waMessageId: m.id,
        from: m.from,
        type: normalizeType(m.type),
        rawType: m.type,
        text: extractText(m),
        profileName,
        raw: m,
      }));

      const statuses: NormalizedStatus[] = (value?.statuses ?? [])
        .filter((s) => ['sent', 'delivered', 'read', 'failed'].includes(s.status))
        .map((s) => ({ waMessageId: s.id, status: s.status as NormalizedStatus['status'] }));

      out.push({ phoneNumberId, messages, statuses });
    }
  }
  return out;
}
