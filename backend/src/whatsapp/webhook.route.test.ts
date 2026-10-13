// P6 (FR-P6.5): a signed Meta payload through the real HTTP route — signature → claim → process → reply sent.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const SECRET = 'meta-app-secret-for-tests';
vi.hoisted(() => { process.env.META_APP_SECRET = 'meta-app-secret-for-tests'; });

const fake = new FakeDb();
const sent = vi.hoisted(() => ({ texts: [] as { to: string; body: string }[] }));
vi.mock('../lib/supabase', () => ({ getServiceClient: () => fake.client, getAnonClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: { message: 'n/a' } }) } }) }));
vi.mock('../whatsapp/client', () => ({
  sendText: async (_p: string, to: string, body: string) => { sent.texts.push({ to, body }); return { waMessageId: `wamid.out.${sent.texts.length}` }; },
  sendImage: async () => ({ waMessageId: null }), sendDocument: async () => ({ waMessageId: null }), sendTemplate: async () => ({ waMessageId: null }), sendButtons: async () => ({ waMessageId: null }),
}));
vi.mock('../llm', async (importOriginal) => {
  const real = await importOriginal<typeof import('../llm')>();
  return { ...real, getLlmClient: () => ({
    classify: async () => ({ intent: 'greet', productQuery: null, quantity: null, offerPaisa: null, offerScope: null, language: 'roman_urdu' }),
    compose: async () => { throw new real.LlmUnavailableError('phrasing off in tests'); },
    extractDelivery: async () => null, transcribeAudio: async () => null, describeImage: async () => null,
  }) };
});

let app: FastifyInstance;
beforeAll(async () => {
  fake.add('merchants', { id: 'M1', business_name: 'Ali Store', status: 'active', phone: '923009999999', settings: { botEnabled: true }, bot_persona: {}, negotiation_defaults: {}, business_hours: null });
  fake.add('whatsapp_numbers', { id: 'num-1', merchant_id: 'M1', phone_number_id: 'PN1', status: 'connected' });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const payload = (id: string, text: string) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp', metadata: { display_phone_number: '923009999999', phone_number_id: 'PN1' },
    contacts: [{ profile: { name: 'Ahmed' }, wa_id: '923001234567' }],
    messages: [{ from: '923001234567', id, timestamp: '1760000000', type: 'text', text: { body: text } }],
  } }] }],
});
const sign = (body: string) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
const post = (body: string, signature?: string) => app.inject({ method: 'POST', url: '/api/v1/webhook/whatsapp', headers: { 'content-type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) }, payload: body });

describe('POST /api/v1/webhook/whatsapp', () => {
  it('refuses a missing or wrong signature before touching the database', async () => {
    const body = payload('wamid.bad', 'salam');
    expect((await post(body)).statusCode).toBe(401);
    expect((await post(body, sign(body + ' '))).statusCode).toBe(401);
    expect(fake.rows('webhook_events')).toHaveLength(0);
  });

  it('a signed first message: 200 to Meta, the row is claimed, the customer and chat exist, the bot replied', async () => {
    const body = payload('wamid.1', 'salam');
    const r = await post(body, sign(body));
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('EVENT_RECEIVED');
    const { drainWebhooks } = await import('./webhook');
    await drainWebhooks(5_000);
    expect(fake.rows('webhook_events').find((e) => e.event_id === 'wamid.1')).toMatchObject({ status: 'processed', payload: null });
    expect(fake.rows('customers')[0]).toMatchObject({ merchant_id: 'M1', wa_id: '923001234567', name: 'Ahmed', wa_opt_in_status: 'in' });
    const msgs = fake.rows('messages');
    expect(msgs.map((m) => m.direction)).toEqual(['inbound', 'outbound']);
    expect(sent.texts).toHaveLength(1);
    expect(sent.texts[0]!.to).toBe('923001234567');
  });

  it('a redelivery of the same message id is a duplicate: no second reply', async () => {
    const body = payload('wamid.1', 'salam');
    expect((await post(body, sign(body))).statusCode).toBe(200);
    const { drainWebhooks } = await import('./webhook');
    await drainWebhooks(5_000);
    expect(sent.texts).toHaveLength(1);
  });

  it('a payload for a number we do not serve is accepted and ignored', async () => {
    const body = payload('wamid.2', 'hi').replace('"phone_number_id":"PN1"', '"phone_number_id":"PN-unknown"');
    expect((await post(body, sign(body))).statusCode).toBe(200);
    expect(sent.texts).toHaveLength(1);
  });

  it('the webhook is never rate limited', async () => {
    const r = await post(payload('wamid.3', 'hi'), sign(payload('wamid.3', 'hi')));
    expect(r.headers['x-ratelimit-limit']).toBeUndefined();
  });
});
