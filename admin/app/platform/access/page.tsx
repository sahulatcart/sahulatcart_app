'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../../components/AppShell';
import SignupSettings from '../../../components/SignupSettings';
import Dialog from '../../../components/Dialog';
import { api, apiError, apiJson } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { day } from '../../../components/ConsoleParts';

/** Who may open the console (F2): platform admins invited by email, bound to their login at the first confirmed sign-in. */

interface Admin { id: string; name: string | null; email: string; is_active: boolean; auth_user_id: string | null; created_at: string }

function State({ a }: { a: Admin }) {
  if (!a.is_active) return <Pill kind="neutral">Removed</Pill>;
  return a.auth_user_id ? <Pill kind="success">Signed in</Pill> : <Pill kind="info">Invited</Pill>;
}

export default function PlatformAccess() {
  const toast = useToast();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Admin | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => apiJson<{ admins: Admin[] }>('/api/v1/platform/admins')
    .then((r) => setAdmins(r.admins))
    .catch((e) => { setAdmins((cur) => cur ?? []); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiJson<{ email: string | null }>('/api/v1/platform/me').then((r) => setMe(r.email?.toLowerCase() ?? null)).catch(() => setMe(null)); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const who = email.trim();
    setBusy(true);
    const r = await api('/api/v1/platform/admins', { method: 'POST', body: JSON.stringify({ email: who, name: name.trim() }) });
    setBusy(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    const j = (await r.json().catch(() => null)) as { reactivated?: boolean } | null;
    toast(j?.reactivated ? `${who} can open the console again` : `${who} invited: they get the console once they sign in with that email`, 'success');
    setEmail(''); setName('');
    load();
  }

  async function remove() {
    const a = removing!;
    setBusy(true); setErr(null);
    const r = await api(`/api/v1/platform/admins/${a.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) return setErr(await apiError(r));
    setRemoving(null);
    toast(`${a.name || a.email} can no longer open the console`, 'success', {
      label: 'Undo',
      onClick: async () => {
        const u = await api('/api/v1/platform/admins', { method: 'POST', body: JSON.stringify({ email: a.email, name: a.name ?? '' }) });
        if (!u.ok) toast(await apiError(u), 'error'); else { toast(`${a.name || a.email} restored`, 'info'); load(); }
      },
    });
    load();
  }

  // The signed-in admin's own row: tagged, and never removable from here (the server refuses it too).
  const isMe = (a: Admin) => !!me && a.email.toLowerCase() === me;

  return (
    <AppShell variant="platform">
      <PageHead title="Access" sub="Who can open this console, and who can create a shop" />
      <div className="card">
        <div className="card-head"><div><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck aria-hidden /> Platform admins</h2><div className="desc">They see every shop, its chats and its billing. An invited admin gets the console the first time they sign in with a confirmed email.</div></div></div>
        {admins && admins.length === 0 && <EmptyState icon={ShieldCheck} title="No platform admins" hint="Invite one by email below." />}
        {admins && admins.length > 0 && (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Name</th><th>Email</th><th>State</th><th className="hide-sm">Added</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Name" className="strong">{a.name || '—'}{isMe(a) && <span className="hint" style={{ fontWeight: 500 }}> (you)</span>}</td>
                    <td data-label="Email" className="mono">{a.email}</td>
                    <td data-label="State"><State a={a} /></td>
                    <td data-label="Added" className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{day(a.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {a.is_active && !isMe(a) && <button type="button" className="btn sm danger-ghost" onClick={() => { setErr(null); setRemoving(a); }} aria-label={`Remove ${a.name || a.email}`}><UserMinus aria-hidden /> Remove…</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!admins && <div className="skeleton" style={{ height: 80, margin: 16 }} />}
        <form className="pad" onSubmit={add} style={{ borderTop: '1px solid var(--border)' }}>
          <div className="form-row">
            <div className="field" style={{ flex: '2 1 220px' }}><label htmlFor="admin-email">Email</label><input id="admin-email" type="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="admin-name">Name <span className="hint">(optional)</span></label><input id="admin-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
            <button className="btn" disabled={busy || !email.trim()}><UserPlus aria-hidden /> Invite</button>
          </div>
          <div className="help">They sign in at the usual login with this email; the console appears once that email is confirmed.</div>
        </form>
      </div>
      <SignupSettings />

      <Dialog open={!!removing} onClose={() => setRemoving(null)} busy={busy} title={`Remove ${removing?.name || removing?.email}?`}
        actions={<button type="button" className="btn danger" onClick={remove} disabled={busy}><UserMinus aria-hidden /> {busy ? 'Removing…' : 'Remove admin'}</button>}>
        <p>They lose the console on their next page load. Their email stays listed as removed, and you can invite them again.</p>
        {err && <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>{err}</span></div>}
      </Dialog>
    </AppShell>
  );
}
