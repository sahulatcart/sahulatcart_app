import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifySignature } from './signature';

const secret = 'test_app_secret';
const body = Buffer.from(JSON.stringify({ hello: 'world' }));
const sign = (b: Buffer, s = secret) => 'sha256=' + crypto.createHmac('sha256', s).update(b).digest('hex');

describe('verifySignature (CD-44)', () => {
  it('accepts a valid signature', () => {
    expect(verifySignature(secret, body, sign(body))).toBe(true);
  });
  it('rejects a signature made with the wrong secret', () => {
    expect(verifySignature(secret, body, sign(body, 'wrong'))).toBe(false);
  });
  it('rejects a tampered body', () => {
    expect(verifySignature(secret, Buffer.from('{"hello":"mars"}'), sign(body))).toBe(false);
  });
  it('rejects a missing header', () => {
    expect(verifySignature(secret, body, undefined)).toBe(false);
  });
  it('rejects a malformed / wrong-length header', () => {
    expect(verifySignature(secret, body, 'sha256=deadbeef')).toBe(false);
    expect(verifySignature(secret, body, 'garbage')).toBe(false);
  });
});
