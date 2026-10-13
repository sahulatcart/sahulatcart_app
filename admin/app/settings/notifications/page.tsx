'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Mail, Send, Smartphone } from 'lucide-react';
import AppShell, { BackLink, PageHead, Pill } from '../../../components/AppShell';
import { api, apiError, apiJson } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { disablePush, enablePush, pushState, type PushState } from '../../../lib/push';

interface PrefsRes { prefs: { push: boolean; email: boolean }; email: string | null; pushSubscriptions: number; channels: { push: boolean; email: boolean } }

/** Settings → Notifications (P3, FR-P3.6): per-channel switches, this device's push state, and a test per channel. */
export default function NotificationSettings() {
  const toast = useToast();
  const [p, setP] = useState<PrefsRes | null>(null);
  const [device, setDevice] = useState<PushState>('unsupported');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, st] = await Promise.all([apiJson<PrefsRes>('/api/v1/admin/notification-prefs'), pushState()]);
    setP(res);
    setDevice(st);
  }, []);
  useEffect(() => { load().catch(() => toast('Could not load your alert settings', 'error')); }, [load, toast]);

  async function setPref(k: 'push' | 'email', v: boolean) {
    if (!p) return;
    setP({ ...p, prefs: { ...p.prefs, [k]: v } });
    const r = await api('/api/v1/admin/notification-prefs', { method: 'PATCH', body: JSON.stringify({ [k]: v }) });
    if (!r.ok) { toast(await apiError(r), 'error'); load(); } else toast(v ? `${k === 'push' ? 'Phone' : 'Email'} alerts on` : `${k === 'push' ? 'Phone' : 'Email'} alerts off`, 'success');
  }
  async function togglePush() {
    setBusy('push');
    try {
      if (device === 'subscribed') { await disablePush(); toast('This device will not get alerts', 'info'); }
      else { await enablePush(); toast('This device will get alerts', 'success'); }
      await load();
    } catch (e) { toast((e as Error).message, 'error'); setDevice(await pushState()); }
    finally { setBusy(null); }
  }
  async function test(channel: 'push' | 'email') {
    setBusy(channel);
    try {
      const r = await api('/api/v1/admin/notifications/test', { method: 'POST', body: JSON.stringify({ channel }) });
      if (!r.ok) return toast(await apiError(r), 'error');
      const j = (await r.json()) as { sent: number };
      toast(j.sent ? (channel === 'push' ? `Sent to ${j.sent} device${j.sent === 1 ? '' : 's'}` : 'Test email sent') : 'Nothing to send to yet', j.sent ? 'success' : 'info');
    } catch { toast('Could not send the test', 'error'); }
    finally { setBusy(null); }
  }

  const head = <PageHead title="Notifications" sub="How you hear about new orders, payment screenshots and chats handed to you" />;
  if (!p) return <AppShell><BackLink href="/settings" label="Settings" />{head}<div className="card pad"><div className="skeleton" style={{ height: 120 }} /></div></AppShell>;

  return (
    <AppShell>
      <BackLink href="/settings" label="Settings" />
      {head}

      <div className="card">
        <div className="card-head" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="setting-row" style={{ width: '100%' }}>
            <div>
              <div className="t">Phone notifications {!p.channels.push && <Pill kind="neutral">Not set up on the server</Pill>}</div>
              <div className="d">A notification on this phone or computer, even when the portal is closed.</div>
            </div>
            <label className="switch"><input type="checkbox" aria-label="Phone notifications" checked={p.prefs.push} disabled={!p.channels.push} onChange={(e) => setPref('push', e.target.checked)} /><span className="track" /></label>
          </div>
        </div>
        <div className="card-head" style={{ borderBottom: 0 }}>
          <div className="setting-row" style={{ width: '100%' }}>
            <div>
              <div className="t">Email {!p.channels.email && <Pill kind="neutral">Not set up on the server</Pill>}</div>
              <div className="d">To <span className="mono">{p.email ?? '—'}</span>, the address you signed in with. More than five in five minutes arrive as one digest.</div>
            </div>
            <label className="switch"><input type="checkbox" aria-label="Email alerts" checked={p.prefs.email} disabled={!p.channels.email} onChange={(e) => setPref('email', e.target.checked)} /><span className="track" /></label>
          </div>
        </div>
      </div>

      <div className="card pad">
        <h2>This device</h2>
        {device === 'ios_install' && (
          <p className="hint" style={{ marginBottom: 12 }}><Smartphone aria-hidden size={16} style={{ verticalAlign: -3 }} /> On iPhone, add the portal to your Home Screen first (Share → Add to Home Screen, iOS 16.4 or later), then open it from there and come back here. Older iPhones get email only.</p>
        )}
        {device === 'unsupported' && <p className="hint" style={{ marginBottom: 12 }}>This browser cannot show push notifications. Email alerts still work.</p>}
        {device === 'denied' && <p className="hint" style={{ marginBottom: 12 }}>Notifications are blocked for this site in the browser. Allow them in the site settings, then try again.</p>}
        {device === 'subscribed' && <p className="hint" style={{ marginBottom: 12 }}><Pill kind="success">On</Pill> This device gets alerts. {p.pushSubscriptions > 1 ? `${p.pushSubscriptions} devices in total.` : ''}</p>}
        {device === 'available' && <p className="hint" style={{ marginBottom: 12 }}>Turn on alerts for this device; the browser will ask for permission once.</p>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(device === 'available' || device === 'subscribed') && (
            <button className={device === 'subscribed' ? 'btn ghost' : 'btn'} onClick={togglePush} disabled={busy === 'push' || !p.channels.push}>
              {busy === 'push' ? <Loader2 className="spin" aria-hidden /> : device === 'subscribed' ? <BellOff aria-hidden /> : <Bell aria-hidden />}
              {device === 'subscribed' ? 'Turn off on this device' : 'Turn on phone notifications'}
            </button>
          )}
          <button className="btn ghost" onClick={() => test('push')} disabled={busy === 'push' || !p.channels.push || p.pushSubscriptions === 0}><Send aria-hidden /> Send me a test push</button>
          <button className="btn ghost" onClick={() => test('email')} disabled={busy === 'email' || !p.channels.email || !p.email}><Mail aria-hidden /> Send me a test email</button>
        </div>
      </div>
    </AppShell>
  );
}
