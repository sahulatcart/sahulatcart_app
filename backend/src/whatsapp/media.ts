import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config';
import { logger } from '../lib/logger';

/** Download an inbound WhatsApp media object (docs/spec/04 §3.2): media id → URL → bytes. */
export async function downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const cfg = loadConfig();
  if (!cfg.META_SYSTEM_USER_TOKEN) return null;
  const v = cfg.META_GRAPH_API_VERSION;
  const auth = { Authorization: `Bearer ${cfg.META_SYSTEM_USER_TOKEN}` };
  try {
    const meta = (await fetch(`https://graph.facebook.com/${v}/${mediaId}`, { headers: auth }).then((r) => r.json())) as {
      url?: string;
      mime_type?: string;
    };
    if (!meta.url) return null;
    const res = await fetch(meta.url, { headers: auth }); // media URL also needs the token
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: meta.mime_type ?? 'image/jpeg' };
  } catch (e) {
    logger.error({ err: (e as Error).message, mediaId }, 'media download failed');
    return null;
  }
}

/** Upload a payment screenshot to the private bucket. Returns the storage key (path). */
export async function uploadScreenshot(
  db: SupabaseClient,
  merchantId: string,
  orderId: string,
  buffer: Buffer,
  mimeType: string
): Promise<string | null> {
  const cfg = loadConfig();
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const key = `${merchantId}/${orderId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage
    .from(cfg.STORAGE_BUCKET_PAYMENT_SCREENSHOTS)
    .upload(key, buffer, { contentType: mimeType, upsert: false });
  if (error) {
    logger.error({ err: error.message }, 'screenshot upload failed');
    return null;
  }
  return key;
}

/** Mint a short-lived signed URL for a stored screenshot (on-demand, CD-40). */
export async function signedScreenshotUrl(db: SupabaseClient, key: string, expiresSec = 300): Promise<string | null> {
  const cfg = loadConfig();
  const { data } = await db.storage.from(cfg.STORAGE_BUCKET_PAYMENT_SCREENSHOTS).createSignedUrl(key, expiresSec);
  return data?.signedUrl ?? null;
}
