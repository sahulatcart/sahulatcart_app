'use client';
import { useCallback, useEffect, useState } from 'react';
import { Save, UserCheck } from 'lucide-react';
import { api, apiError, apiJson } from '../lib/api';
import { useToast } from './Toast';

/** U3: who may open a shop. Stored in platform_settings; the Railway env vars are only the fallback until this is saved once. */

interface Gate { open: boolean; allowlist: string[]; source: { open: 'db' | 'env'; allowlist: 'db' | 'env' } }
const from = (s: 'db' | 'env') => (s === 'db' ? 'from this panel' : 'still from Railway (not saved here yet)');

export default function SignupSettings() {
  const toast = useToast();
  const [g, setG] = useState<Gate | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => apiJson<Gate>('/api/v1/platform/signup').then((r) => { setG(r); setOpen(r.open); setList(r.allowlist.join('\n')); }).catch((e) => toast((e as Error).message, 'error')), [toast]);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const allowlist = list.split('\n').map((s) => s.trim()).filter(Boolean);
    const r = await api('/api/v1/platform/signup', { method: 'PUT', body: JSON.stringify({ open, allowlist }) });
    setBusy(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    toast('Sign-up settings saved', 'success');
    load();
  }

  return (
    <div className="card pad" style={{ marginTop: 24 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><UserCheck aria-hidden /> Sign-up</h2>
      <p className="hint" style={{ marginTop: 6 }}>While sign-up is closed, only the emails below (and every platform admin) can open a shop. The sign-up page tells everyone else it is a private pilot.</p>
      {!g ? <div className="skeleton" style={{ height: 80 }} /> : (
        <form onSubmit={save}>
          <div className="field">
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Anyone may sign up</span>
            </label>
            <div className="help">Currently {from(g.source.open)}.</div>
          </div>
          <div className="field">
            <label htmlFor="allowlist">Allowed emails, one per line</label>
            <textarea id="allowlist" rows={6} value={list} onChange={(e) => setList(e.target.value)} placeholder="owner@shop.pk" className="mono" />
            <div className="help">Currently {from(g.source.allowlist)}. Platform admins are always allowed and need not be listed.</div>
          </div>
          <button className="btn" disabled={busy}><Save aria-hidden /> Save</button>
        </form>
      )}
    </div>
  );
}
