// Plan definitions (SRS P7, FR-P7.1). Limits live here; prices are backend config
// (PLAN_BASIC_PRICE_PAISA, PLAN_PRO_PRICE_PAISA) so the pilot can change them without a deploy.
// A "conversation" is a chat with at least one inbound message in the period month.
import type { Plan } from './enums';

export const PLANS: Record<Plan, { label: string; conversations: number; trialDays: number }> = {
  pilot: { label: 'Pilot', conversations: 300, trialDays: 30 },
  basic: { label: 'Basic', conversations: 1000, trialDays: 0 },
  pro: { label: 'Pro', conversations: 5000, trialDays: 0 },
};

export const SubscriptionStatus = ['trial', 'active', 'past_due', 'expired'] as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[number];

export const InvoiceStatus = ['due', 'paid', 'void'] as const;
export type InvoiceStatus = (typeof InvoiceStatus)[number];
