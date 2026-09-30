'use client';
import { useEffect, useState } from 'react';
import { Landmark, Plus, Save, Scale, Shield, Smile, Trash2, type LucideIcon } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../components/AppShell';
import { api, apiError, apiJson } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface Kb {
  delivery?: string; returns?: string; payment?: string; address?: string; hours?: string;
  faqs?: { q: string; a: string }[];
}
interface Settings {
  business_name: string;
  negotiation_defaults: { maxDiscountPct?: number; roundsMax?: number; stalemateAction?: 'handoff' | 'hold_and_close'; bulkTiers?: Tier[] };
  settings: { botEnabled?: boolean; defaultDeliveryCharge?: number; upsellEnabled?: boolean; kb?: Kb };
  bot_persona: { name?: string; style?: string } | null;
  bankAccounts: { id: string; bank_name: string; account_title: string; account_number: string; is_default: boolean }[];
}

// Bargaining personalities → concession-curve presets (fraction of the discount gap
// conceded per round). Sakht crawls over 4 rounds; Narm gives most of it round one.
const STYLES: Record<string, { label: string; hint: string; Icon: LucideIcon; concessionSteps: number[]; roundsMax: number }> = {
  narm: { label: 'Narm', hint: 'Concedes quickly — friendly and generous. Good for fast sales.', Icon: Smile, concessionSteps: [0.6, 0.9, 1.0], roundsMax: 3 },
  standard: { label: 'Standard', hint: 'Balanced haggling — concedes steadily over 3 rounds.', Icon: Scale, concessionSteps: [0.5, 0.8, 1.0], roundsMax: 3 },
  sakht: { label: 'Sakht', hint: 'Tough negotiator — small concessions over 4 rounds. Protects margin.', Icon: Shield, concessionSteps: [0.25, 0.5, 0.75, 1.0], roundsMax: 4 },
};

interface Tier { minQty: number; extraDiscountPct: number }

export default function SettingsPage() {
  const toast = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [bank, setBank] = useState({ bank_name: '', account_title: '', account_number: '' });
  const [name, setName] = useState('');
  const load = () => apiJson<Settings>('/api/v1/admin/settings')
    .then((d) => { setS(d); setName(d.business_name ?? ''); })
    .catch(() => {});
  useEffect(() => { load(); }, []);

  /** PATCH settings; on failure show the server's reason and reload so optimistic edits revert. */
  async function patch(body: object, ok: string, kind: 'success' | 'info' = 'success'): Promise<boolean> {
    const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
    if (r.ok) toast(ok, kind); else { toast(await apiError(r), 'error'); load(); }
    return r.ok;
  }

  async function saveName() {
    const v = name.trim();
    if (!v) { toast('Shop name cannot be empty', 'error'); return; }
    if (await patch({ businessName: v }, 'Shop name saved')) load();
  }

  async function saveNeg() {
    if (!s) return;
    await patch({ negotiationDefaults: s.negotiation_defaults, settings: { defaultDeliveryCharge: s.settings.defaultDeliveryCharge } }, 'Saved');
  }
  async function toggleBot(on: boolean) {
    if (!s) return;
    setS({ ...s, settings: { ...s.settings, botEnabled: on } });
    await patch({ settings: { botEnabled: on } }, on ? 'Bot is now active' : 'Bot paused', on ? 'success' : 'info');
  }
  async function setStyle(style: string) {
    if (!s) return;
    const preset = STYLES[style];
    setS({ ...s, bot_persona: { ...(s.bot_persona ?? {}), style }, negotiation_defaults: { ...s.negotiation_defaults, roundsMax: preset.roundsMax } });
    await patch({ botPersona: { style }, negotiationDefaults: { concessionSteps: preset.concessionSteps, roundsMax: preset.roundsMax } }, `Bargaining style: ${preset.label}`);
  }
  async function toggleUpsell(on: boolean) {
    if (!s) return;
    setS({ ...s, settings: { ...s.settings, upsellEnabled: on } });
    await patch({ settings: { upsellEnabled: on } }, on ? 'Upsell suggestions on' : 'Upsell suggestions off');
  }
  const kb = s?.settings.kb ?? {};
  const setKb = (patch: Partial<Kb>) => s && setS({ ...s, settings: { ...s.settings, kb: { ...kb, ...patch } } });
  async function saveKb() {
    if (!s) return;
    const faqs = (kb.faqs ?? []).filter((f) => f.q.trim() && f.a.trim());
    await patch({ settings: { kb: { ...kb, faqs } } }, 'Knowledgebase saved — bot ab in se jawab dega');
  }
  async function addBank() {
    if (!bank.bank_name || !bank.account_number) return;
    const r = await api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ ...bank, is_default: (s?.bankAccounts.length ?? 0) === 0 }) });
    if (!r.ok) return toast(await apiError(r), 'error');
    setBank({ bank_name: '', account_title: '', account_number: '' }); toast('Bank account added', 'success'); load();
  }
  async function delBank(id: string) {
    const r = await api(`/api/v1/admin/bank-accounts/${id}`, { method: 'DELETE' });
    if (!r.ok) toast(await apiError(r), 'error');
    load();
  }

  if (!s) return <AppShell><PageHead title="Settings" sub="Configure your bot, negotiation, and payments" /><div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}</div></AppShell>;
  const nd = s.negotiation_defaults;
  const setNd = (patch: Partial<typeof nd>) => setS({ ...s, negotiation_defaults: { ...nd, ...patch } });
  const tiers = nd.bulkTiers ?? [];
  const setTier = (i: number, patch: Partial<Tier>) => setNd({ bulkTiers: tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const faqs = kb.faqs ?? [];
  const botOn = s.settings.botEnabled !== false;
  const currentStyle = s.bot_persona?.style ?? 'standard';

  return (
    <AppShell>
      <PageHead title="Settings" sub="Configure your bot, negotiation, and payments" />

      <div className="eyebrow">Bot</div>
      <div className="card">
        <div className="card-head" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="setting-row" style={{ width: '100%' }}>
            <div>
              <div className="t">WhatsApp bot <span className={`pill ${botOn ? 'success' : 'neutral'}`} style={{ marginLeft: 6 }}><span className="dot" aria-hidden />{botOn ? 'Active' : 'Paused'}</span></div>
              <div className="d">{botOn ? 'Replying to customers on WhatsApp' : 'Paused — customers get no automated replies'}</div>
            </div>
            <label className="switch"><input type="checkbox" aria-label="Bot active" checked={botOn} onChange={(e) => toggleBot(e.target.checked)} /><span className="track" /></label>
          </div>
        </div>
        <div className="card-head" style={{ borderBottom: 0 }}>
          <div className="setting-row" style={{ width: '100%' }}>
            <div><div className="t">Upsell suggestions</div><div className="d">After an order confirms, the bot suggests one cheap add-on that ships together.</div></div>
            <label className="switch"><input type="checkbox" aria-label="Upsell suggestions" checked={s.settings.upsellEnabled !== false} onChange={(e) => toggleUpsell(e.target.checked)} /><span className="track" /></label>
          </div>
        </div>
      </div>

      <div className="card pad">
        <h2>Shop name</h2>
        <p className="section-desc" style={{ marginBottom: 14 }}>Ye naam customers ko WhatsApp par dikhta hai — bot isi naam se baat karta hai. Platform ka naam nahi, aap ki apni dukaan ka naam.</p>
        <div className="form-row">
          <div className="field" style={{ flex: '1 1 260px' }}>
            <label htmlFor="bizname">Business name</label>
            <input id="bizname" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Garments" onKeyDown={(e) => e.key === 'Enter' && saveName()} />
          </div>
          <button className="btn" onClick={saveName} disabled={!name.trim() || name.trim() === (s.business_name ?? '')}><Save aria-hidden /> Save</button>
        </div>
      </div>

      <div className="eyebrow">Negotiation</div>
      <div className="card pad">
        <h2 id="style-h">Bargaining style</h2>
        <p className="section-desc" style={{ marginBottom: 14 }}>How quickly the bot gives ground when a customer haggles. It never goes below your floor.</p>
        <div className="choices" role="radiogroup" aria-labelledby="style-h">
          {Object.entries(STYLES).map(([key, st]) => (
            <button key={key} className="choice" role="radio" aria-checked={currentStyle === key} onClick={() => setStyle(key)}>
              <span className="ico"><st.Icon aria-hidden /></span>
              <span><span className="t" style={{ display: 'block' }}>{st.label}</span><span className="d" style={{ display: 'block' }}>{st.hint}</span></span>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><h2>Negotiation rules</h2><div className="desc">Limits the bot works within. Per-product settings in the catalog override these.</div></div></div>
        <div style={{ padding: '18px 22px' }}>
          <div className="form-row">
            <div className="field"><label htmlFor="maxd">Max discount %</label><input id="maxd" type="number" min="0" max="100" value={nd.maxDiscountPct ?? 0} onChange={(e) => setNd({ maxDiscountPct: Number(e.target.value) })} className="mini num" /></div>
            <div className="field"><label htmlFor="rounds">Haggle rounds</label><input id="rounds" type="number" min="1" max="10" value={nd.roundsMax ?? 3} onChange={(e) => setNd({ roundsMax: Number(e.target.value) })} className="mini num" /></div>
            <div className="field"><label htmlFor="stall">When haggling stalls</label>
              <select id="stall" value={nd.stalemateAction ?? 'handoff'} onChange={(e) => setNd({ stalemateAction: e.target.value as 'handoff' | 'hold_and_close' })} style={{ width: 'auto' }}>
                <option value="handoff">Hand the chat to me</option>
                <option value="hold_and_close">Bot holds at its last price</option>
              </select>
            </div>
            <div className="field"><label htmlFor="deliv">Default delivery (Rs)</label><input id="deliv" type="number" min="0" value={Math.round((s.settings.defaultDeliveryCharge ?? 0) / 100)} onChange={(e) => setS({ ...s, settings: { ...s.settings, defaultDeliveryCharge: Math.round(Number(e.target.value)) * 100 } })} className="mini num" style={{ width: 120 }} /></div>
          </div>
          <div className="divider" />
          <h3>Bulk discounts</h3>
          <p className="hint" style={{ margin: '2px 0 12px' }}>Extra % off, on top of the max discount, when a buyer takes at least this many pieces. Min price still applies.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {tiers.map((t, i) => (
              <div className="row" key={i}>
                <input aria-label={`Tier ${i + 1} minimum pieces`} type="number" min="2" className="xs num" value={t.minQty} onChange={(e) => setTier(i, { minQty: Number(e.target.value) })} />
                <span className="hint">pieces or more →</span>
                <input aria-label={`Tier ${i + 1} extra percent off`} type="number" min="0" max="100" className="xs num" value={t.extraDiscountPct} onChange={(e) => setTier(i, { extraDiscountPct: Number(e.target.value) })} />
                <span className="hint">% extra</span>
                <button className="btn subtle icon-btn" onClick={() => setNd({ bulkTiers: tiers.filter((_, j) => j !== i) })} aria-label={`Remove tier ${i + 1}`}><Trash2 /></button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setNd({ bulkTiers: [...tiers, { minQty: 10, extraDiscountPct: 5 }] })}><Plus aria-hidden /> Add bulk tier</button>
          </div>
        </div>
        <div className="card-foot"><button className="btn" onClick={saveNeg}><Save aria-hidden /> Save negotiation rules</button></div>
      </div>

      <div className="eyebrow">Knowledgebase</div>
      <div className="card">
        <div className="card-head"><div><h2>Dukaan ki maloomat <span className="pill brand" style={{ marginLeft: 6 }}>Bot knowledgebase</span></h2><div className="desc">Customer &ldquo;delivery kitne din?&rdquo; ya &ldquo;return policy?&rdquo; pooche to bot YAHIN se jawab dega. Jo yahan nahi likha, bot kabhi khud se nahi banayega — keh dega &ldquo;malik se pooch kar batata hoon&rdquo;.</div></div></div>
        <div style={{ padding: '18px 22px' }}>
          <div className="grid-2">
            <div className="field" style={{ margin: 0 }}><label htmlFor="kb-delivery">Delivery (waqt, charges, areas)</label><textarea id="kb-delivery" rows={2} value={kb.delivery ?? ''} onChange={(e) => setKb({ delivery: e.target.value })} placeholder="Lahore mein 1-2 din, baqi shehr 3-4 din. Rs 200 delivery." /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="kb-returns">Return / exchange policy</label><textarea id="kb-returns" rows={2} value={kb.returns ?? ''} onChange={(e) => setKb({ returns: e.target.value })} placeholder="7 din mein exchange, receipt ke sath. Sale items pe return nahi." /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="kb-payment">Payment info</label><textarea id="kb-payment" rows={2} value={kb.payment ?? ''} onChange={(e) => setKb({ payment: e.target.value })} placeholder="COD ya bank transfer. Advance zaroori nahi." /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="kb-address">Shop address</label><textarea id="kb-address" rows={2} value={kb.address ?? ''} onChange={(e) => setKb({ address: e.target.value })} placeholder="Shop 12, Liberty Market, Lahore" /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="kb-hours">Timings</label><textarea id="kb-hours" rows={2} value={kb.hours ?? ''} onChange={(e) => setKb({ hours: e.target.value })} placeholder="Roz 11am - 10pm, Jumma 3pm se" /></div>
          </div>
          <div className="divider" />
          <h3>Custom FAQs</h3>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {faqs.map((f, i) => (
              <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                <input aria-label={`FAQ ${i + 1} question`} placeholder="Sawal — e.g. bulk discount milta hai?" value={f.q} onChange={(e) => setKb({ faqs: faqs.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)) })} />
                <input aria-label={`FAQ ${i + 1} answer`} placeholder="Jawab" value={f.a} onChange={(e) => setKb({ faqs: faqs.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)) })} />
                <button className="btn subtle icon-btn" onClick={() => setKb({ faqs: faqs.filter((_, j) => j !== i) })} aria-label={`Remove FAQ ${i + 1}`}><Trash2 /></button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setKb({ faqs: [...faqs, { q: '', a: '' }] })}><Plus aria-hidden /> Add FAQ</button>
          </div>
        </div>
        <div className="card-foot"><button className="btn" onClick={saveKb}><Save aria-hidden /> Save knowledgebase</button></div>
      </div>

      <div className="eyebrow">Payments</div>
      <div className="card">
        <div className="card-head"><div><h2>Bank accounts</h2><div className="desc">Shown to buyers who choose bank transfer. You verify every payment yourself.</div></div></div>
        {s.bankAccounts.length === 0 ? (
          <EmptyState icon={Landmark} title="No bank accounts" hint="Add one below to accept bank-transfer orders." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Bank</th><th>Account title</th><th>Account number</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {s.bankAccounts.map((b) => (
                  <tr key={b.id}>
                    <td className="strong">{b.bank_name} {b.is_default && <span className="pill brand" style={{ marginLeft: 6 }}>Default</span>}</td>
                    <td>{b.account_title}</td>
                    <td className="mono">{b.account_number}</td>
                    <td className="num"><button className="btn subtle icon-btn sm" onClick={() => delBank(b.id)} aria-label={`Remove ${b.bank_name} account`}><Trash2 /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-foot">
          <div className="field" style={{ margin: 0, flex: '1 1 160px' }}><label htmlFor="b-name">Bank name</label><input id="b-name" placeholder="e.g. Meezan Bank" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></div>
          <div className="field" style={{ margin: 0, flex: '1 1 160px' }}><label htmlFor="b-title">Account title</label><input id="b-title" value={bank.account_title} onChange={(e) => setBank({ ...bank, account_title: e.target.value })} /></div>
          <div className="field" style={{ margin: 0, flex: '1 1 180px' }}><label htmlFor="b-num">Account number / IBAN</label><input id="b-num" className="mono" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} /></div>
          <button className="btn" onClick={addBank} disabled={!bank.bank_name || !bank.account_number}><Plus aria-hidden /> Add account</button>
        </div>
      </div>
    </AppShell>
  );
}
