import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { loadConfig } from '../config';

const fake = { db: new FakeDb() };
vi.mock('../lib/supabase', () => ({ getServiceClient: () => fake.db.client }));

import { ConnectFailure, connectWhatsApp, getConnectionStatus, handleConnectHandshake, retryConnect } from './connect';
import { forgetAllNumbers, tokenForNumber } from './credentials';
import type { NormalizedMessage } from './types';

const cfg = loadConfig();
const ctx = { merchantId: 'M1', role: 'owner' as const, memberId: 'U1', isPlatformAdmin: false };
type Call = { url: URL; method: string; headers: Record<string, string>; body: Record<string, unknown> | null };
let calls: Call[];
/** Route a Graph call to a canned response; tests override pieces. */
let meta: Record<string, (c: Call) => { status?: number; body: unknown }>;

const ok = (body: unknown) => ({ status: 200, body });
const graphErr = (code: number, message: string, status = 400) => ({ status, body: { error: { message, code, type: 'OAuthException' } } });

function defaultMeta() {
  return {
    '/oauth/access_token': () => ok({ access_token: 'biz-token-1', token_type: 'bearer' }),
    '/debug_token': () => ok({ data: { expires_at: 0, granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA1'] }, { scope: 'whatsapp_business_messaging', target_ids: ['WABA1'] }] } }),
    '/WABA1/phone_numbers': () => ok({ data: [{ id: 'PN1', display_phone_number: '+92 300 1111111', verified_name: 'Ali Store', quality_rating: 'GREEN', name_status: 'APPROVED' }] }),
    '/WABA1/subscribed_apps': () => ok({ success: true }),
    '/PN1/register': () => ok({ success: true }),
    '/PN1/messages': () => ok({ messages: [{ id: 'wamid.HANDSHAKE' }] }),
  };
}

beforeEach(() => {
  fake.db = new FakeDb();
  forgetAllNumbers();
  cfg.META_APP_ID = 'APP';
  cfg.META_APP_SECRET = 'SECRET';
  cfg.META_DEFAULT_PHONE_NUMBER_ID = undefined;
  cfg.META_SYSTEM_USER_TOKEN = undefined;
  fake.db.add('merchants', { id: 'M1', business_name: 'Ali Store', phone: '+92 300 7777777' });
  calls = [];
  meta = defaultMeta();
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const call: Call = { url: u, method: init?.method ?? 'GET', headers: init?.headers ?? {}, body: init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null };
    calls.push(call);
    const key = Object.keys(meta).find((k) => u.pathname.endsWith(k));
    const r = key ? meta[key]!(call) : { status: 404, body: { error: { message: `no stub for ${u.pathname}`, code: 100 } } };
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
});
afterEach(() => vi.unstubAllGlobals());

const connect = (input: Parameters<typeof connectWhatsApp>[2]) => connectWhatsApp(fake.db.client, ctx, input);
const failure = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { if (e instanceof ConnectFailure) return e.err; throw e; }
  throw new Error('expected a ConnectFailure');
};
const numberRow = () => fake.db.rows('whatsapp_numbers').find((r) => r.phone_number_id === 'PN1')!;
const inbound = (from: string): NormalizedMessage => ({ waMessageId: 'wamid.IN', from, type: 'text', rawType: 'text', text: 'hi', profileName: 'Ali', raw: { id: 'wamid.IN', from, type: 'text' } });
const tenant = () => ({ phone_number_id: 'PN1', merchant_id: 'M1', business_name: 'Ali Store', status: numberRow().status as string, merchant_phone: '+92 300 7777777' });

describe('connectWhatsApp', () => {
  it('happy path: token stored encrypted, number upserted, awaiting the handshake', async () => {
    const s = await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    expect(s.status).toBe('connecting');
    expect(s.awaitingHandshake).toBe(true);
    expect(s.displayPhone).toBe('923001111111');
    expect(s.displayName).toBe('Ali Store');
    const row = numberRow();
    expect(row.waba_id).toBe('WABA1');
    expect(row.quality_rating).toBe('green');
    expect(row.access_token_ref).toBeTruthy();
    expect(await tokenForNumber(fake.db.client, 'PN1')).toBe('biz-token-1');
    const secrets = fake.db.rows('whatsapp_secrets');
    expect(secrets.map((x) => x.kind).sort()).toEqual(['access_token', 'pin']);
    for (const x of secrets) expect(String(x.ciphertext)).not.toContain('biz-token-1');
    expect(fake.db.rows('whatsapp_connect_attempts')[0]!.status).toBe('awaiting_handshake');
    // Order and shape of the Meta calls.
    expect(calls.map((c) => c.url.pathname.split('/').slice(2).join('/'))).toEqual(['oauth/access_token', 'debug_token', 'WABA1/phone_numbers', 'WABA1/subscribed_apps', 'PN1/register']);
    expect(calls[0]!.url.searchParams.get('client_id')).toBe('APP');
    expect(calls[4]!.body).toMatchObject({ messaging_product: 'whatsapp' });
    expect(String(calls[4]!.body!.pin)).toMatch(/^\d{6}$/);
  });

  it('every call made with the business token carries appsecret_proof and the token in a header', async () => {
    await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    for (const c of calls.slice(2)) {
      expect(c.headers.Authorization).toBe('Bearer biz-token-1');
      expect(c.url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
      expect(c.url.searchParams.has('access_token')).toBe(false);
    }
  });

  it('a WABA hint the token was not granted is refused and nothing is kept', async () => {
    const err = await failure(connect({ code: 'CODE-1', hints: { wabaId: 'WABA-OTHER', phoneNumberId: 'PN1' } }));
    expect(err.code).toBe('waba_not_granted');
    expect(fake.db.rows('whatsapp_secrets')).toHaveLength(0);
    expect(fake.db.rows('whatsapp_numbers')).toHaveLength(0);
    expect(fake.db.rows('whatsapp_connect_attempts')[0]!.status).toBe('failed');
  });

  it('a phone hint not on the WABA is refused', async () => {
    const err = await failure(connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN-FAKE' } }));
    expect(err.code).toBe('phone_not_in_waba');
    expect(fake.db.rows('whatsapp_secrets')).toHaveLength(0);
  });

  it('without hints, a single number is used; several ask the merchant to choose', async () => {
    const s = await connect({ code: 'CODE-1' });
    expect(s.phoneNumberId).toBe('PN1');
    fake.db = new FakeDb();
    fake.db.add('merchants', { id: 'M1', business_name: 'Ali Store', phone: '923007777777' });
    meta['/WABA1/phone_numbers'] = () => ok({ data: [{ id: 'PN1', display_phone_number: '+92 300 1111111' }, { id: 'PN2', display_phone_number: '+92 300 2222222' }] });
    const err = await failure(connect({ code: 'CODE-2' }));
    expect(err.code).toBe('choose_number');
    expect(err.code === 'choose_number' && err.numbers.map((n) => n.id)).toEqual(['PN1', 'PN2']);
    expect(fake.db.rows('whatsapp_secrets')).toHaveLength(0);
    const s2 = await connect({ code: 'CODE-3', phoneNumberId: 'PN2' });
    expect(s2.phoneNumberId).toBe('PN2');
  });

  it("a number another shop owns is never taken over, and the new token is discarded", async () => {
    fake.db.add('whatsapp_numbers', { merchant_id: 'M-OTHER', phone_number_id: 'PN1', status: 'connected', access_token_ref: 'their-secret' });
    const err = await failure(connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } }));
    expect(err.code).toBe('number_in_use');
    expect(fake.db.rows('whatsapp_secrets')).toHaveLength(0);
    expect(numberRow().merchant_id).toBe('M-OTHER');
  });

  it('the same code posted twice does one exchange and returns the current state', async () => {
    await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    const again = await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    expect(again.status).toBe('connecting');
    expect(calls.filter((c) => c.url.pathname.endsWith('/oauth/access_token'))).toHaveLength(1);
    expect(fake.db.rows('whatsapp_connect_attempts')).toHaveLength(1);
  });

  it('a failed code exchange is a 400 with Meta’s reason and no rows', async () => {
    meta['/oauth/access_token'] = () => graphErr(100, 'Invalid verification code format.');
    const err = await failure(connect({ code: 'BAD' }));
    expect(err.code).toBe('code_exchange_failed');
    expect(err.message).toContain('Invalid verification code');
    expect(fake.db.rows('whatsapp_secrets')).toHaveLength(0);
  });

  it('PIN mismatch (133005) asks for the merchant’s PIN; retry with it finishes registration', async () => {
    meta['/PN1/register'] = (c) => (c.body?.pin === '424242' ? ok({ success: true }) : graphErr(133005, 'Two step verification PIN mismatch'));
    const s = await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    expect(s.status).toBe('needs_attention');
    expect(s.pinRequired).toBe(true);
    expect(s.message).toContain('PIN');
    expect(fake.db.rows('whatsapp_secrets').map((x) => x.kind)).toEqual(['access_token']); // no pin stored
    const r = await retryConnect(fake.db.client, ctx, '424242');
    expect(r.status).toBe('connecting');
    expect(r.pinRequired).toBe(false);
    expect(fake.db.rows('whatsapp_secrets').map((x) => x.kind).sort()).toEqual(['access_token', 'pin']);
  });

  it('re-verification needed (133006) and the registration limit (133016) get their own messages', async () => {
    meta['/PN1/register'] = () => graphErr(133006, 'Phone number re-verification needed');
    expect((await connect({ code: 'CODE-1' })).message).toContain('WhatsApp Manager');
    fake.db = new FakeDb();
    fake.db.add('merchants', { id: 'M1', business_name: 'Ali Store', phone: '923007777777' });
    meta['/PN1/register'] = () => graphErr(133016, 'Registration limit');
    expect((await connect({ code: 'CODE-2' })).message).toContain('few hours');
  });

  it('retry PIN must be six digits', async () => {
    await connect({ code: 'CODE-1' });
    expect((await failure(retryConnect(fake.db.client, ctx, '12'))).code).toBe('bad_request');
  });

  it('a second connect replaces the merchant’s old number: old row disconnected, its secret gone', async () => {
    await connect({ code: 'CODE-1' });
    const oldSecret = numberRow().access_token_ref;
    meta['/WABA1/phone_numbers'] = () => ok({ data: [{ id: 'PN9', display_phone_number: '+92 300 9999999' }] });
    meta['/PN9/register'] = () => ok({ success: true });
    await connect({ code: 'CODE-2' });
    expect(numberRow().status).toBe('disconnected');
    expect(numberRow().access_token_ref).toBeNull();
    expect(fake.db.rows('whatsapp_secrets').find((x) => x.id === oldSecret)).toBeUndefined();
    expect((await getConnectionStatus(fake.db.client, 'M1')).phoneNumberId).toBe('PN9');
    expect(await tokenForNumber(fake.db.client, 'PN1')).toBeNull();
  });

  it('refuses when Meta is not configured', async () => {
    cfg.META_APP_ID = undefined;
    expect((await failure(connect({ code: 'X' }))).code).toBe('meta_not_configured');
  });
});

describe('the handshake', () => {
  beforeEach(async () => {
    await connect({ code: 'CODE-1', hints: { wabaId: 'WABA1', phoneNumberId: 'PN1' } });
    calls = [];
  });

  it('a text from the merchant’s own phone gets the reply and marks the number connected', async () => {
    const handled = await handleConnectHandshake(fake.db.client, tenant(), inbound('923007777777'));
    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ to: '923007777777', type: 'text' });
    expect(String((calls[0]!.body!.text as { body: string }).body)).toContain('connected');
    expect(numberRow().status).toBe('connected');
    expect(numberRow().last_test_at).toBeTruthy();
    expect(fake.db.rows('whatsapp_connect_attempts')[0]!.status).toBe('connected');
    expect((await getConnectionStatus(fake.db.client, 'M1')).status).toBe('connected');
  });

  it('phones are compared as digits only', async () => {
    const t = { ...tenant(), merchant_phone: '+92 (300) 777-7777' };
    expect(await handleConnectHandshake(fake.db.client, t, inbound('923007777777'))).toBe(true);
  });

  it('a buyer’s message during connecting is not the handshake', async () => {
    expect(await handleConnectHandshake(fake.db.client, tenant(), inbound('923005555555'))).toBe(false);
    expect(calls).toHaveLength(0);
    expect(numberRow().status).toBe('connecting');
  });

  it('once connected, the merchant’s own messages go to the bot like anyone else’s', async () => {
    await handleConnectHandshake(fake.db.client, tenant(), inbound('923007777777'));
    expect(await handleConnectHandshake(fake.db.client, tenant(), inbound('923007777777'))).toBe(false);
  });

  it('payment method missing (131042) flags the number with the Meta Billing instruction', async () => {
    meta['/PN1/messages'] = () => graphErr(131042, 'Business eligibility payment issue');
    expect(await handleConnectHandshake(fake.db.client, tenant(), inbound('923007777777'))).toBe(true);
    const row = numberRow();
    expect(row.status).toBe('needs_attention');
    expect(row.flag_reason).toBe('policy');
    expect(row.attention_message).toContain('payment method');
    expect(fake.db.rows('whatsapp_connect_attempts')[0]!.error_code).toBe('131042');
  });

  it('an unknown send failure is needs_attention with a retry hint, and the row keeps its token', async () => {
    meta['/PN1/messages'] = () => graphErr(131000, 'Something went wrong', 500);
    await handleConnectHandshake(fake.db.client, tenant(), inbound('923007777777'));
    expect(numberRow().status).toBe('needs_attention');
    expect(numberRow().flag_reason).toBe('manual');
    expect(await tokenForNumber(fake.db.client, 'PN1')).toBe('biz-token-1'); // manual flag does not refuse
  });
});

describe('getConnectionStatus', () => {
  it('is none for a shop with no number, and carries the merchant phone for the page', async () => {
    const s = await getConnectionStatus(fake.db.client, 'M1');
    expect(s.status).toBe('none');
    expect(s.merchantPhone).toBe('+92 300 7777777');
  });

  it('marks the Meta test number so the page can warn about test recipients', async () => {
    cfg.META_DEFAULT_PHONE_NUMBER_ID = 'PN1';
    await connect({ code: 'CODE-1' });
    expect((await getConnectionStatus(fake.db.client, 'M1')).isTestNumber).toBe(true);
  });
});
