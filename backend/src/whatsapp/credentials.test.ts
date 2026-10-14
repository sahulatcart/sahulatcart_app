import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { loadConfig } from '../config';
import { encrypt, toBytea } from '../lib/crypto';
import { forgetAllNumbers, forgetNumber, lookupToken, markTokenInvalid, storeToken, tokenForNumber } from './credentials';

const cfg = loadConfig();
let db: FakeDb;

function number(phoneNumberId: string, patch: Record<string, unknown> = {}) {
  return db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: phoneNumberId, status: 'connected', flag_reason: null, access_token_ref: null, ...patch });
}

beforeEach(() => {
  db = new FakeDb();
  forgetAllNumbers();
  cfg.META_DEFAULT_PHONE_NUMBER_ID = 'PN-DEFAULT';
  cfg.META_SYSTEM_USER_TOKEN = 'env-token';
});

describe('tokenForNumber', () => {
  it('decrypts the stored token for a connected number', async () => {
    const id = await storeToken(db.client, 'M1', 'merchant-token');
    number('PN1', { access_token_ref: id });
    expect(await tokenForNumber(db.client, 'PN1')).toBe('merchant-token');
    const secret = db.rows('whatsapp_secrets')[0]!;
    expect(String(secret.ciphertext)).not.toContain('merchant-token');
    expect(String(secret.ciphertext)).toMatch(/^\\x[0-9a-f]+$/);
  });

  it('uses the env token only for the default pilot number', async () => {
    number('PN-DEFAULT');
    number('PN2');
    expect(await tokenForNumber(db.client, 'PN-DEFAULT')).toBe('env-token');
    expect(await lookupToken(db.client, 'PN2')).toEqual({ token: null, reason: 'no_credentials' });
  });

  it('refuses an unknown number, even with an env token', async () => {
    expect(await lookupToken(db.client, 'PN-UNKNOWN')).toEqual({ token: null, reason: 'no_number' });
  });

  it('refuses a disconnected number and a token-flagged one', async () => {
    const id = await storeToken(db.client, 'M1', 't');
    number('PN-OFF', { status: 'disconnected', access_token_ref: id });
    number('PN-BAD', { status: 'needs_attention', flag_reason: 'token', access_token_ref: id });
    number('PN-QUALITY', { status: 'needs_attention', flag_reason: 'quality', access_token_ref: id });
    expect(await lookupToken(db.client, 'PN-OFF')).toEqual({ token: null, reason: 'disconnected' });
    expect(await lookupToken(db.client, 'PN-BAD')).toEqual({ token: null, reason: 'token_invalid' });
    expect(await tokenForNumber(db.client, 'PN-QUALITY')).toBe('t'); // a quality flag does not block sending
  });

  it('caches the lookup until forgetNumber()', async () => {
    const id = await storeToken(db.client, 'M1', 'first');
    const row = number('PN1', { access_token_ref: id });
    expect(await tokenForNumber(db.client, 'PN1')).toBe('first');
    row.status = 'disconnected';
    expect(await tokenForNumber(db.client, 'PN1')).toBe('first'); // still cached
    forgetNumber('PN1');
    expect(await tokenForNumber(db.client, 'PN1')).toBeNull();
  });

  it('reports a decrypt failure instead of sending garbage', async () => {
    const sealed = encrypt('t');
    const secret = db.add('whatsapp_secrets', { merchant_id: 'M1', kind: 'access_token', ciphertext: toBytea(sealed.ciphertext), iv: toBytea(sealed.iv), auth_tag: toBytea(Buffer.alloc(16, 7)), key_id: sealed.keyId });
    number('PN1', { access_token_ref: secret.id });
    expect(await lookupToken(db.client, 'PN1')).toEqual({ token: null, reason: 'decrypt_failed' });
  });
});

describe('markTokenInvalid', () => {
  it('flags the number, drops the cache and tells the merchant once', async () => {
    const id = await storeToken(db.client, 'M1', 'dead');
    number('PN1', { access_token_ref: id });
    expect(await tokenForNumber(db.client, 'PN1')).toBe('dead');
    await markTokenInvalid(db.client, 'PN1');
    const row = db.rows('whatsapp_numbers')[0]!;
    expect(row.status).toBe('needs_attention');
    expect(row.flag_reason).toBe('token');
    expect(row.attention_message).toContain('Reconnect');
    expect(await lookupToken(db.client, 'PN1')).toEqual({ token: null, reason: 'token_invalid' });
    const notes = db.rows('notifications');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type).toBe('system');
    expect(notes[0]!.merchant_id).toBe('M1');
    // U2: the founders hear about a dead token too.
    expect(db.rows('platform_notifications')).toHaveLength(1);
    expect(db.rows('platform_notifications')[0]).toMatchObject({ kind: 'whatsapp_attention', merchant_id: 'M1', data: { phoneNumberId: 'PN1', reason: 'token' } });
  });

  it('does nothing for an unknown number', async () => {
    await markTokenInvalid(db.client, 'PN-NONE');
    expect(db.rows('notifications')).toHaveLength(0);
  });
});

describe('storeToken', () => {
  it('stores a pin as its own kind', async () => {
    await storeToken(db.client, 'M1', '123456', 'pin');
    expect(db.rows('whatsapp_secrets')[0]!.kind).toBe('pin');
  });

  it('surfaces an insert failure', async () => {
    const broken = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) };
    await expect(storeToken(broken as never, 'M1', 't')).rejects.toThrow(/boom/);
    vi.restoreAllMocks();
  });
});
