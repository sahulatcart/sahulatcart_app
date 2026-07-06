'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface Kb {
  delivery?: string; returns?: string; payment?: string; address?: string; hours?: string;
  faqs?: { q: string; a: string }[];
}
interface Settings {
  business_name: string;
  negotiation_defaults: { maxDiscountPct?: number; roundsMax?: number };
  settings: { botEnabled?: boolean; defaultDeliveryCharge?: number; upsellEnabled?: boolean; kb?: Kb };
  bot_persona: { name?: string; style?: string } | null;
  bankAccounts: { id: string; bank_name: string; account_title: string; account_number: string; is_default: boolean }[];
}

// Bargaining personalities → concession-curve presets (fraction of the discount gap
// conceded per round). Sakht crawls over 4 rounds; Narm gives most of it round one.
const STYLES: Record<string, { label: string; hint: string; concessionSteps: number[]; roundsMax: number }> = {
  narm: { label: 'Narm 😊', hint: 'Concedes quickly — friendly and generous. Good for fast sales.', concessionSteps: [0.6, 0.9, 1.0], roundsMax: 3 },
  standard: { label: 'Standard', hint: 'Balanced haggling — concedes steadily over 3 rounds.', concessionSteps: [0.5, 0.8, 1.0], roundsMax: 3 },
  sakht: { label: 'Sakht 😤', hint: 'Tough negotiator — small concessions over 4 rounds. Protects margin.', concessionSteps: [0.25, 0.5, 0.75, 1.0], roundsMax: 4 },
};

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [bank, setBank] = useState({ bank_name: '', account_title: '', account_number: '' });
  const load = () => apiJson<Settings>('/api/v1/admin/settings').then(setS).catch(() => {});
  useEffect(() => { load(); }, []);

  async function saveNeg() {
    if (!s) return;
    await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ negotiationDefaults: s.negotiation_defaults, settings: { defaultDeliveryCharge: s.settings.defaultDeliveryCharge } }) });
    toast('Saved', 'success');
  }
  async function toggleBot(on: boolean) {
    if (!s) return;
    setS({ ...s, settings: { ...s.settings, botEnabled: on } });
    await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { botEnabled: on } }) });
    toast(on ? 'Bot is now active' : 'Bot paused', on ? 'success' : 'info');
  }
  async function setStyle(style: string) {
    if (!s) return;
    const preset = STYLES[style];
    setS({ ...s, bot_persona: { ...(s.bot_persona ?? {}), style }, negotiation_defaults: { ...s.negotiation_defaults, roundsMax: preset.roundsMax } });
    const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ botPersona: { style }, negotiationDefaults: { concessionSteps: preset.concessionSteps, roundsMax: preset.roundsMax } }) });
    if (r.ok) toast(`Bargaining style: ${preset.label}`, 'success'); else toast('Could not save style', 'error');
  }
  async function toggleUpsell(on: boolean) {
    if (!s) return;
    setS({ ...s, settings: { ...s.settings, upsellEnabled: on } });
    const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { upsellEnabled: on } }) });
    if (r.ok) toast(on ? 'Upsell suggestions on' : 'Upsell suggestions off', 'success'); else toast('Could not save', 'error');
  }
  const kb = s?.settings.kb ?? {};
  const setKb = (patch: Partial<Kb>) => s && setS({ ...s, settings: { ...s.settings, kb: { ...kb, ...patch } } });
  async function saveKb() {
    if (!s) return;
    const faqs = (kb.faqs ?? []).filter((f) => f.q.trim() && f.a.trim());
    const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { kb: { ...kb, faqs } } }) });
    if (r.ok) toast('Knowledgebase saved — bot ab in se jawab dega', 'success'); else toast('Could not save', 'error');
  }
  async function addBank() {
    if (!bank.bank_name || !bank.account_number) return;
    await api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ ...bank, is_default: (s?.bankAccounts.length ?? 0) === 0 }) });
    setBank({ bank_name: '', account_title: '', account_number: '' }); toast('Bank account added', 'success'); load();
  }
  async function delBank(id: string) { await api(`/api/v1/admin/bank-accounts/${id}`, { method: 'DELETE' }); load(); }

  if (!s) return <AppShell><PageHead title="Settings" /><div className="card pad"><div className="skeleton" style={{ height: 60 }} /></div></AppShell>;
  const nd = s.negotiation_defaults;

  return (
    <AppShell>
      <PageHead title="Settings" sub="Configure your bot, negotiation, and payments" />

      <div className="card pad">
        <div className="row between">
          <div><h2 style={{ margin: 0 }}>Bot</h2><div className="hint">{s.settings.botEnabled !== false ? 'Active — replying to customers on WhatsApp' : 'Paused — customers get no automated replies'}</div></div>
          <label className="switch"><input type="checkbox" checked={s.settings.botEnabled !== false} onChange={(e) => toggleBot(e.target.checked)} /><span className="track" /></label>
        </div>
      </div>

      <div className="card pad">
        <h2>Bargaining style</h2>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          {Object.entries(STYLES).map(([key, st]) => {
            const active = (s.bot_persona?.style ?? 'standard') === key;
            return (
              <button key={key} className={active ? 'btn' : 'btn ghost'} onClick={() => setStyle(key)} aria-pressed={active}>
                {st.label}
              </button>
            );
          })}
        </div>
        <div className="hint">{STYLES[s.bot_persona?.style ?? 'standard']?.hint}</div>
      </div>

      <div className="card pad">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>Upsell suggestions</h2>
            <div className="hint">After an order confirms, the bot suggests one cheap add-on (ships together).</div>
          </div>
          <label className="switch"><input type="checkbox" checked={s.settings.upsellEnabled !== false} onChange={(e) => toggleUpsell(e.target.checked)} /><span className="track" /></label>
        </div>
      </div>

      <div className="card pad">
        <h2>Negotiation</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0 }}><label>Max discount %</label><input type="number" value={nd.maxDiscountPct ?? 0} onChange={(e) => setS({ ...s, negotiation_defaults: { ...nd, maxDiscountPct: Number(e.target.value) } })} className="mini" /></div>
          <div className="field" style={{ margin: 0 }}><label>Haggle rounds</label><input type="number" value={nd.roundsMax ?? 3} onChange={(e) => setS({ ...s, negotiation_defaults: { ...nd, roundsMax: Number(e.target.value) } })} className="mini" /></div>
          <div className="field" style={{ margin: 0 }}><label>Default delivery (Rs)</label><input type="number" value={Math.round((s.settings.defaultDeliveryCharge ?? 0) / 100)} onChange={(e) => setS({ ...s, settings: { ...s.settings, defaultDeliveryCharge: Math.round(Number(e.target.value)) * 100 } })} className="mini" style={{ width: 110 }} /></div>
          <button className="btn" onClick={saveNeg}>Save</button>
        </div>
      </div>

      <div className="card pad">
        <h2>Dukaan ki maloomat <span className="pill brand">bot knowledgebase</span></h2>
        <p className="hint" style={{ marginBottom: 16 }}>Customer "delivery kitne din?" ya "return policy?" pooche to bot YAHIN se jawab dega. Jo yahan nahi likha, bot kabhi khud se nahi banayega — keh dega "malik se pooch kar batata hoon".</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="field" style={{ margin: 0 }}><label>Delivery (waqt, charges, areas)</label><textarea rows={2} value={kb.delivery ?? ''} onChange={(e) => setKb({ delivery: e.target.value })} placeholder="Lahore mein 1-2 din, baqi shehr 3-4 din. Rs 200 delivery." /></div>
          <div className="field" style={{ margin: 0 }}><label>Return / exchange policy</label><textarea rows={2} value={kb.returns ?? ''} onChange={(e) => setKb({ returns: e.target.value })} placeholder="7 din mein exchange, receipt ke sath. Sale items pe return nahi." /></div>
          <div className="field" style={{ margin: 0 }}><label>Payment info</label><textarea rows={2} value={kb.payment ?? ''} onChange={(e) => setKb({ payment: e.target.value })} placeholder="COD ya bank transfer. Advance zaroori nahi." /></div>
          <div className="field" style={{ margin: 0 }}><label>Shop address</label><textarea rows={2} value={kb.address ?? ''} onChange={(e) => setKb({ address: e.target.value })} placeholder="Shop 12, Liberty Market, Lahore" /></div>
          <div className="field" style={{ margin: 0 }}><label>Timings</label><textarea rows={2} value={kb.hours ?? ''} onChange={(e) => setKb({ hours: e.target.value })} placeholder="Roz 11am - 10pm, Jumma 3pm se" /></div>
        </div>
        <div style={{ marginTop: 18 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 8 }}>Custom FAQs</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {(kb.faqs ?? []).map((f, i) => (
              <div className="row" key={i}>
                <input placeholder="Sawal — e.g. bulk discount milta hai?" value={f.q} onChange={(e) => setKb({ faqs: (kb.faqs ?? []).map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                <input placeholder="Jawab" value={f.a} onChange={(e) => setKb({ faqs: (kb.faqs ?? []).map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
                <button className="btn ghost sm" onClick={() => setKb({ faqs: (kb.faqs ?? []).filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setKb({ faqs: [...(kb.faqs ?? []), { q: '', a: '' }] })}>+ Add FAQ</button>
          </div>
        </div>
        <div style={{ marginTop: 16 }}><button className="btn" onClick={saveKb}>Save knowledgebase</button></div>
      </div>

      <div className="card">
        <div className="card-head"><h2 style={{ margin: 0 }}>Bank accounts</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Bank</th><th>Title</th><th>Number</th><th></th></tr></thead>
            <tbody>
              {s.bankAccounts.map((b) => (
                <tr key={b.id}><td className="strong">{b.bank_name} {b.is_default && <span className="pill brand">default</span>}</td><td>{b.account_title}</td><td>{b.account_number}</td><td><button className="btn ghost sm" onClick={() => delBank(b.id)}><Trash2 size={14} /></button></td></tr>
              ))}
              {s.bankAccounts.length === 0 && <tr><td colSpan={4} className="empty">No bank accounts — add one for bank-transfer orders.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
          <input placeholder="Bank name" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} style={{ maxWidth: 180 }} />
          <input placeholder="Account title" value={bank.account_title} onChange={(e) => setBank({ ...bank, account_title: e.target.value })} style={{ maxWidth: 180 }} />
          <input placeholder="Account number" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} style={{ maxWidth: 200 }} />
          <button className="btn" onClick={addBank}><Plus /> Add</button>
        </div>
      </div>
    </AppShell>
  );
}
