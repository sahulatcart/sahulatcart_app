'use client';
// Web Push on the client (P3): register the service worker, subscribe with the server's public
// VAPID key, and hand the subscription to the backend. Everything here is per device.
import { api } from './api';

export type PushState = 'unsupported' | 'ios_install' | 'denied' | 'subscribed' | 'available';

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent);
const standalone = () => (navigator as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() && !standalone() ? 'ios_install' : 'unsupported';
  }
  if (isIos() && !standalone()) return 'ios_install';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'subscribed' : 'available';
}

/** The VAPID public key as the ArrayBuffer `subscribe()` wants (it is URL-safe base64 on the wire). */
function vapidKeyBuffer(b64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buf;
}

/** Ask permission, subscribe this device, and register it with the backend. Throws with a readable message. */
export async function enablePush(): Promise<void> {
  const cfg = (await fetch('/api/v1/config').then((r) => r.json())) as { vapidPublicKey?: string | null };
  if (!cfg.vapidPublicKey) throw new Error('Push is not set up on the server yet.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed in the browser.');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBuffer(cfg.vapidPublicKey) });
  const j = sub.toJSON();
  const r = await api('/api/v1/admin/push-subscriptions', { method: 'POST', body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, userAgent: navigator.userAgent }) });
  if (!r.ok) { await sub.unsubscribe().catch(() => {}); throw new Error('Could not register this device.'); }
}

/** Unsubscribe this device and forget it on the backend. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await api('/api/v1/admin/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
}
