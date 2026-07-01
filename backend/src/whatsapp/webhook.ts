import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { verifySignature } from './signature';
import { parseWebhook } from './parse';
import { runEchoOrchestrator } from './orchestrator';
import type { NormalizedMessage, NormalizedStatus, WebhookPayload } from './types';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Idempotency: record one webhook_events row per inner item (CD-12). Returns false if a duplicate. */
async function claimEvent(
  db: SupabaseClient,
  eventId: string,
  itemType: 'message' | 'status',
  payload: unknown
): Promise<boolean> {
  const { error } = await db
    .from('webhook_events')
    .insert({ event_id: eventId, item_type: itemType, status: 'received', payload });
  if (error) {
    if (error.code === '23505') return false; // already seen → skip
    logger.error({ err: error.message, eventId }, 'webhook_events insert failed');
    return false;
  }
  return true;
}

async function upsertCustomer(
  db: SupabaseClient,
  merchantId: string,
  waId: string,
  name: string | null
): Promise<{ id: string } | null> {
  const row: Record<string, unknown> = { merchant_id: merchantId, wa_id: waId, last_seen_at: new Date().toISOString() };
  if (name) row.name = name;
  const { data, error } = await db
    .from('customers')
    .upsert(row, { onConflict: 'merchant_id,wa_id' })
    .select('id')
    .single();
  if (error) {
    logger.error({ err: error.message }, 'customer upsert failed');
    return null;
  }
  return data;
}

async function getOrCreateConversation(
  db: SupabaseClient,
  merchantId: string,
  customerId: string,
  whatsappNumberId: string
): Promise<{ id: string } | null> {
  const existing = await db
    .from('conversations')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .neq('status', 'closed')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (existing.data) return existing.data;

  const { data, error } = await db
    .from('conversations')
    .insert({
      merchant_id: merchantId,
      customer_id: customerId,
      whatsapp_number_id: whatsappNumberId,
      status: 'bot_active',
      current_state: 'greeting',
      window_expires_at: new Date(Date.now() + WINDOW_MS).toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    logger.error({ err: error.message }, 'conversation create failed');
    return null;
  }
  return data;
}

async function handleInboundMessage(
  db: SupabaseClient,
  tenant: { id: string; merchant_id: string; phone_number_id: string; business_name: string },
  msg: NormalizedMessage
): Promise<void> {
  if (!(await claimEvent(db, msg.waMessageId, 'message', msg.raw))) return; // dedupe

  const customer = await upsertCustomer(db, tenant.merchant_id, msg.from, msg.profileName);
  if (!customer) return;
  const convo = await getOrCreateConversation(db, tenant.merchant_id, customer.id, tenant.id);
  if (!convo) return;

  await db.from('messages').insert({
    conversation_id: convo.id,
    merchant_id: tenant.merchant_id,
    direction: 'inbound',
    sender: 'customer',
    type: msg.type,
    raw_type: msg.rawType,
    body: msg.text,
    wa_message_id: msg.waMessageId,
    status: 'delivered',
    raw: msg.raw,
  });

  await db
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), window_expires_at: new Date(Date.now() + WINDOW_MS).toISOString() })
    .eq('id', convo.id);

  // Phase 2: echo. Phase 3 swaps in the real orchestrator (FSM + Claude + engine).
  await runEchoOrchestrator(
    db,
    {
      merchantId: tenant.merchant_id,
      conversationId: convo.id,
      phoneNumberId: tenant.phone_number_id,
      businessName: tenant.business_name,
      customerWaId: msg.from,
    },
    msg
  );

  await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('event_id', msg.waMessageId);
}

async function handleStatus(db: SupabaseClient, st: NormalizedStatus): Promise<void> {
  if (!(await claimEvent(db, `${st.waMessageId}:${st.status}`, 'status', st))) return;
  await db.from('messages').update({ status: st.status }).eq('wa_message_id', st.waMessageId);
}

/** Process a full webhook payload: route by phone_number_id → tenant, then persist + reply. */
export async function processWebhookPayload(payload: WebhookPayload, db = getServiceClient()): Promise<void> {
  for (const change of parseWebhook(payload)) {
    const { data: tenant } = await db
      .from('whatsapp_numbers')
      .select('id, merchant_id, phone_number_id, merchants(business_name)')
      .eq('phone_number_id', change.phoneNumberId)
      .maybeSingle();
    if (!tenant) {
      logger.warn({ phoneNumberId: change.phoneNumberId }, 'inbound for unknown phone_number_id — ignored');
      continue;
    }
    const businessName =
      (tenant as { merchants?: { business_name?: string } }).merchants?.business_name ?? 'Shop';
    const t = {
      id: tenant.id as string,
      merchant_id: tenant.merchant_id as string,
      phone_number_id: tenant.phone_number_id as string,
      business_name: businessName,
    };
    for (const msg of change.messages) await handleInboundMessage(db, t, msg);
    for (const st of change.statuses) await handleStatus(db, st);
  }
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();

  // Scoped raw-body parser (only these routes) so we can verify the signature over exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // GET — Meta verification handshake
  app.get('/api/v1/webhook/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === cfg.META_WEBHOOK_VERIFY_TOKEN) {
      return reply.code(200).send(q['hub.challenge']);
    }
    return reply.code(403).send('forbidden');
  });

  // POST — inbound events
  app.post('/api/v1/webhook/whatsapp', async (req: FastifyRequest, reply: FastifyReply) => {
    if (cfg.META_APP_SECRET) {
      const ok = verifySignature(cfg.META_APP_SECRET, req.rawBody ?? Buffer.alloc(0), req.headers['x-hub-signature-256'] as string | undefined);
      if (!ok) return reply.code(401).send('invalid signature');
    } else if (cfg.NODE_ENV === 'production') {
      logger.error('META_APP_SECRET missing in production — rejecting webhook');
      return reply.code(401).send('not configured');
    }

    // Fast-ACK, then process out of band (docs/spec/04 §2.7).
    reply.code(200).send('EVENT_RECEIVED');
    void processWebhookPayload(req.body as WebhookPayload).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'webhook processing failed')
    );
  });
}
