'use client';
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import AppShell, { EmptyState, PageHead, Pill } from '../../../components/AppShell';
import PlatformTabs from '../../../components/PlatformTabs';
import SignupSettings from '../../../components/SignupSettings';
import { api, apiError, apiJson, dt } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

/** Who may open the console (F2): platform admins invited by email, bound to their login at the first confirmed sign-in. */

interface Admin { id: string; name: string | null; email: string; is_active: boolean; auth_user_id: string | null; created_at: string }

function State({ a }: { a: Admin }) {
  if (!a.is_active) return <Pill kind="danger">inactive</Pill>;
  return a.auth_user_id ? <Pill kind="success">signed in</Pill> : <Pill kind="info">invited</Pill>;
}

export default function PlatformAccess() {
  const toast = useToast();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => apiJson<{ admins: Admin[] }>('/api/v1/platform/admins')
    .then((r) => setAdmins(r.admins))
    .catch((e) => { setAdmins([]); toast((e as Error).message, 'error'); }), [toast]);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy('add');
    const r = await api('/api/v1/platform/admins', { method: 'POST', body: JSON.stringify({ email: email.trim(), name: name.trim() }) });
    setBusy(null);
    if (!r.ok) return toast(await apiError(r), 'error');
    const j = (await r.json().catch(() => null)) as { reactivated?: boolean } | null;
    toast(j?.reactivated ? 'Admin reactivated' : 'Admin added', 'success');
    setEmail(''); setName('');
    load();
  }

  async function remove(a: Admin) {
    if (!confirm(`Remove ${a.name || a.email} from the platform admins? They lose the console at once.`)) return;
    setBusy(a.id);
    const r = await api(`/api/v1/platform/admins/${a.id}`, { method: 'DELETE' });
    setBusy(null);
    if (!r.ok) return toast(await apiError(r), 'error');
    toast('Admin removed', 'success');
    load();
  }

  return (
    <AppShell>
      <PageHead title="Access" sub="Who can open this console" />
      <PlatformTabs />
      <div className="card">
        <div className="card-head"><div><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShieldCheck aria-hidden /> Platform admins</h2><div className="desc">An invited admin is bound to their login the first time they sign in with a confirmed email.</div></div></div>
        {admins && admins.length === 0 && <EmptyState icon={ShieldCheck} title="No platform admins" hint="Invite one by email below." />}
        {admins && admins.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>State</th><th className="hide-sm">Added</th><th></th></tr></thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id}>
                    <td className="strong">{a.name || '—'}</td>
                    <td className="mono">{a.email}</td>
                    <td><State a={a} /></td>
                    <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{dt(a.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {a.is_active && <button className="btn sm danger-ghost" disabled={busy === a.id} onClick={() => remove(a)}><UserMinus aria-hidden /> Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!admins && <div className="skeleton" style={{ height: 80, margin: 16 }} />}
        <form className="card-head" onSubmit={add} style={{ borderBottom: 0, borderTop: '1px solid var(--border)', display: 'block' }}>
          <div className="form-row">
            <div className="field" style={{ flex: '2 1 220px' }}><label htmlFor="admin-email">Email</label><input id="admin-email" type="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="admin-name">Name</label><input id="admin-name" maxLength={80} placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <button className="btn" disabled={busy === 'add'}><UserPlus aria-hidden /> Invite</button>
          </div>
          <div className="help" style={{ marginTop: 8 }}>They sign in at the usual login with this email; the console appears once the email is confirmed.</div>
        </form>
      </div>
      <SignupSettings />
    </AppShell>
  );
}
