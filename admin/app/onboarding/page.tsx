'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Check, FileUp, ImagePlus, Loader2, Plus, Rocket, Save, Scale, Send, Shield, Smartphone, Smile, Trash2, type LucideIcon } from 'lucide-react';
import AppShell, { Pill, PageHead } from '../../components/AppShell';
import DeliveryZones, { type Zone } from '../../components/DeliveryZones';
import { WhatsAppConnect } from '../settings/whatsapp/page';
import { api, apiError, apiJson, dt, rs } from '../../lib/api';
import { useToast } from '../../components/Toast';

type StepKey = 'profile' | 'whatsapp' | 'catalog' | 'delivery' | 'payment' | 'persona' | 'testOrder';
interface StepResult { ok: boolean; reason?: string; problem?: boolean }
interface Readiness { steps: Record<StepKey, StepResult>; ready: boolean; failing: StepKey[] }
type DayHours = { open: string; close: string } | { closed: true };
type Hours = Partial<Record<Day, DayHours>>;
type Day = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
interface Settings {
  business_name: string; owner_name: string | null; email: string | null; phone: string | null; address: string | null;
  category: string | null; business_hours: Hours | null; logo_url: string | null;
  negotiation_defaults: { maxDiscountPct?: number; roundsMax?: number };
  settings: { botEnabled?: boolean; codEnabled?: boolean; paymentInstructions?: string; defaultDeliveryCharge?: number; freeDeliveryThreshold?: number; deliveryConfigured?: boolean; attestations?: { at?: string } };
  bot_persona: { name?: string; style?: string; greeting?: string } | null;
  bankAccounts: { id: string; bank_name: string; account_title: string; account_number: string; is_default: boolean }[];
  deliveryZones: Zone[];
}

/** The seven steps, in order. The server decides which are done (GET /admin/readiness). */
const STEPS: { key: StepKey; label: string; title: string; hint: string }[] = [
  { key: 'profile', label: 'Shop', title: 'Your shop', hint: 'What customers see, and what WhatsApp shows on your business profile.' },
  { key: 'whatsapp', label: 'WhatsApp', title: 'Connect WhatsApp', hint: 'The number the bot answers from. Connect it through Meta, then send it one message from your phone.' },
  { key: 'catalog', label: 'Products', title: 'Add your products', hint: 'One priced product is enough to start. Add them here, or import a CSV (Shopify exports work too).' },
  { key: 'delivery', label: 'Delivery', title: 'Delivery areas and charges', hint: 'The bot quotes these when a buyer gives an address. An area you mark as not serviceable is refused politely.' },
  { key: 'payment', label: 'Payment', title: 'How buyers pay', hint: 'Cash on delivery, a bank account for transfers, or both. The bot offers only what you switch on.' },
  { key: 'persona', label: 'Bot', title: 'Your bot', hint: 'A name, a bargaining style and the greeting it opens with. It never goes below the prices you set.' },
  { key: 'testOrder', label: 'Test order', title: 'Place a test order', hint: 'Message your shop number from your own phone and buy something, start to finish. The step turns green when the order is placed.' },
];
const DAYS: { key: Day; label: string }[] = [{ key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' }, { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' }];
const CATEGORIES: { key: string; label: string }[] = [{ key: 'clothing', label: 'Clothing' }, { key: 'electronics', label: 'Electronics' }, { key: 'grocery', label: 'Grocery' }, { key: 'cosmetics', label: 'Cosmetics' }, { key: 'home', label: 'Home' }, { key: 'other', label: 'Other' }];
// Bargaining personalities → concession-curve presets, the same as Settings.
const STYLES: Record<string, { label: string; hint: string; Icon: LucideIcon; concessionSteps: number[]; roundsMax: number }> = {
  narm: { label: 'Narm', hint: 'Concedes quickly — friendly and generous.', Icon: Smile, concessionSteps: [0.6, 0.9, 1.0], roundsMax: 3 },
  standard: { label: 'Standard', hint: 'Balanced — a fair haggle over 3 rounds.', Icon: Scale, concessionSteps: [0.5, 0.8, 1.0], roundsMax: 3 },
  sakht: { label: 'Sakht', hint: 'Tough — small concessions over 4 rounds.', Icon: Shield, concessionSteps: [0.25, 0.5, 0.75, 1.0], roundsMax: 4 },
};
const paisa = (v: string): number => Math.round(Number(v || 0) * 100);
const pretty = (digits?: string | null) => (digits ? `+${digits}` : '—');

export default function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const [ready, setReady] = useState<Readiness | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [active, setActive] = useState<StepKey | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, st] = await Promise.all([apiJson<Readiness>('/api/v1/admin/readiness'), apiJson<Settings>('/api/v1/admin/settings')]);
    setReady(r);
    setS(st);
    // Deep link (?step=) wins; else the first thing still to do; else the first step.
    setActive((cur) => {
      if (cur) return cur;
      const q = new URLSearchParams(window.location.search).get('step') as StepKey | null;
      return q && STEPS.some((x) => x.key === q) ? q : r.failing[0] ?? 'profile';
    });
  }, []);
  useEffect(() => { load().catch(() => toast('Could not load your setup', 'error')); }, [load, toast]);

  async function goLive() {
    setBusy(true);
    try {
      const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { botEnabled: true, onboardingCompletedAt: new Date().toISOString() } }) });
      if (r.ok) { toast('You\'re live — the bot is now selling on WhatsApp', 'success'); router.replace('/'); return; }
      const j = (await r.clone().json().catch(() => null)) as { error?: { code?: string; failing?: StepKey[] } } | null;
      if (j?.error?.code === 'not_ready') {
        toast('Not yet — finish the highlighted steps first', 'error');
        await load();
        if (j.error.failing?.[0]) setActive(j.error.failing[0]);
      } else toast(await apiError(r), 'error');
    } finally { setBusy(false); }
  }

  const done = ready ? 7 - ready.failing.length : 0;
  const step = STEPS.find((x) => x.key === active) ?? STEPS[0]!;
  const result = ready?.steps[step.key];

  return (
    <AppShell>
      <PageHead title="Set up your shop" sub={ready ? `${done} of 7 steps done — the bot goes live when all seven are green` : 'Checking your setup…'} />
      <div className="wizard">
        <div className="card">
          <ol className="wizard-steps" aria-label="Setup steps">
            {STEPS.map((x, i) => {
              const st = ready?.steps[x.key];
              const cls = `${x.key === active ? 'now' : ''} ${st?.ok ? 'ok' : st?.problem ? 'bad' : ''}`;
              return (
                <li key={x.key} className={cls}>
                  <a href={`?step=${x.key}`} onClick={(e) => { e.preventDefault(); setActive(x.key); }} aria-current={x.key === active ? 'step' : undefined}>
                    <span className="n" aria-hidden>{st?.ok ? <Check size={13} /> : i + 1}</span>
                    <span className="label">{x.label}</span>
                    {st && <Pill kind={st.ok ? 'success' : st.problem ? 'danger' : 'neutral'}>{st.ok ? 'Done' : st.problem ? 'Problem' : 'To do'}</Pill>}
                  </a>
                </li>
              );
            })}
          </ol>
          <div className="wizard-foot">
            <button className="btn block" onClick={goLive} disabled={busy || !ready}>
              {busy ? <Loader2 className="spin" aria-hidden /> : <Rocket aria-hidden />} Go live
            </button>
            {ready && !ready.ready && <div className="hint" style={{ marginTop: 8 }}>{ready.failing.length} step{ready.failing.length === 1 ? '' : 's'} left before the bot can be switched on.</div>}
          </div>
        </div>

        <div className="card pad">
          <h2>{step.title}</h2>
          <p className="hint" style={{ marginBottom: 14 }}>{step.hint}</p>
          {result && (
            result.ok
              ? <div className="pill success" style={{ marginBottom: 16 }}><span className="dot" aria-hidden />Done</div>
              : <div className={result.problem ? 'form-error' : 'callout'} role={result.problem ? 'alert' : undefined} style={{ marginBottom: 16 }}>
                  {result.problem ? <AlertCircle aria-hidden /> : null}
                  <span>{result.reason}</span>
                </div>
          )}
          {!s ? <div className="skeleton" style={{ height: 160 }} /> : (
            <>
              {step.key === 'profile' && <ProfilePanel key={s.business_name + (s.phone ?? '')} s={s} onChange={load} />}
              {step.key === 'whatsapp' && <WhatsAppConnect embedded />}
              {step.key === 'catalog' && <ProductsPanel onChange={load} />}
              {step.key === 'delivery' && <DeliveryZones s={s} onChange={load} />}
              {step.key === 'payment' && <PaymentPanel s={s} onChange={load} />}
              {step.key === 'persona' && <BotPanel s={s} onChange={load} />}
              {step.key === 'testOrder' && <TestOrderPanel ok={!!result?.ok} phone={s.phone} />}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/** Step 1: name, owner, phone, address, category, hours, logo — saved with PATCH /admin/profile. */
function ProfilePanel({ s, onChange }: { s: Settings; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ businessName: s.business_name ?? '', ownerName: s.owner_name ?? '', phone: s.phone ? `+${s.phone}` : '', address: s.address ?? '', category: s.category ?? '' });
  const [hours, setHours] = useState<Hours>(s.business_hours ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [logo, setLogo] = useState(s.logo_url);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const day = (d: Day) => hours[d];
  const setDay = (d: Day, v: DayHours | undefined) => setHours((h) => { const n = { ...h }; if (v) n[d] = v; else delete n[d]; return n; });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.category) return toast('Pick a category', 'error');
    setBusy('save');
    try {
      const r = await api('/api/v1/admin/profile', { method: 'PATCH', body: JSON.stringify({ ...f, businessHours: hours }) });
      if (!r.ok) return toast(await apiError(r), 'error');
      toast('Shop details saved', 'success');
      await onChange();
    } finally { setBusy(null); }
  }
  async function upload(file: File) {
    setBusy('logo');
    try {
      const dataBase64 = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] ?? ''); fr.onerror = rej; fr.readAsDataURL(file); });
      const r = await api('/api/v1/admin/settings/logo', { method: 'POST', body: JSON.stringify({ dataBase64, contentType: file.type }) });
      if (!r.ok) return toast(await apiError(r), 'error');
      setLogo(((await r.json()) as { logoUrl: string }).logoUrl);
      toast('Logo uploaded', 'success');
    } finally { setBusy(null); }
  }
  const att = s.settings.attestations?.at;

  return (
    <form onSubmit={save}>
      <div className="form-row">
        <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-name">Shop name</label><input id="p-name" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} required maxLength={80} /></div>
        <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-owner">Your name</label><input id="p-owner" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} required maxLength={80} /></div>
      </div>
      <div className="form-row">
        <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="p-phone">Your WhatsApp number</label><input id="p-phone" type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+92 300 1234567" required /><div className="help">Your own phone — alerts and the test order come from it.</div></div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="p-cat">Category</label>
          <select id="p-cat" value={f.category} onChange={(e) => set('category', e.target.value)} required>
            <option value="">Choose…</option>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label htmlFor="p-addr">Shop address</label><input id="p-addr" value={f.address} onChange={(e) => set('address', e.target.value)} placeholder="Shop 4, Liberty Market, Lahore" maxLength={200} /><div className="help">Shown on your WhatsApp business profile.</div></div>

      <h3>Business hours</h3>
      <div className="table-wrap" style={{ marginBottom: 14 }}>
        <table>
          <thead><tr><th>Day</th><th>Open</th><th>Opens</th><th>Closes</th></tr></thead>
          <tbody>
            {DAYS.map(({ key, label }) => {
              const d = day(key);
              const open = !!d && !('closed' in d);
              return (
                <tr key={key}>
                  <td className="strong">{label}</td>
                  <td><label className="switch"><input type="checkbox" aria-label={`${label} open`} checked={open} onChange={(e) => setDay(key, e.target.checked ? { open: '10:00', close: '22:00' } : { closed: true })} /><span className="track" /></label></td>
                  <td><input type="time" aria-label={`${label} opens`} className="mini" value={open ? d.open : ''} disabled={!open} onChange={(e) => open && setDay(key, { open: e.target.value, close: d.close })} /></td>
                  <td><input type="time" aria-label={`${label} closes`} className="mini" value={open ? d.close : ''} disabled={!open} onChange={(e) => open && setDay(key, { open: d.open, close: e.target.value })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Logo</h3>
      <div className="row" style={{ gap: 14, marginBottom: 14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo ? <img src={logo} alt="Shop logo" width={56} height={56} style={{ borderRadius: 12, objectFit: 'cover' }} /> : <div className="hint">No logo yet.</div>}
        <label className="btn ghost sm" style={{ margin: 0 }}><ImagePlus aria-hidden /> {busy === 'logo' ? 'Uploading…' : 'Upload logo'}<input type="file" accept="image/*" className="sr-only" disabled={busy === 'logo'} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
      </div>

      <h3>Attestations</h3>
      <p className="hint" style={{ marginBottom: 14 }}>
        {att
          ? <><Pill kind="success">Accepted {dt(att, true)}</Pill> No prohibited goods; messages only to customers who contacted you first.</>
          : <><Pill kind="warning">Not recorded</Pill> Your account predates signup attestations. Support will record them for you.</>}
      </p>

      <button className="btn" disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />} Save shop details</button>
    </form>
  );
}

interface P { id: string; name: string; price: number; is_active: boolean }
/** Step 3: the add form and CSV import from the catalog, inline, plus the list so far. */
function ProductsPanel({ onChange }: { onChange: () => Promise<void> }) {
  const toast = useToast();
  const [products, setProducts] = useState<P[] | null>(null);
  const [adding, setAdding] = useState({ name: '', price: '', stock: '' });
  const load = useCallback(() => apiJson<{ products: P[] }>('/api/v1/admin/products').then((r) => setProducts(r.products)).catch(() => setProducts([])), []);
  useEffect(() => { load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name || !adding.price) return;
    const r = await api('/api/v1/admin/products', { method: 'POST', body: JSON.stringify({ name: adding.name, price: paisa(adding.price), stock: adding.stock ? Number(adding.stock) : null, track_stock: !!adding.stock, negotiable: true, is_active: true }) });
    if (!r.ok) return toast(await apiError(r), 'error');
    setAdding({ name: '', price: '', stock: '' }); toast('Product added', 'success');
    await Promise.all([load(), onChange()]);
  }
  async function importCsv(file: File) {
    const res = await api('/api/v1/admin/products/import', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
    if (!res.ok) return toast(await apiError(res), 'error');
    const r = (await res.json()) as { imported: number; errors: string[]; total: number };
    toast(`Imported ${r.imported}/${r.total}${r.errors.length ? ` · ${r.errors.length} errors` : ''}`, r.errors.length ? 'error' : 'success');
    await Promise.all([load(), onChange()]);
  }

  return (
    <>
      <form onSubmit={add} className="form-row" style={{ marginBottom: 18 }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label htmlFor="np-name">Product</label><input id="np-name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="Lawn kurta" required /></div>
        <div className="field"><label htmlFor="np-price">Price (Rs)</label><input id="np-price" type="number" min="1" step="1" inputMode="numeric" className="mini num" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} required /></div>
        <div className="field"><label htmlFor="np-stock">Stock</label><input id="np-stock" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={adding.stock} onChange={(e) => setAdding({ ...adding, stock: e.target.value })} placeholder="any" /></div>
        <div className="field"><button className="btn"><Plus aria-hidden /> Add</button></div>
        <div className="field"><label className="btn ghost" style={{ margin: 0 }}><FileUp aria-hidden /> Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label></div>
      </form>
      {products === null ? <div className="skeleton" style={{ height: 80 }} /> : products.length === 0 ? <p className="hint">No products yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th className="num">Price</th><th>Status</th></tr></thead>
            <tbody>{products.slice(0, 20).map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{rs(p.price)}</td><td>{p.is_active ? <Pill kind="success">Active</Pill> : <Pill kind="neutral">Hidden</Pill>}</td></tr>)}</tbody>
          </table>
          {products.length > 20 && <p className="hint" style={{ marginTop: 8 }}>{products.length - 20} more in the <Link href="/catalog" className="link">catalog</Link>.</p>}
        </div>
      )}
      <p className="hint" style={{ marginTop: 14 }}>Photos, descriptions and per-product floors live in the <Link href="/catalog" className="link">catalog</Link>.</p>
    </>
  );
}

/** Step 5: COD on/off, bank accounts, and the note shown under the bank details. */
function PaymentPanel({ s, onChange }: { s: Settings; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [cod, setCod] = useState(s.settings.codEnabled !== false);
  const [note, setNote] = useState(s.settings.paymentInstructions ?? '');
  const [bank, setBank] = useState({ bank_name: '', account_title: '', account_number: '' });
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, req: Promise<Response>, ok: string) {
    setBusy(key);
    try {
      const r = await req;
      if (!r.ok) return toast(await apiError(r), 'error');
      toast(ok, 'success');
      await onChange();
    } finally { setBusy(null); }
  }
  const toggleCod = (on: boolean) => { setCod(on); return run('cod', api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { codEnabled: on } }) }), on ? 'Cash on delivery on' : 'Cash on delivery off'); };
  const saveNote = (e: React.FormEvent) => { e.preventDefault(); return run('note', api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { paymentInstructions: note.trim() } }) }), 'Payment note saved'); };
  async function addBank(e: React.FormEvent) {
    e.preventDefault();
    await run('bank', api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ ...bank, is_default: s.bankAccounts.length === 0 }) }), 'Bank account added');
    setBank({ bank_name: '', account_title: '', account_number: '' });
  }
  const delBank = (id: string) => run(id, api(`/api/v1/admin/bank-accounts/${id}`, { method: 'DELETE' }), 'Bank account removed');

  return (
    <>
      <div className="setting-row" style={{ marginBottom: 18 }}>
        <div><div className="t">Cash on delivery</div><div className="d">Buyers pay the rider. The bot confirms the order at once.</div></div>
        <label className="switch"><input type="checkbox" aria-label="Cash on delivery" checked={cod} disabled={busy === 'cod'} onChange={(e) => toggleCod(e.target.checked)} /><span className="track" /></label>
      </div>

      <h3>Bank accounts</h3>
      {s.bankAccounts.length > 0 && (
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead><tr><th>Bank</th><th>Account title</th><th>Account number</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {s.bankAccounts.map((b) => (
                <tr key={b.id}>
                  <td className="strong">{b.bank_name} {b.is_default && <span className="pill brand" style={{ marginLeft: 6 }}>Default</span>}</td>
                  <td>{b.account_title}</td>
                  <td className="mono">{b.account_number}</td>
                  <td className="num"><button type="button" className="btn subtle icon-btn sm" onClick={() => delBank(b.id)} disabled={busy === b.id} aria-label={`Remove ${b.bank_name} account`}><Trash2 /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={addBank} className="form-row" style={{ marginBottom: 22 }}>
        <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="b-name">Bank name</label><input id="b-name" placeholder="e.g. Meezan Bank" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="b-title">Account title</label><input id="b-title" value={bank.account_title} onChange={(e) => setBank({ ...bank, account_title: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 180px' }}><label htmlFor="b-num">Account number / IBAN</label><input id="b-num" className="mono" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} /></div>
        <div className="field"><button className="btn" disabled={!bank.bank_name || !bank.account_number || busy === 'bank'}><Plus aria-hidden /> Add account</button></div>
      </form>

      <form onSubmit={saveNote}>
        <div className="field">
          <label htmlFor="pay-note">Payment note (optional)</label>
          <textarea id="pay-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. JazzCash bhi chalta hai: 0300-1234567" />
          <div className="help">Sent under the bank details when a buyer chooses bank transfer.</div>
        </div>
        <button className="btn" disabled={busy === 'note'}>{busy === 'note' ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />} Save note</button>
      </form>
    </>
  );
}

/** Step 6: name, style, greeting and the two negotiation limits. */
function BotPanel({ s, onChange }: { s: Settings; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ name: s.bot_persona?.name ?? '', style: s.bot_persona?.style ?? 'standard', greeting: s.bot_persona?.greeting ?? '', maxDiscountPct: String(s.negotiation_defaults.maxDiscountPct ?? 15), roundsMax: String(s.negotiation_defaults.roundsMax ?? 3) });
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.name.trim()) return toast('Give the bot a name', 'error');
    const preset = STYLES[f.style] ?? STYLES.standard!;
    setBusy(true);
    try {
      const r = await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({
        botPersona: { name: f.name.trim(), style: f.style, greeting: f.greeting.trim() },
        negotiationDefaults: { maxDiscountPct: Number(f.maxDiscountPct), roundsMax: Number(f.roundsMax), concessionSteps: preset.concessionSteps },
      }) });
      if (!r.ok) return toast(await apiError(r), 'error');
      toast('Bot saved', 'success');
      await onChange();
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <div className="field"><label htmlFor="bot-name">Bot name</label><input id="bot-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Ali Bhai" required maxLength={40} /></div>
      <div className="field">
        <div className="label" id="bot-style">Bargaining style</div>
        <div className="choices" role="radiogroup" aria-labelledby="bot-style">
          {Object.entries(STYLES).map(([key, st]) => (
            <button key={key} type="button" className="choice" role="radio" aria-checked={f.style === key} onClick={() => setF({ ...f, style: key })}>
              <st.Icon aria-hidden /><div><div className="t">{st.label}</div><div className="d">{st.hint}</div></div>
            </button>
          ))}
        </div>
      </div>
      <div className="field"><label htmlFor="bot-greet">Greeting</label><input id="bot-greet" value={f.greeting} onChange={(e) => setF({ ...f, greeting: e.target.value })} placeholder="Assalam-o-Alaikum! Ali Garments mein khush aamdeed." maxLength={200} /><div className="help">The first line a new customer gets. Your business hours are added after it.</div></div>
      <div className="form-row">
        <div className="field"><label htmlFor="bot-maxd">Max discount %</label><input id="bot-maxd" type="number" min="0" max="100" className="mini num" value={f.maxDiscountPct} onChange={(e) => setF({ ...f, maxDiscountPct: e.target.value })} /></div>
        <div className="field"><label htmlFor="bot-rounds">Haggle rounds</label><input id="bot-rounds" type="number" min="1" max="10" className="mini num" value={f.roundsMax} onChange={(e) => setF({ ...f, roundsMax: e.target.value })} /></div>
      </div>
      <button className="btn" disabled={busy}>{busy ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />} Save bot</button>
    </form>
  );
}

/** Step 7: instructions, the shop number, and M3's "send test message". */
function TestOrderPanel({ ok, phone }: { ok: boolean; phone: string | null }) {
  const toast = useToast();
  const [wa, setWa] = useState<{ status: string; displayPhone?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiJson<{ status: string; displayPhone?: string }>('/api/v1/admin/whatsapp').then(setWa).catch(() => setWa({ status: 'none' })); }, []);

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api('/api/v1/admin/whatsapp/test', { method: 'POST' });
      if (!r.ok) return toast(await apiError(r), 'error');
      const st = (await r.json()) as { status: string; message?: string | null };
      toast(st.status === 'connected' ? 'Test message sent to your phone' : st.status === 'connecting' ? 'Your 24-hour window has closed — text your shop number again first' : st.message ?? 'Could not send', st.status === 'connected' ? 'success' : 'info');
    } finally { setBusy(false); }
  }

  if (ok) return <p className="hint">Your test order is in. Press <strong>Go live</strong> when the other steps are green.</p>;
  return (
    <>
      <ol style={{ paddingLeft: 20, display: 'grid', gap: 6, marginBottom: 16 }}>
        <li>From <strong>{pretty(phone)}</strong> (the number in step 1), message your shop number{wa?.displayPhone ? <>: <span className="mono">{pretty(wa.displayPhone)}</span></> : ''}.</li>
        <li>Ask for a product, haggle if you like, give an address and choose how to pay.</li>
        <li>When the order is placed, this step turns green.</li>
      </ol>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {wa?.displayPhone && <a className="btn ghost" href={`https://wa.me/${wa.displayPhone}?text=hi`} target="_blank" rel="noreferrer"><Smartphone aria-hidden /> Open WhatsApp</a>}
        <button type="button" className="btn ghost" onClick={sendTest} disabled={busy || wa?.status !== 'connected'}><Send aria-hidden /> {busy ? 'Sending…' : 'Send test message'}</button>
      </div>
      {wa && wa.status !== 'connected' && <p className="hint" style={{ marginTop: 10 }}>Connect your number in step 2 first.</p>}
    </>
  );
}
