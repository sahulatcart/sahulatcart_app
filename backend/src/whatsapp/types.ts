import type { MessageType } from '@app/shared';

// Subset of the Meta WhatsApp Cloud API webhook payload we consume.
export interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}
export interface WebhookEntry {
  id?: string;
  changes?: WebhookChange[];
}
export interface WebhookChange {
  field?: string;
  value?: WebhookValue;
}
export interface WebhookValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { profile?: { name?: string }; wa_id?: string }[];
  messages?: RawMessage[];
  statuses?: RawStatus[];
}
export interface RawMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  image?: { caption?: string; id?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { text?: string };
  [k: string]: unknown;
}
export interface RawStatus {
  id: string;
  status: string; // sent | delivered | read | failed
  recipient_id?: string;
  timestamp?: string;
}

// Normalized (pure) view the processor works with.
export interface NormalizedMessage {
  waMessageId: string;
  from: string;
  type: MessageType;
  rawType: string;
  text: string | null;
  profileName: string | null;
  raw: RawMessage;
}
export interface NormalizedStatus {
  waMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}
export interface ParsedChange {
  phoneNumberId: string;
  messages: NormalizedMessage[];
  statuses: NormalizedStatus[];
}
