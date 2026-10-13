import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadConfig } from '../config';

/**
 * AES-256-GCM for secrets at rest (whatsapp_secrets). One key, TOKEN_ENCRYPTION_KEY (32 bytes, as
 * 64 hex characters or base64), versioned by keyId so a rotation can decrypt old rows while
 * writing new ones. Plaintext never reaches the database, the logs or a response.
 */
export const CURRENT_KEY_ID = 'k1';
const IV_BYTES = 12;

export interface Sealed {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
}

/** 32 bytes from either encoding: `openssl rand -hex 32` (64 hex chars) or `-base64 32` (44 chars). */
export function parseKey(raw: string): Buffer | null {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

/** The configured key. Throws (never exits) so a missing key fails the one call, not the process. */
export function encryptionKey(): Buffer {
  const raw = loadConfig().TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set');
  const key = parseKey(raw);
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)');
  return key;
}

export function encrypt(plain: string, key: Buffer = encryptionKey()): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyId: CURRENT_KEY_ID };
}

/** Throws on a wrong key or a tampered ciphertext/tag (GCM authenticates both). */
export function decrypt(sealed: Sealed, key: Buffer = encryptionKey()): string {
  if (sealed.keyId !== CURRENT_KEY_ID) throw new Error(`unknown encryption key id ${sealed.keyId}`);
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.iv);
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
}

// Postgres bytea through supabase-js: write as a `\x<hex>` string, read back the same way.
export const toBytea = (b: Buffer): string => `\\x${b.toString('hex')}`;
export function fromBytea(v: unknown): Buffer {
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v.startsWith('\\x') ? v.slice(2) : v, 'hex');
  throw new Error('bytea value is neither a Buffer nor a hex string');
}
