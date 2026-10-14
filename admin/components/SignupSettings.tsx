'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Lock, Save, Unlock, UserCheck } from 'lucide-react';
import { api, apiError, apiJson } from '../lib/api';
import { useToast } from './Toast';
import Dialog from './Dialog';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';

/**
 * U3: who may open a shop, stored in platform_settings (the Railway variables were removed on
 * 2026-10-14; without a saved value the server falls back to closed and empty). Reworked after the
 * console critique: the state is said in words, and opening sign-up asks first, because from then
 * on anyone can create a shop.
 */

interface Gate { open: boolean; allowlist: string[]; source: { open: 'db' | 'env'; allowlist: 'db' | 'env' } }

export default function SignupSettings() {
  const toast = useToast();
  const [g, setG] = useState<Gate | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const load = useCallback(() => apiJson<Gate>('/api/v1/platform/signup').then((r) => { setG(r); setOpen(r.open); setList(r.allowlist.join('\n')); }).catch((e) => toast((e as Error).message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  const emails = list.split('\n').map((s) => s.trim()).filter(Boolean);
  const dirty = !!g && (open !== g.open || emails.join('\n') !== g.allowlist.join('\n'));

  async function persist() {
    setBusy(true);
    const r = await api('/api/v1/platform/signup', { method: 'PUT', body: JSON.stringify({ open, allowlist: emails }) });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    toast(open ? 'Sign-up is open to everyone' : 'Sign-up settings saved', 'success');
    load();
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    if (open && !g?.open) return setConfirming(true); // opening sign-up is the one change that needs a second look
    void persist();
  }

  return (
    <div className="card pad" style={{ marginTop: 24 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><UserCheck aria-hidden /> Sign-up</h2>
      {!g ? <div className="skeleton" style={{ height: 80, marginTop: 10 }} /> : (
        <form onSubmit={save}>
          <div className={`status-strip ${g.open ? 'warning' : ''}`} style={{ margin: '12px 0 16px' }}>
            <span className="selling">
              {g.open ? <Unlock aria-hidden /> : <Lock aria-hidden />}
              <span><span className="t">{g.open ? 'Sign-up is open' : 'Sign-up is closed (private pilot)'}</span>
                <span className="r" style={{ display: 'block' }}>{g.open ? 'Anyone can create a shop.' : `Only the ${g.allowlist.length} email${g.allowlist.length === 1 ? '' : 's'} below, and platform admins, can create a shop. Everyone else is told it is a private pilot.`}</span></span>
            </span>
            {g.source.open === 'env' && <span className="hint">Not saved here yet: the server default (closed) applies.</span>}
          </div>
          <div className="setting-row" style={{ marginBottom: 16 }}>
            <div><div className="t" style={{ fontSize: 14 }}>Let anyone sign up</div><div className="d">Turn on for launch day. Saving asks you to confirm.</div></div>
            <label className="switch"><span className="sr-only">Let anyone sign up</span><input type="checkbox" role="switch" checked={open} onChange={(e) => setOpen(e.target.checked)} aria-checked={open} /><span className="track" aria-hidden /></label>
          </div>
          <div className="field">
            <label htmlFor="allowlist">Allowed emails while sign-up is closed, one per line</label>
            <textarea id="allowlist" rows={6} value={list} onChange={(e) => setList(e.target.value)} placeholder="owner@shop.pk" className="mono" />
            <div className="help">{emails.length} email{emails.length === 1 ? '' : 's'}. Platform admins are always allowed and need not be listed.</div>
          </div>
          <button className="btn" disabled={busy || !dirty}><Save aria-hidden /> {busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</button>
        </form>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)} busy={busy} title="Open sign-up to everyone?"
        actions={<button type="button" className="btn" onClick={() => void persist()} disabled={busy}><Unlock aria-hidden /> {busy ? 'Opening…' : 'Open sign-up'}</button>}>
        <p>From now on anyone with an email can create a shop and get the free pilot. Their bots’ AI replies run on {PRODUCT_NAME}’s account.</p>
        <div className="form-error" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>Only do this once Meta has approved the app (launch day). You can close it again here at any time.</span></div>
      </Dialog>
    </div>
  );
}
