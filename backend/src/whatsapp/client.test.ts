import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { loadConfig } from '../config';

// The client resolves credentials through the service client; point it at the fake.
const fake = { db: new FakeDb() };
vi.mock('../lib/supabase', () => ({ getServiceClient: () => fake.db.client }));

import { sendButtons, sendDocument, sendImage, sendTemplate, sendText } from './client';
import { forgetAllNumbers, storeToken } from './credentials';

const cfg = loadConfig();
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let calls: Call[];
let respond: (call: Call) => { status: number; body: unknown };

beforeEach(async () => {
  fake.db = new FakeDb();
  forgetAllNumbers();
  cfg.META_DEFAULT_PHONE_NUMBER_ID = undefined;
  cfg.META_SYSTEM_USER_TOKEN = undefined;
  calls = [];
  respond = () => ({ status: 200, body: { messages: [{ id: 'wamid.OK' }] } });
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call = { url, headers: init.headers, body: JSON.parse(init.body) as Record<string, unknown> };
    calls.push(call);
    const r = respond(call);
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
  const a = await storeToken(fake.db.client, 'M-A', 'token-A');
  const b = await storeToken(fake.db.client, 'M-B', 'token-B');
  fake.db.add('whatsapp_numbers', { merchant_id: 'M-A', phone_number_id: 'PN-A', status: 'connected', access_token_ref: a });
  fake.db.add('whatsapp_numbers', { merchant_id: 'M-B', phone_number_id: 'PN-B', status: 'connected', access_token_ref: b });
});
afterEach(() => vi.unstubAllGlobals());

describe('sending with per-merchant credentials', () => {
  it("each number sends with its own merchant's token", async () => {
    expect(await sendText('PN-A', '923001', 'salam')).toEqual({ waMessageId: 'wamid.OK' });
    expect(await sendText('PN-B', '923002', 'salam')).toEqual({ waMessageId: 'wamid.OK' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer token-A');
    expect(calls[0]!.url).toContain('/PN-A/messages');
    expect(calls[1]!.headers.Authorization).toBe('Bearer token-B');
    expect(calls[1]!.url).toContain('/PN-B/messages');
    expect(calls[0]!.body).toMatchObject({ messaging_product: 'whatsapp', to: '923001', type: 'text', text: { body: 'salam' } });
  });

  it('image and document sends carry the same credentials and payload shape', async () => {
    await sendImage('PN-A', '923001', 'https://img/1.jpg', 'Rs 500');
    await sendDocument('PN-A', '923001', 'https://pdf/slip.pdf', 'Order-1.pdf');
    expect(calls[0]!.body).toMatchObject({ type: 'image', image: { link: 'https://img/1.jpg', caption: 'Rs 500' } });
    expect(calls[1]!.body).toMatchObject({ type: 'document', document: { link: 'https://pdf/slip.pdf', filename: 'Order-1.pdf' } });
    expect(calls[1]!.body).not.toHaveProperty('document.caption');
    for (const c of calls) expect(c.headers.Authorization).toBe('Bearer token-A');
  });

  it('a number without credentials is refused without calling Meta', async () => {
    fake.db.add('whatsapp_numbers', { merchant_id: 'M-C', phone_number_id: 'PN-C', status: 'connected', access_token_ref: null });
    expect(await sendText('PN-C', '923003', 'hi')).toEqual({ waMessageId: null, errorCode: 'no_credentials' });
    expect(await sendText('PN-NONE', '923003', 'hi')).toEqual({ waMessageId: null, errorCode: 'no_number' });
    expect(calls).toHaveLength(0);
  });

  it('the pilot number still works on the env token until it is reconnected', async () => {
    cfg.META_DEFAULT_PHONE_NUMBER_ID = 'PN-PILOT';
    cfg.META_SYSTEM_USER_TOKEN = 'env-token';
    fake.db.add('whatsapp_numbers', { merchant_id: 'M-P', phone_number_id: 'PN-PILOT', status: 'connected', access_token_ref: null });
    expect(await sendText('PN-PILOT', '923009', 'hi')).toEqual({ waMessageId: 'wamid.OK' });
    expect(calls[0]!.headers.Authorization).toBe('Bearer env-token');
  });

  it('a Meta error returns its code and does not throw', async () => {
    respond = () => ({ status: 400, body: { error: { message: 'Re-engagement message', code: 131047 } } });
    expect(await sendText('PN-A', '923001', 'late')).toEqual({ waMessageId: null, errorCode: 131047 });
    expect(fake.db.rows('whatsapp_numbers')[0]!.status).toBe('connected');
  });

  it('error 190 flags the number, stops further sends and tells the merchant', async () => {
    respond = () => ({ status: 401, body: { error: { message: 'Invalid OAuth access token', code: 190 } } });
    expect(await sendText('PN-A', '923001', 'hi')).toEqual({ waMessageId: null, errorCode: 190 });
    const row = fake.db.rows('whatsapp_numbers').find((r) => r.phone_number_id === 'PN-A')!;
    expect(row.status).toBe('needs_attention');
    expect(row.flag_reason).toBe('token');
    expect(fake.db.rows('notifications')).toHaveLength(1);
    expect(await sendText('PN-A', '923001', 'again')).toEqual({ waMessageId: null, errorCode: 'token_invalid' });
    expect(calls).toHaveLength(1); // the second send never reached Meta
    respond = () => ({ status: 200, body: { messages: [{ id: 'wamid.OK' }] } });
    expect(await sendText('PN-B', '923002', 'hi')).toEqual({ waMessageId: 'wamid.OK' }); // other merchants unaffected
  });

  it('a non-JSON error body still yields a result', async () => {
    respond = () => ({ status: 502, body: 'Bad Gateway' });
    expect(await sendText('PN-A', '923001', 'hi')).toEqual({ waMessageId: null, errorCode: 502 });
  });
});

describe('templates and buttons (M4)', () => {
  it('a template send carries the name, language and body parameters in order', async () => {
    expect(await sendTemplate('PN-A', '923001', 'payment_update', ['Ali', 'SK-1', 'verify ho gayi hai', 'shukriya'])).toEqual({ waMessageId: 'wamid.OK' });
    expect(calls[0]!.body).toMatchObject({
      type: 'template',
      template: { name: 'payment_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ali' }, { type: 'text', text: 'SK-1' }, { type: 'text', text: 'verify ho gayi hai' }, { type: 'text', text: 'shukriya' }] }] },
    });
  });

  it('a template without parameters sends no components', async () => {
    await sendTemplate('PN-A', '923001', 'hello_world', [], 'en_US');
    expect(calls[0]!.body).toMatchObject({ template: { name: 'hello_world', language: { code: 'en_US' }, components: [] } });
  });

  it('buttons are capped at three with 20-character titles', async () => {
    await sendButtons('PN-A', '923001', 'Payment kaise?', [{ id: 'a', title: 'Cash on Delivery' }, { id: 'b', title: 'A very long title that Meta would reject' }, { id: 'c', title: 'C' }, { id: 'd', title: 'D' }]);
    const action = (calls[0]!.body!.interactive as { action: { buttons: { reply: { id: string; title: string } }[] } }).action;
    expect(action.buttons.map((b) => b.reply.id)).toEqual(['a', 'b', 'c']);
    expect(action.buttons[1]!.reply.title).toHaveLength(20);
    expect(calls[0]!.body).toMatchObject({ type: 'interactive', interactive: { type: 'button', body: { text: 'Payment kaise?' } } });
  });
});
