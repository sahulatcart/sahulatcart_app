import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';
import { getServiceClient } from '../lib/supabase';
import { notify } from '../lib/notify';
import { verifySignature } from './signature';
import crypto from 'node:crypto';
import { parseAccountEvents, parseWebhook } from './parse';
import { handleAccountEvent } from './account-events';
import { downloadWhatsAppMedia } from './media';
import { getLlmClient } from '../llm';
import { runOrchestrator } from '../orchestrator/orchestrator';
import { serialize } from '../lib/keyed-queue';
import { handleConnectHandshake } from './connect';
import { bumpUsage, chargeLlmCall, DEFAULT_LLM_DAILY_CAP, withLlmBudget } from '../lib/usage';
import type { AccountEvent, NormalizedMessage, NormalizedStatus, WebhookPayload } from './types';

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

export interface Tenant { id: string; merchant_id: string; phone_number_id: string; business_name: string; status: string; merchant_phone: string | null; llm_daily_cap?: number }
/** What a message's webhook_events row stores, so it can be replayed without the original payload. */
interface StoredMessage { phoneNumberId: string; msg: NormalizedMessage }

/** Claimed messages that are queued or running in THIS process, by event id. */
const inFlight = new Map<string, Promise<void>>();

/** Idempotency: record one webhook_events row per inner item (CD-12). 'duplicate' if already seen. */
async function claimEvent(
  db: SupabaseClient,
  eventId: string,
  itemType: 'message' | 'status' | 'event',
  payload: unknown
): Promise<'new' | 'duplicate' | 'failed'> {
  const { error } = await db
    .from('webhook_events')
    .insert({ event_id: eventId, item_type: itemType, status: 'received', payload });
  if (error?.code === '23505') return 'duplicate';
  if (error) logger.error({ err: error.message, eventId }, 'webhook_events insert failed');
  return error ? 'failed' : 'new';
}

/** null only for a number we don't serve; a failed lookup throws, so it isn't mistaken for one. */
async function resolveTenant(db: SupabaseClient, phoneNumberId: string): Promise<Tenant | null> {
  const { data, error } = await db
    .from('whatsapp_numbers')
    .select('id, merchant_id, phone_number_id, status, merchants(business_name, phone, settings)')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (error) throw new Error(`tenant lookup failed: ${error.message}`);
  if (!data) return null;
  const m = (data as { merchants?: { business_name?: string; phone?: string | null; settings?: { llmDailyCap?: number } } }).merchants;
  return { id: data.id, merchant_id: data.merchant_id, phone_number_id: data.phone_number_id, business_name: m?.business_name ?? 'Shop', status: data.status ?? 'connected', merchant_phone: m?.phone ?? null, llm_daily_cap: m?.settings?.llmDailyCap };
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

export async function upsertCustomer(
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
    .select('id, wa_opt_in_status')
    .single();
  if (error) {
    logger.error({ err: error.message }, 'customer upsert failed');
    return null;
  }
  // P5 (FR-P5.3): writing to the shop is the opt-in. Only an unknown customer is marked, so a
  // later STOP ('out') is never undone by their next message.
  if ((data.wa_opt_in_status ?? 'unknown') === 'unknown') {
    await db.from('customers').update({ wa_opt_in_status: 'in', wa_opt_in_source: 'inbound_message', wa_opt_in_at: new Date().toISOString() }).eq('id', data.id);
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
      const media = await downloadWhatsAppMedia(audioId, tenant.phone_number_id);
      if (media) {
        // Transcription is an AI call like any other: counted and capped per shop (M5).
        const transcript = await withLlmBudget({ db, phoneNumberId: tenant.phone_number_id, cap: tenant.llm_daily_cap ?? DEFAULT_LLM_DAILY_CAP }, async () => {
          await chargeLlmCall();
          return getLlmClient().transcribeAudio(media.buffer, media.mimeType);
        }).catch(() => null);
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
  await bumpUsage(db, tenant.phone_number_id, { inbound: 1 }); // M5 meter; never throws

  // M3: no credentials, no reply; the message is in the inbox and the merchant is reminded daily.
  if (tenant.status === 'disconnected') {
    await remindDisconnected(db, tenant);
    return;
  }
  // M2: while the number is still `connecting`, the merchant's own first text is the handshake
  // that proves the connection; it is stored above but never answered by the bot.
  if (await handleConnectHandshake(db, tenant, msg)) return;

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
  // A status that can't be recorded is applied anyway; only a known duplicate is skipped.
  if ((await claimEvent(db, `${st.waMessageId}:${st.status}`, 'status', st)) === 'duplicate') return;
  await db.from('messages').update({ status: st.status }).eq('wa_message_id', st.waMessageId);
}

/** One change of a payload whose messages are durably recorded and ready to process. */
export interface ClaimedChange { tenant: Tenant; messages: NormalizedMessage[]; statuses: NormalizedStatus[] }
/** An account-level event with its webhook_events id, so it can be marked processed. */
export interface ClaimedEvent { eventId: string; event: AccountEvent }

/** Dedupe key for an account event: same field, WABA and payload ⇒ a redelivery. */
export const accountEventId = (ev: AccountEvent): string =>
  `${ev.field}:${ev.wabaId}:${crypto.createHash('sha256').update(JSON.stringify(ev.value)).digest('hex').slice(0, 32)}`;

/**
 * Before Meta gets its 200: record every message of the payload in webhook_events, so a crash
 * or redeploy after the ACK leaves each one replayable. `complete` is false if any message (or a
 * tenant lookup) couldn't be recorded — the route then answers 500 and Meta redelivers; messages
 * already recorded come back as duplicates and are skipped.
 */
export async function claimWebhookPayload(
  payload: WebhookPayload,
  db = getServiceClient()
): Promise<{ changes: ClaimedChange[]; events: ClaimedEvent[]; complete: boolean }> {
  const changes: ClaimedChange[] = [];
  const events: ClaimedEvent[] = [];
  let complete = true;
  // Account-level fields (M3) need no tenant lookup: the handler resolves rows by WABA.
  for (const ev of parseAccountEvents(payload)) {
    const eventId = accountEventId(ev);
    const claim = await claimEvent(db, eventId, 'event', ev);
    if (claim === 'new') events.push({ eventId, event: ev });
    if (claim === 'failed') complete = false;
  }
  for (const change of parseWebhook(payload)) {
    let tenant: Tenant | null;
    try {
      tenant = await resolveTenant(db, change.phoneNumberId);
    } catch (e) {
      logger.error({ err: e instanceof Error ? e.message : String(e) }, 'webhook claim failed');
      complete = false;
      continue;
    }
    if (!tenant) {
      logger.warn({ phoneNumberId: change.phoneNumberId }, 'inbound for unknown phone_number_id — ignored');
      continue;
    }
    const messages: NormalizedMessage[] = [];
    for (const msg of change.messages) {
      const stored: StoredMessage = { phoneNumberId: change.phoneNumberId, msg };
      const claim = await claimEvent(db, msg.waMessageId, 'message', stored);
      if (claim === 'new') messages.push(msg);
      if (claim === 'failed') complete = false; // left for Meta's redelivery, not processed now
    }
    changes.push({ tenant, messages, statuses: change.statuses });
  }
  return { changes, events, complete };
}

/** After the ACK: run the claimed messages (each in its buyer's queue), statuses and account events. */
export async function processClaimed(changes: ClaimedChange[], db = getServiceClient(), events: ClaimedEvent[] = []): Promise<void> {
  for (const { tenant, messages, statuses } of changes) {
    await Promise.all(messages.map((msg) => dispatch(db, tenant, msg)));
    for (const st of statuses) await handleStatus(db, st);
  }
  for (const { eventId, event } of events) {
    try {
      await handleAccountEvent(db, event);
      await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString(), payload: null }).eq('event_id', eventId);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      logger.error({ err, eventId }, 'account event failed');
      await db.from('webhook_events').update({ status: 'error', error: err.slice(0, 500) }).eq('event_id', eventId);
    }
  }
}

/**
 * A disconnected number still receives messages (routing is by phone_number_id) but has no
 * credentials to answer with. The merchant is reminded at most once a day, in the portal.
 */
async function remindDisconnected(db: SupabaseClient, tenant: Tenant): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: recent } = await db
    .from('notifications')
    .select('id')
    .eq('merchant_id', tenant.merchant_id)
    .eq('data->>action', 'reconnect_whatsapp')
    .gt('created_at', since)
    .limit(1);
  if (recent?.length) return;
  await notify(db, tenant.merchant_id, {
    type: 'system',
    title: 'Customers are messaging while WhatsApp is disconnected',
    body: 'The bot cannot reply until the number is reconnected from Settings → WhatsApp. Their messages are in the inbox.',
    data: { action: 'reconnect_whatsapp' },
  });
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

    // Record every message, then ACK and process out of band (docs/spec/04 §2.7). Recording
    // first means nothing Meta was told we received can be lost; if it fails, a 500 makes Meta retry.
    const db = getServiceClient();
    const { changes, events, complete } = await claimWebhookPayload(req.body as WebhookPayload, db);
    reply.code(complete ? 200 : 500).send(complete ? 'EVENT_RECEIVED' : 'retry');
    void processClaimed(changes, db, events).catch((err) =>
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'webhook processing failed')
    );
  });
}
