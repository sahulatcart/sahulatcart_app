// Web Push (P3): one call per subscription through the `web-push` package, VAPID keys from env.
// The service worker (admin/public/sw.js) shows the payload and opens `url` on click.
import webpush from 'web-push';
import { loadConfig } from '../config';
import { logger } from './logger';

export interface PushPayload { title: string; body: string; url: string }
export interface PushTarget { endpoint: string; p256dh: string; auth: string }

export function isPushConfigured(): boolean {
  const cfg = loadConfig();
  return !!cfg.VAPID_PUBLIC_KEY && !!cfg.VAPID_PRIVATE_KEY;
}

let vapidSet = false;
function ensureVapid(): void {
  if (vapidSet) return;
  const cfg = loadConfig();
  webpush.setVapidDetails(cfg.VAPID_SUBJECT, cfg.VAPID_PUBLIC_KEY!, cfg.VAPID_PRIVATE_KEY!);
  vapidSet = true;
}

/** 'gone' = the push service says the subscription no longer exists (404/410): delete it. */
export async function sendPush(target: PushTarget, payload: PushPayload): Promise<'ok' | 'gone' | 'failed'> {
  if (!isPushConfigured()) return 'failed';
  ensureVapid();
  try {
    await webpush.sendNotification({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, JSON.stringify(payload), { TTL: 60 * 60 });
    return 'ok';
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) return 'gone';
    logger.warn({ statusCode: code, err: (e as Error).message }, 'push send failed');
    return 'failed';
  }
}
