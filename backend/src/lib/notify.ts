// notify() — the one way to tell a merchant something (SRS P3, IC-3). Writes the portal row, then
// fans out to Web Push and email by each owner's/manager's preferences. Never WhatsApp (decided
// 2026-10-13: merchant alerts are push and email only). Failures never block the caller: the row
// is awaited, the channels run in the background with their errors logged.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationType } from '@app/shared';
import { loadConfig, portalOrigin } from '../config';
import { logger } from './logger';
import { isEmailConfigured, renderAlert, renderDigest, sendEmail } from './email';
import { isPushConfigured, sendPush, type PushPayload } from './push';

export type { NotificationType };
export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** merchant_users.id when the notification is for one person (unused by the fan-out so far). */
  userId?: string;
}
export interface Prefs { push: boolean; email: boolean }
export const DEFAULT_PREFS: Prefs = { push: true, email: true };

/** A member's preferences with the defaults filled in. */
export function prefsOf(raw: unknown): Prefs {
  const p = (raw ?? {}) as Partial<Record<keyof Prefs, unknown>>;
  return { push: p.push !== false, email: p.email !== false };
}

/** The portal page a notification leads to, relative to the portal origin. */
export function notificationUrl(n: { type: NotificationType; data?: Record<string, unknown> }): string {
  const d = n.data ?? {};
  if (typeof d.orderId === 'string') return `/orders/${d.orderId}`;
  if (typeof d.conversationId === 'string') return '/inbox';
  if (n.type === 'template_status' || d.action === 'reconnect_whatsapp' || typeof d.phoneNumberId === 'string') return '/settings/whatsapp';
  if (d.action === 'usage') return '/settings/messages';
  return '/notifications';
}

// ── The digest rule: more than DIGEST_AFTER emails in DIGEST_WINDOW_MS for one merchant → the rest
// wait and go out as ONE digest when the window closes. In-process state: one backend instance.
// Shutdown calls flushPendingDigests() so a deploy does not drop what is queued (review P3-7).
const DIGEST_WINDOW_MS = 5 * 60_000;
const DIGEST_AFTER = 5;
interface EmailState { sent: number[]; queued: { title: string; body: string; link: string }[]; timer: NodeJS.Timeout | null; to: string[] }
const emailState = new Map<string, EmailState>();
const inflight = new Set<Promise<void>>();

/** Writes the portal row and starts the fan-out. Resolves with the row id (null if the insert failed). */
export async function notify(db: SupabaseClient, merchantId: string, input: NotifyInput): Promise<string | null> {
  const { data, error } = await db
    .from('notifications')
    .insert({ merchant_id: merchantId, user_id: input.userId ?? null, type: input.type, title: input.title, body: input.body, data: input.data ?? {}, channel: 'portal' })
    .select('id')
    .single();
  if (error) logger.warn({ err: error.message, merchantId, type: input.type }, 'notification row failed');
  const id = (data?.id as string | undefined) ?? null;
  const p = fanOut(db, merchantId, input, id).catch((e: unknown) => logger.warn({ err: (e as Error).message, merchantId, type: input.type }, 'notification fan-out failed'));
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
  return id;
}

/** Wait for every background delivery started so far (tests, and shutdown). */
export async function flushNotifications(): Promise<void> {
  await Promise.all([...inflight]);
}

/** Send every queued digest now, without waiting for its window — called on SIGTERM before exit. */
export async function flushPendingDigests(): Promise<void> {
  const ids = [...emailState.keys()];
  for (const merchantId of ids) {
    const s = emailState.get(merchantId);
    if (s?.timer) { clearTimeout(s.timer); s.timer = null; }
  }
  await Promise.all(ids.map((id) => flushDigest(id)));
  await flushNotifications();
}

/** Tests only: drop the digest timers and counters. */
export function _resetNotifyState(): void {
  for (const s of emailState.values()) if (s.timer) clearTimeout(s.timer);
  emailState.clear();
}

interface MemberRow { id: string; email: string | null; role: string; notification_prefs: unknown }

async function fanOut(db: SupabaseClient, merchantId: string, input: NotifyInput, id: string | null): Promise<void> {
  const members = await db.from('merchant_users').select('id, email, role, notification_prefs').eq('merchant_id', merchantId).eq('is_active', true).in('role', ['owner', 'manager']);
  const rows = (members.data ?? []) as MemberRow[];
  if (!rows.length) return;
  const url = notificationUrl(input);
  const pushTo = rows.filter((m) => prefsOf(m.notification_prefs).push).map((m) => m.id);
  const emailTo = rows.filter((m) => prefsOf(m.notification_prefs).email && m.email).map((m) => m.email!);
  await Promise.all([
    pushTo.length ? pushMembers(db, pushTo, { id: id ?? undefined, title: input.title, body: input.body, url }) : Promise.resolve(),
    emailTo.length ? emailMembers(merchantId, emailTo, input.title, input.body, url) : Promise.resolve(),
  ]);
}

/** Every subscription of the members; a 404/410 from the push service deletes it (FR-P3.3). */
async function pushMembers(db: SupabaseClient, memberIds: string[], payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;
  const subs = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('member_id', memberIds);
  for (const s of (subs.data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    const r = await sendPush(s, payload);
    if (r === 'gone') await db.from('push_subscriptions').delete().eq('id', s.id);
    else if (r === 'ok') await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
  }
}

async function emailMembers(merchantId: string, to: string[], title: string, body: string, url: string): Promise<void> {
  if (!isEmailConfigured()) return;
  const cfg = loadConfig();
  const link = `${portalOrigin(cfg)}${url}`;
  const now = Date.now();
  const st = emailState.get(merchantId) ?? { sent: [], queued: [], timer: null, to };
  emailState.set(merchantId, st);
  st.sent = st.sent.filter((t) => now - t < DIGEST_WINDOW_MS);
  if (st.timer || st.sent.length >= DIGEST_AFTER) {
    st.queued.push({ title, body, link });
    st.to = to;
    if (!st.timer) {
      st.timer = setTimeout(() => { void flushDigest(merchantId); }, DIGEST_WINDOW_MS);
      st.timer.unref?.();
    }
    return;
  }
  st.sent.push(now);
  const r = renderAlert(title, body, link, cfg.PRODUCT_NAME);
  await sendEmail({ to, subject: title, text: r.text, html: r.html });
}

async function flushDigest(merchantId: string): Promise<void> {
  const st = emailState.get(merchantId);
  if (!st) return;
  st.timer = null;
  const items = st.queued.splice(0);
  st.sent = [Date.now()];
  if (!items.length) return;
  const r = renderDigest(items, loadConfig().PRODUCT_NAME);
  await sendEmail({ to: st.to, subject: r.subject, text: r.text, html: r.html });
}
