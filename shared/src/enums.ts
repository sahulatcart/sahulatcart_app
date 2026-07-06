// Canonical enums — mirror docs/spec/02-data-model.md exactly.
// Keep this file in lockstep with the DB enums (db/migrations/0001_core.sql).

export const MerchantStatus = ['pending', 'active', 'suspended'] as const;
export type MerchantStatus = (typeof MerchantStatus)[number];

export const Plan = ['pilot', 'basic', 'pro'] as const;
export type Plan = (typeof Plan)[number];

export const Lang = ['roman_urdu', 'english', 'urdu'] as const;
export type Lang = (typeof Lang)[number];

export const UserRole = ['owner', 'manager', 'staff'] as const;
export type UserRole = (typeof UserRole)[number];

export const ConversationStatus = ['bot_active', 'human_takeover', 'closed'] as const;
export type ConversationStatus = (typeof ConversationStatus)[number];

export const BotState = [
  'greeting',
  'browsing',
  'product_qa',
  'negotiating',
  'order_building',
  'collecting_delivery',
  'selecting_payment',
  'awaiting_payment_proof',
  'confirming',
  'completed',
  'handoff',
] as const;
export type BotState = (typeof BotState)[number];

export const OrderStatus = [
  'draft',
  'pending_confirmation',
  'confirmed',
  'awaiting_payment',
  'paid',
  'preparing',
  'dispatched',
  'delivered',
  'cancelled',
  'returned',
] as const;
export type OrderStatus = (typeof OrderStatus)[number];

export const PaymentMethod = ['unset', 'cod', 'bank_transfer'] as const;
export type PaymentMethod = (typeof PaymentMethod)[number];

export const PaymentStatus = [
  'unpaid',
  'claimed',
  'verified',
  'failed',
  'cod_pending',
  'cod_collected',
  'refunded',
] as const;
export type PaymentStatus = (typeof PaymentStatus)[number];

export const MessageType = [
  'text',
  'image',
  'interactive',
  'template',
  'document',
  'audio',
  'location',
  'video',
  'sticker',
  'reaction',
  'order',
] as const;
export type MessageType = (typeof MessageType)[number];

export const MessageDirection = ['inbound', 'outbound'] as const;
export type MessageDirection = (typeof MessageDirection)[number];

export const MessageSender = ['customer', 'bot', 'agent', 'system'] as const;
export type MessageSender = (typeof MessageSender)[number];

export const MessageStatus = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
export type MessageStatus = (typeof MessageStatus)[number];

export const NegotiationStatus = ['ongoing', 'agreed', 'rejected', 'abandoned'] as const;
export type NegotiationStatus = (typeof NegotiationStatus)[number];

export const NegotiationScope = ['line', 'cart'] as const;
export type NegotiationScope = (typeof NegotiationScope)[number];

export const DiscountSource = ['negotiated', 'manual', 'coupon', 'none'] as const;
export type DiscountSource = (typeof DiscountSource)[number];

export const WhatsappQuality = ['green', 'yellow', 'red', 'unknown'] as const;
export type WhatsappQuality = (typeof WhatsappQuality)[number];

export const WhatsappTier = ['unverified', 'tier_1', 'tier_2', 'tier_3', 'tier_4'] as const;
export type WhatsappTier = (typeof WhatsappTier)[number];

export const WaOptIn = ['unknown', 'in', 'out'] as const;
export type WaOptIn = (typeof WaOptIn)[number];

export const JobType = ['product_import', 'catalog_sync'] as const;
export type JobType = (typeof JobType)[number];

export const JobStatus = ['queued', 'processing', 'completed', 'failed'] as const;
export type JobStatus = (typeof JobStatus)[number];

export const NotificationType = [
  'new_order',
  'payment_claim',
  'takeover_request',
  'bot_needs_help',
  'low_stock',
  'template_status',
  'system',
] as const;
export type NotificationType = (typeof NotificationType)[number];

// Bot intent set — canonical per docs/spec/05-bot-flows.md §2.1
export const BotIntent = [
  'greet',
  'ask_product',
  'ask_price',
  'make_offer',
  'accept',
  'reject',
  'add_to_order',
  'provide_address',
  'choose_cod',
  'choose_bank',
  'claim_paid',
  'ask_status',
  'ask_product_info',
  'ask_shop_info',
  'ask_photo',
  'chitchat',
  'complaint',
  'human_request',
  'stop',
  'out_of_scope',
] as const;
export type BotIntent = (typeof BotIntent)[number];
