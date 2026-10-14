// Is this shop's bot actually selling right now, and if not, why? (Platform console, 2026-10-14.)
// botMode() answers the billing half (suspended, switched off, invoice overdue, allowance used) for
// the orchestrator; it never looks at WhatsApp, because a number that cannot send fails on its own.
// The founders need the whole truth in one place, so this combines the two. Pure: no I/O.
import { botMode, type Subscription } from './billing';

export type SellingCode =
  | 'selling' // everything works
  | 'quality' // sends, but Meta flagged message quality: still selling, worth watching
  | 'suspended'
  | 'bot_off'
  | 'no_whatsapp'
  | 'connecting'
  | 'token'
  | 'policy'
  | 'registration'
  | 'disconnected'
  | 'past_due'
  | 'limit';

export interface Selling {
  selling: boolean;
  code: SellingCode;
  /** One plain sentence for the founders; null when there is nothing to say. */
  reason: string | null;
}

export interface SellingInput {
  merchant: { status?: string | null; settings?: { botEnabled?: boolean } | null };
  subscription: Pick<Subscription, 'plan' | 'status'> | null;
  conversationsThisMonth: number;
  connection: { status: string; flagReason?: string | null };
}

export function sellingStatus(i: SellingInput): Selling {
  const mode = botMode(i.merchant, i.subscription, i.conversationsThisMonth);
  if (mode.reason === 'suspended') return { selling: false, code: 'suspended', reason: 'Suspended from this console' };
  if (mode.reason === 'bot_off') return { selling: false, code: 'bot_off', reason: 'The owner switched the bot off' };

  const c = i.connection;
  if (c.status === 'none') return { selling: false, code: 'no_whatsapp', reason: 'No WhatsApp number connected yet' };
  if (c.status === 'connecting') return { selling: false, code: 'connecting', reason: "Waiting for the owner's first message to prove the connection" };
  if (c.status === 'disconnected') return { selling: false, code: 'disconnected', reason: 'The owner disconnected WhatsApp' };
  if (c.status === 'needs_attention') {
    if (c.flagReason === 'token') return { selling: false, code: 'token', reason: 'Meta revoked the access token; the owner must reconnect' };
    if (c.flagReason === 'policy') return { selling: false, code: 'policy', reason: 'Meta restricted the WhatsApp account; the owner must appeal' };
    if (c.flagReason === 'quality') return { selling: true, code: 'quality', reason: 'Selling, but Meta flagged message quality' };
    return { selling: false, code: 'registration', reason: 'WhatsApp registration is stuck (PIN or re-verification)' };
  }

  if (mode.reason === 'past_due') return { selling: false, code: 'past_due', reason: 'Invoice overdue: every new chat goes to the owner' };
  if (mode.reason === 'limit') return { selling: false, code: 'limit', reason: "This month's conversation allowance is used: new chats go to the owner" };
  return { selling: true, code: 'selling', reason: null };
}
