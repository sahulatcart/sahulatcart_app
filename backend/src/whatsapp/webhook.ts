import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { verifySignature } from './signature';
import { parseWebhook } from './parse';
import { downloadWhatsAppMedia } from './media';
import { getLlmClient } from '../llm';
import { runOrchestrator } from '../orchestrator/orchestrator';
import { serialize } from '../lib/keyed-queue';
import type { NormalizedMessage, NormalizedStatus, WebhookPayload } from './types';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Meta already got its 200, so a message that a crash or redeploy leaves 'received' is replayed.
// Old enough that no live process can still be working on it; young enough that a reply still helps.
const REPLAY_MIN_AGE_MS = 5 * 60_000;
const REPLAY_MAX_AGE_MS = 60 * 60_000;
const MAX_REPLAYS = 3;

interface Tenant { id: string; merchant_id: string; phone_number_id: string; business_name: string }
/** What a message's webhook_events row stores, so it can be replayed without the original payload. */
interface StoredMessage { phoneNumberId: string; msg: NormalizedMessage }

/** Claimed messages that are queued or running in THIS process, by event id. */
const inFlight = new Map<string, Promise<void>>();

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
  if (error?.code === '23505') return false; // already seen → skip
  // Any other failure: process anyway. A duplicate reply beats silently dropping a customer.
  if (error) logger.error({ err: error.message, eventId }, 'webhook_events insert failed — processing anyway');
  return true;
}

async function resolveTenant(db: SupabaseClient, phoneNumberId: string): Promise<Tenant | null> {
  const { data } = await db
    .from('whatsapp_numbers')
    .select('id, merchant_id, phone_number_id, merchants(business_name)')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!data) return null;
  const businessName = (data as { merchants?: { business_name?: string } }).merchants?.business_name ?? 'Shop';
  return { id: data.id, merchant_id: data.merchant_id, phone_number_id: data.phone_number_id, business_name: businessName };
}

/**
 * Run one claimed message in its buyer's queue (never two at once for the same buyer) and
 * record the outcome on its webhook_events row. Never rejects.
 */
function dispatch(db: SupabaseClient, t: Tenant, msg: NormalizedMessage): Promise<void> {
  const id = msg.waMessageId;
  const mark = async (patch: Record<string, unknown>) => { await db.from('webhook_events').update(patch).eq('event_id', id); };
  const done = serialize(`${t.merchant_id}:${msg.from}`, () => handleInboundMessage(db, t, msg))
    .then(
      // The stored copy of the message was only needed for a replay — drop it once processed.
      () => mark({ status: 'processed', processed_at: new Date().toISOString(), payload: null }),
      (e: unknown) => {
        const err = e instanceof Error ? e.message : String(e);
        logger.error({ err, eventId: id }, 'inbound message failed');
        return mark({ status: 'error', error: err.slice(0, 500) });
      }
    )
    .catch((e: unknown) => logger.error({ err: String(e), eventId: id }, 'webhook_events update failed'))
    .finally(() => inFlight.delete(id));
  inFlight.set(id, done);
  return done;
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
  tenant: Tenant,
  msg: NormalizedMessage
): Promise<void> {
  // Voice notes: transcribe to Roman Urdu so the message flows through every state
  // like typed text (and the merchant inbox shows what was said).
  if (msg.type === 'audio' && !msg.text) {
    const audioId = (msg.raw as { audio?: { id?: string } })?.audio?.id;
    if (audioId) {
      const media = await downloadWhatsAppMedia(audioId);
      if (media) {
        const transcript = await getLlmClient().transcribeAudio(media.buffer, media.mimeType);
        if (transcript) msg.text = transcript;
      }
    }
  }

  // Throw (not return) on failure so the event is marked 'error' instead of 'processed'.
  const customer = await upsertCustomer(db, tenant.merchant_id, msg.from, msg.profileName);
  if (!customer) throw new Error('customer upsert failed');
  const convo = await getOrCreateConversation(db, tenant.merchant_id, customer.id, tenant.id);
  if (!convo) throw new Error('conversation create failed');

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

  // Phase 3: real orchestrator (FSM + Gemini + negotiation engine).
  await runOrchestrator(
    db,
    {
      merchantId: tenant.merchant_id,
      conversationId: convo.id,
      phoneNumberId: tenant.phone_number_id,
      customerId: customer.id,
      customerWaId: msg.from,
    },
    msg
  );
}

async function handleStatus(db: SupabaseClient, st: NormalizedStatus): Promise<void> {
  if (!(await claimEvent(db, `${st.waMessageId}:${st.status}`, 'status', st))) return;
  await db.from('messages').update({ status: st.status }).eq('wa_message_id', st.waMessageId);
}

/** Process a full webhook payload: route by phone_number_id → tenant, then persist + reply. */
export async function processWebhookPayload(payload: WebhookPayload, db = getServiceClient()): Promise<void> {
  for (const change of parseWebhook(payload)) {
    const t = await resolveTenant(db, change.phoneNumberId);
    if (!t) {
      logger.warn({ phoneNumberId: change.phoneNumberId }, 'inbound for unknown phone_number_id — ignored');
      continue;
    }
    // Claim every message first, so a crash mid-payload leaves each one replayable.
    const claimed: NormalizedMessage[] = [];
    for (const msg of change.messages) {
      const stored: StoredMessage = { phoneNumberId: change.phoneNumberId, msg };
      if (await claimEvent(db, msg.waMessageId, 'message', stored)) claimed.push(msg);
    }
    await Promise.all(claimed.map((msg) => dispatch(db, t, msg)));
    for (const st of change.statuses) await handleStatus(db, st);
  }
}

/** Replay messages that a crash or redeploy left claimed but unprocessed. */
export async function replayStuckMessages(db = getServiceClient()): Promise<void> {
  const now = Date.now();
  const { data } = await db
    .from('webhook_events')
    .select('event_id, payload, attempts')
    .eq('item_type', 'message')
    .eq('status', 'received')
    .lt('received_at', new Date(now - REPLAY_MIN_AGE_MS).toISOString())
    .gt('received_at', new Date(now - REPLAY_MAX_AGE_MS).toISOString())
    .order('received_at')
    .limit(20);
  for (const row of data ?? []) {
    if (inFlight.has(row.event_id)) continue;
    const { phoneNumberId, msg } = (row.payload ?? {}) as Partial<StoredMessage>;
    const t = phoneNumberId && msg ? await resolveTenant(db, phoneNumberId) : null;
    const giveUp = !t || row.attempts >= MAX_REPLAYS;
    // Compare-and-set on attempts: a row is never replayed twice at once.
    const { data: won } = await db
      .from('webhook_events')
      .update(giveUp ? { status: 'dead_letter', error: t ? 'gave up after replays' : 'not replayable' } : { attempts: row.attempts + 1 })
      .match({ event_id: row.event_id, status: 'received', attempts: row.attempts })
      .select('event_id')
      .maybeSingle();
    if (!won || giveUp || !msg) continue;
    logger.warn({ eventId: row.event_id, attempt: row.attempts + 1 }, 'replaying unprocessed inbound message');
    void dispatch(db, t, msg);
  }
}

let sweeper: NodeJS.Timeout | undefined;

/** Check for stuck messages at boot and every minute. Production only — see CLAUDE.md. */
export function startReplaySweeper(): void {
  const run = () => void replayStuckMessages().catch((e: unknown) => logger.error({ err: String(e) }, 'replay sweep failed'));
  run();
  sweeper = setInterval(run, 60_000);
  sweeper.unref();
}

/** Graceful shutdown: stop replays and wait (bounded) for queued/running messages to finish. */
export async function drainWebhooks(timeoutMs: number): Promise<void> {
  clearInterval(sweeper);
  const timeout = new Promise<void>((r) => setTimeout(r, timeoutMs).unref());
  await Promise.race([Promise.allSettled([...inFlight.values()]), timeout]);
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
