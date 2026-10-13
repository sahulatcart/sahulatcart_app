'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageCircle, Phone, RefreshCw, Send, Smartphone, Unplug } from 'lucide-react';
import AppShell, { BackLink, PageHead, Pill } from '../../../components/AppShell';
import { api, apiError, apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

/**
 * Connect WhatsApp (SRS-Fazal M2). Meta's Embedded Signup popup returns a single-use code and, by
 * a window message, the ids the merchant picked; the browser forwards only those to the backend,
 * which verifies them against the token. Connection is proven by the merchant texting their own
 * shop number (the handshake), which this page waits for by polling.
 */

interface Config { metaAppId: string | null; embeddedSignupConfigId: string | null; graphVersion: string }
interface Status {
  status: 'none' | 'connecting' | 'connected' | 'needs_attention' | 'disconnected';
  phoneNumberId?: string; displayPhone?: string; displayName?: string | null;
  qualityRating?: string; messagingTier?: string; verifiedNameStatus?: string | null;
  flagReason?: string | null; message?: string | null; lastTestAt?: string | null;
  awaitingHandshake?: boolean; pinRequired?: boolean; isTestNumber?: boolean; merchantPhone?: string | null;
  templates?: { name: string; status: string; rejectionReason: string | null }[];
}
interface NumberChoice { id: string; displayPhone: string; verifiedName: string | null }

declare global {
  interface Window {
    FB?: { init: (o: object) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: object) => void };
    fbAsyncInit?: () => void;
  }
}

const FB_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);
const TIER: Record<string, string> = { unverified: 'Up to 250 customers a day (business not verified)', tier_1: 'Up to 1,000 customers a day', tier_2: 'Up to 10,000 customers a day', tier_3: 'Up to 100,000 customers a day', tier_4: 'Unlimited' };
const pretty = (digits?: string) => (digits ? `+${digits}` : '—');

function loadFbSdk(appId: string, version: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) return resolve();
    window.fbAsyncInit = () => { window.FB!.init({ appId, version, xfbml: false, autoLogAppEvents: false }); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    document.body.appendChild(s);
  });
}

export default function WhatsAppPage() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choices, setChoices] = useState<NumberChoice[] | null>(null);
  const [pin, setPin] = useState('');
  const hints = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  const lastCode = useRef<string | null>(null);

  const load = useCallback(() => apiJson<Status>('/api/v1/admin/whatsapp').then(setSt).catch(() => {}), []);
  useEffect(() => {
    apiJson<Config>('/api/v1/config').then(setCfg).catch(() => setCfg({ metaAppId: null, embeddedSignupConfigId: null, graphVersion: 'v21.0' }));
    load();
  }, [load]);

  // The handshake: while `connecting`, poll until the merchant's text has been answered.
  useEffect(() => {
    if (st?.status !== 'connecting') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [st?.status, load]);

  // Meta's popup posts the chosen ids to the opener; keep them as hints only.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!FB_ORIGINS.has(ev.origin)) return;
      try {
        const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.event === 'FINISH') hints.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        if (data.event === 'CANCEL') setBusy(null);
      } catch { /* not our message */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  async function postConnect(code: string, phoneNumberId?: string) {
    setBusy('Connecting your number…');
    const r = await api('/api/v1/admin/whatsapp/connect', { method: 'POST', body: JSON.stringify({ code, hints: hints.current, phoneNumberId }) });
    if (r.status === 409) {
      const j = (await r.json().catch(() => null)) as { error?: { code?: string; numbers?: NumberChoice[]; message?: string } } | null;
      if (j?.error?.code === 'choose_number' && j.error.numbers?.length) { setChoices(j.error.numbers); setBusy(null); return; }
      toast(j?.error?.message ?? 'Could not connect', 'error'); setBusy(null); return;
    }
    if (!r.ok) { toast(await apiError(r), 'error'); setBusy(null); return; }
    setSt((await r.json()) as Status);
    setChoices(null);
    setBusy(null);
  }

  async function connect() {
    if (!cfg?.metaAppId || !cfg.embeddedSignupConfigId) { toast('Meta app is not configured yet (META_APP_ID / META_EMBEDDED_SIGNUP_CONFIG_ID)', 'error'); return; }
    setBusy('Opening Meta…');
    hints.current = {};
    await loadFbSdk(cfg.metaAppId, cfg.graphVersion);
    window.FB!.login(
      (res) => {
        const code = res.authResponse?.code;
        if (!code) { setBusy(null); return; }
        lastCode.current = code;
        void postConnect(code);
      },
      { config_id: cfg.embeddedSignupConfigId, response_type: 'code', override_default_response_type: true, extras: { sessionInfoVersion: '3', setup: {} } }
    );
  }

  async function sendTest() {
    setBusy('Sending…');
    const r = await api('/api/v1/admin/whatsapp/test', { method: 'POST' });
    if (!r.ok) toast(await apiError(r), 'error');
    else {
      const s = (await r.json()) as Status;
      setSt(s);
      toast(s.status === 'connected' ? 'Test message sent to your phone' : s.status === 'connecting' ? 'Your 24-hour window has closed — text your shop number again' : s.message ?? 'Could not send', s.status === 'connected' ? 'success' : 'info');
    }
    setBusy(null);
  }

  async function disconnect() {
    if (!window.confirm('Disconnect this number? The bot will stop replying to customers until you reconnect. Your WhatsApp account and number stay yours.')) return;
    setBusy('Disconnecting…');
    const r = await api('/api/v1/admin/whatsapp/disconnect', { method: 'POST' });
    if (!r.ok) toast(await apiError(r), 'error'); else { setSt((await r.json()) as Status); toast('Disconnected. The bot is off.', 'info'); }
    setBusy(null);
  }

  async function resubmit(kind: string) {
    setBusy('Resubmitting…');
    const r = await api(`/api/v1/admin/whatsapp/templates/${kind}/resubmit`, { method: 'POST' });
    if (!r.ok) toast(await apiError(r), 'error'); else { toast('Template resubmitted to Meta', 'success'); load(); }
    setBusy(null);
  }

  async function retry() {
    setBusy('Retrying…');
    const r = await api('/api/v1/admin/whatsapp/retry', { method: 'POST', body: JSON.stringify(pin ? { pin } : {}) });
    if (!r.ok) toast(await apiError(r), 'error'); else { setSt((await r.json()) as Status); setPin(''); }
    setBusy(null);
  }

  const head = <PageHead title="WhatsApp" sub="Connect the number the bot answers from" />;
  if (!st) return <AppShell><BackLink href="/settings" label="Settings" />{head}<div className="card pad"><div className="skeleton" style={{ height: 120 }} /></div></AppShell>;

  return (
    <AppShell>
      <BackLink href="/settings" label="Settings" />
      {head}

      {choices && (
        <div className="card pad" style={{ marginBottom: 16 }}>
          <h2>Which number should the bot use?</h2>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {choices.map((n) => (
              <button key={n.id} className="btn ghost" disabled={!!busy} onClick={() => lastCode.current && postConnect(lastCode.current, n.id)}>
                <Phone aria-hidden /> {pretty(n.displayPhone.replace(/\D/g, ''))} {n.verifiedName ? `· ${n.verifiedName}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {(st.status === 'none' || st.status === 'disconnected') && (
        <div className="card pad">
          <h2>Connect your WhatsApp Business number</h2>
          <p className="hint" style={{ marginTop: 6 }}>You will log in to Facebook in Meta&rsquo;s window, choose or create your WhatsApp Business account, and pick the number. It takes about two minutes.</p>
          <ul className="hint" style={{ margin: '10px 0 0 18px', display: 'grid', gap: 4 }}>
            <li>A Facebook login that manages your business.</li>
            <li>A phone number that is <strong>not</strong> already used in the WhatsApp app (or a new SIM).</li>
            <li>A payment method added to your WhatsApp Business account in Meta Business Manager, or Meta will not deliver messages.</li>
            <li>The display name must be your real shop name; Meta rejects made-up or generic names.</li>
          </ul>
          {st.status === 'disconnected' && <div className="callout" style={{ marginTop: 12 }}><div className="ico"><AlertTriangle aria-hidden /></div><div>This number was disconnected. The bot is off until you reconnect.</div></div>}
          <div className="card-foot" style={{ marginTop: 14 }}>
            <button className="btn" onClick={connect} disabled={!!busy}><MessageCircle aria-hidden /> {busy ?? 'Connect WhatsApp'}</button>
          </div>
        </div>
      )}

      {st.status === 'connecting' && (
        <div className="card pad">
          <h2>One last step: send a message from your phone</h2>
          <p style={{ marginTop: 6 }}>From <strong>{st.merchantPhone ? pretty(st.merchantPhone.replace(/\D/g, '')) : 'the phone saved in your shop profile'}</strong>, send any message (for example &ldquo;hi&rdquo;) to your shop number:</p>
          <div className="mono" style={{ fontSize: 24, margin: '12px 0', fontWeight: 500 }}>{pretty(st.displayPhone)}</div>
          {st.displayPhone && <a className="btn ghost" href={`https://wa.me/${st.displayPhone}?text=hi`} target="_blank" rel="noreferrer"><Smartphone aria-hidden /> Open WhatsApp</a>}
          <p className="hint" style={{ marginTop: 12 }}>When our reply arrives on your phone, this page will show the number as connected. This proves messages reach us and that we can answer from your number.</p>
          {st.isTestNumber && <div className="callout" style={{ marginTop: 12 }}><div className="ico"><AlertTriangle aria-hidden /></div><div>This is Meta&rsquo;s test number. Your phone must be one of its five test recipients (Meta dashboard → WhatsApp → API Setup), or Meta refuses the reply.</div></div>}
          <div className="hint" style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}><RefreshCw size={14} aria-hidden /> Waiting for your message…</div>
        </div>
      )}

      {st.status === 'needs_attention' && (
        <div className="card pad">
          <h2>Your number needs attention</h2>
          <div className="callout" style={{ marginTop: 10 }}><div className="ico"><AlertTriangle aria-hidden /></div><div>{st.message ?? 'Something went wrong while connecting.'}</div></div>
          {st.pinRequired && (
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="pin">Two-step verification PIN (6 digits)</label>
              <input id="pin" className="mono" inputMode="numeric" pattern="\\d{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <div className="help">The PIN you set for this number in WhatsApp. It is stored encrypted and never shown again.</div>
            </div>
          )}
          <div className="card-foot" style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={retry} disabled={!!busy || (st.pinRequired && pin.length !== 6)}><RefreshCw aria-hidden /> {busy ?? 'Retry'}</button>
            <button className="btn ghost" onClick={connect} disabled={!!busy}><MessageCircle aria-hidden /> Reconnect</button>
          </div>
        </div>
      )}

      {st.status === 'connected' && (
        <div className="card pad">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <CheckCircle2 aria-hidden style={{ color: 'var(--success)' }} />
            <h2 style={{ margin: 0 }}>{pretty(st.displayPhone)}</h2>
            <Pill kind="success">Connected</Pill>
          </div>
          <dl className="hint" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', marginTop: 14 }}>
            <dt>Display name</dt><dd>{st.displayName ?? '—'} {st.verifiedNameStatus && st.verifiedNameStatus !== 'APPROVED' && <Pill kind="warning">{st.verifiedNameStatus.toLowerCase().replace(/_/g, ' ')}</Pill>}</dd>
            <dt>Quality</dt><dd><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 6, background: st.qualityRating === 'green' ? 'var(--success)' : st.qualityRating === 'yellow' ? 'var(--warning)' : st.qualityRating === 'red' ? 'var(--danger)' : 'var(--muted)' }} />{st.qualityRating ?? 'unknown'}</dd>
            <dt>Limit</dt><dd>{TIER[st.messagingTier ?? 'unverified'] ?? st.messagingTier}</dd>
            <dt>Last checked</dt><dd>{dt(st.lastTestAt)}</dd>
          </dl>
          <h3 style={{ marginTop: 18 }}>Pre-approved messages</h3>
          <p className="hint">Used only when a buyer&rsquo;s 24-hour window has closed and you press the paid button on an order. Meta reviews each one.</p>
          {(st.templates ?? []).length === 0 && <div className="hint">Being created&hellip; they appear here within a minute of connecting.</div>}
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {(st.templates ?? []).map((t) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono">{t.name}</span>
                <Pill kind={t.status === 'approved' ? 'success' : t.status === 'rejected' || t.status === 'disabled' ? 'danger' : 'warning'}>{t.status}</Pill>
                {t.rejectionReason && <span className="hint">{t.rejectionReason}</span>}
                {(t.status === 'rejected' || t.status === 'disabled') && <button className="btn sm ghost" disabled={!!busy} onClick={() => resubmit(t.name.replace(/_v\d+$/, ''))}>Resubmit</button>}
              </div>
            ))}
          </div>
          <div className="card-foot" style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost" onClick={sendTest} disabled={!!busy}><Send aria-hidden /> {busy ?? 'Send test message'}</button>
            <button className="btn ghost" onClick={connect} disabled={!!busy}><MessageCircle aria-hidden /> Reconnect</button>
            <button className="btn danger-ghost" onClick={disconnect} disabled={!!busy}><Unplug aria-hidden /> Disconnect</button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
