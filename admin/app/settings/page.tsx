'use client';
import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';

interface Settings {
  business_name: string;
  negotiation_defaults: { maxDiscountPct?: number; roundsMax?: number; autoAcceptAtFloor?: boolean };
  settings: { botEnabled?: boolean; codEnabled?: boolean; defaultDeliveryCharge?: number };
  bankAccounts: { id: string; bank_name: string; account_title: string; account_number: string; is_default: boolean }[];
}

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [bank, setBank] = useState({ bank_name: '', account_title: '', account_number: '' });

  const load = () => apiJson<Settings>('/api/v1/admin/settings').then(setS).catch(() => {});
  useEffect(() => { load(); }, []);

  async function saveNeg() {
    if (!s) return;
    await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ negotiationDefaults: s.negotiation_defaults, settings: { defaultDeliveryCharge: s.settings.defaultDeliveryCharge } }) });
    flash('Saved');
  }
  async function toggleBot(on: boolean) {
    if (!s) return;
    setS({ ...s, settings: { ...s.settings, botEnabled: on } });
    await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { botEnabled: on } }) });
    flash(on ? 'Bot ON' : 'Bot paused');
  }
  async function addBank() {
    if (!bank.bank_name || !bank.account_number) return;
    await api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ ...bank, is_default: (s?.bankAccounts.length ?? 0) === 0 }) });
    setBank({ bank_name: '', account_title: '', account_number: '' });
    load();
  }
  async function delBank(id: string) {
    await api(`/api/v1/admin/bank-accounts/${id}`, { method: 'DELETE' });
    load();
  }
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1500); };

  if (!s) return <AppShell><p>Loading…</p></AppShell>;
  const nd = s.negotiation_defaults;

  return (
    <AppShell>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Settings</h1>
        {msg && <span className="badge ok">{msg}</span>}
      </div>

      <div className="section">
        <h2>Bot</h2>
        <label className="toggle">
          <input type="checkbox" checked={s.settings.botEnabled !== false} onChange={(e) => toggleBot(e.target.checked)} />
          <span>Bot is {s.settings.botEnabled !== false ? 'active — replying to customers' : 'paused'}</span>
        </label>
      </div>

      <div className="section">
        <h2>Negotiation</h2>
        <div className="row">
          <div><label>Max discount %</label><input type="number" value={nd.maxDiscountPct ?? 0} onChange={(e) => setS({ ...s, negotiation_defaults: { ...nd, maxDiscountPct: Number(e.target.value) } })} style={{ width: 90 }} /></div>
          <div><label>Haggle rounds</label><input type="number" value={nd.roundsMax ?? 3} onChange={(e) => setS({ ...s, negotiation_defaults: { ...nd, roundsMax: Number(e.target.value) } })} style={{ width: 90 }} /></div>
          <div><label>Default delivery (Rs)</label><input type="number" value={Math.round((s.settings.defaultDeliveryCharge ?? 0) / 100)} onChange={(e) => setS({ ...s, settings: { ...s.settings, defaultDeliveryCharge: Math.round(Number(e.target.value)) * 100 } })} style={{ width: 110 }} /></div>
        </div>
        <button className="btn" style={{ marginTop: 14 }} onClick={saveNeg}>Save</button>
      </div>

      <div className="section">
        <h2>Bank accounts</h2>
        <table>
          <thead><tr><th>Bank</th><th>Title</th><th>Number</th><th></th></tr></thead>
          <tbody>
            {s.bankAccounts.map((b) => (
              <tr key={b.id}><td>{b.bank_name}{b.is_default ? ' ⭐' : ''}</td><td>{b.account_title}</td><td>{b.account_number}</td><td><button className="btn danger" onClick={() => delBank(b.id)}>Delete</button></td></tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 14 }}>
          <input placeholder="Bank name" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} />
          <input placeholder="Account title" value={bank.account_title} onChange={(e) => setBank({ ...bank, account_title: e.target.value })} />
          <input placeholder="Account number" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} />
          <button className="btn" onClick={addBank}>Add</button>
        </div>
      </div>
    </AppShell>
  );
}
