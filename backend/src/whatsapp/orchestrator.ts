import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../lib/logger';
import { sendText } from './client';
import type { NormalizedMessage } from './types';

/**
 * PHASE 2 ECHO STUB. Proves the end-to-end pipe (inbound → reply). The real
 * ConversationOrchestrator (FSM + Claude + NegotiationEngine) replaces this in Phase 3.
 */
export async function runEchoOrchestrator(
  db: SupabaseClient,
  ctx: { merchantId: string; conversationId: string; phoneNumberId: string; businessName: string; customerWaId: string },
  message: NormalizedMessage
): Promise<void> {
  const heard = message.text ? `"${message.text}"` : `a ${message.rawType} message`;
  const reply = `Assalam-o-Alaikum! ${ctx.businessName} bot yahan hai. (test) Mujhe mila: ${heard}`;

  const sent = await sendText(ctx.phoneNumberId, ctx.customerWaId, reply);

  const { error } = await db.from('messages').insert({
    conversation_id: ctx.conversationId,
    merchant_id: ctx.merchantId,
    direction: 'outbound',
    sender: 'bot',
    type: 'text',
    body: reply,
    wa_message_id: sent.waMessageId,
    status: sent.waMessageId ? 'sent' : 'queued',
  });
  if (error) logger.error({ err: error.message }, 'failed to persist outbound echo message');
}
