import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CURRENT_KEY_ID, decrypt, encrypt, encryptionKey, fromBytea, parseKey, toBytea } from './crypto';

describe('token encryption', () => {
  it('round-trips with the configured key', () => {
    const sealed = encrypt('EAAG-very-secret-token');
    expect(sealed.keyId).toBe(CURRENT_KEY_ID);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('secret');
    expect(decrypt(sealed)).toBe('EAAG-very-secret-token');
  });

  it('two encryptions of the same token differ (random IV)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('fails with the wrong key', () => {
    const sealed = encrypt('token');
    expect(() => decrypt(sealed, randomBytes(32))).toThrow();
  });

  it('fails when the ciphertext or the tag is tampered with', () => {
    const sealed = encrypt('token');
    const flipped = Buffer.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    expect(() => decrypt({ ...sealed, ciphertext: flipped })).toThrow();
    const badTag = Buffer.from(sealed.authTag);
    badTag[0] = (badTag[0] ?? 0) ^ 0xff;
    expect(() => decrypt({ ...sealed, authTag: badTag })).toThrow();
  });

  it('refuses an unknown key id', () => {
    expect(() => decrypt({ ...encrypt('t'), keyId: 'k0' })).toThrow(/key id/);
  });

  it('requires a 32-byte key, in hex or base64', () => {
    expect(encryptionKey()).toHaveLength(32);
    expect(parseKey('ab'.repeat(32))).toHaveLength(32);                       // openssl rand -hex 32
    expect(parseKey(Buffer.alloc(32, 9).toString('base64'))).toHaveLength(32); // openssl rand -base64 32
    expect(parseKey('too-short')).toBeNull();
    expect(parseKey('ab'.repeat(24))).toBeNull();
  });

  it('converts to and from Postgres bytea hex', () => {
    const b = Buffer.from([0, 1, 254, 255]);
    expect(toBytea(b)).toBe('\\x0001feff');
    expect(fromBytea('\\x0001feff').equals(b)).toBe(true);
    expect(fromBytea(b)).toBe(b);
    expect(() => fromBytea(42)).toThrow();
  });
});
