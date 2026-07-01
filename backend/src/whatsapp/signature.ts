import crypto from 'node:crypto';

/**
 * Verify Meta's X-Hub-Signature-256 over the RAW request body (docs/spec/04 §2.4, CD-44).
 * Hardened: reject missing/malformed, length-check before timingSafeEqual.
 */
export function verifySignature(appSecret: string, rawBody: Buffer, signatureHeader?: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // length mismatch → reject (timingSafeEqual throws otherwise)
  return crypto.timingSafeEqual(a, b);
}
