'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Check, Loader2, Plus, Rocket, Trash2 } from 'lucide-react';
import AppShell, { PageHead, Pill } from '../../components/AppShell';
import { api, apiError, apiJson, rs } from '../../lib/api';
import { useToast } from '../../components/Toast';

type StepKey = 'profile' | 'whatsapp' | 'catalog' | 'delivery' | 'payment' | 'persona' | 'testOrder';
interface StepResult { ok: boolean; reason?: string; problem?: boolean }
interface Readiness { steps: Record<StepKey, StepResult>; ready: boolean; failing: StepKey[] }
interface Zone { id: string; area_name: string; city: string | null; charge: number; is_serviceable: boolean; eta_text: string | null }
interface Settings {
  settings: { botEnabled?: boolean; defaultDeliveryCharge?: number; freeDeliveryThreshold?: number; deliveryConfigured?: boolean };
  deliveryZones: Zone[];
}

/** The seven steps, in order. The server decides which are done (GET /admin/readiness). */
const STEPS: { key: StepKey; label: string; title: string; hint: string; link?: { href: string; label: string } }[] = [
  { key: 'profile', label: 'Shop', title: 'Your shop', hint: 'Name, category, business hours and the two attestations you accepted at signup.', link: { href: '/settings', label: 'Open settings' } },
  { key: 'whatsapp', label: 'WhatsApp', title: 'Connect WhatsApp', hint: 'The number the bot answers from. Connect it through Meta, then send it one message from your phone.', link: { href: '/settings/whatsapp', label: 'Connect WhatsApp' } },
  { key: 'catalog', label: 'Products', title: 'Add your products', hint: 'One priced product is enough to start. Add them one by one, or import a CSV.', link: { href: '/catalog', label: 'Open catalog' } },
  { key: 'delivery', label: 'Delivery', title: 'Delivery areas and charges', hint: 'The bot quotes these when a buyer gives an address. An area you mark as not serviceable is refused politely.' },
  { key: 'payment', label: 'Payment', title: 'How buyers pay', hint: 'Cash on delivery, a bank account for transfers, or both.', link: { href: '/settings', label: 'Open settings' } },
  { key: 'persona', label: 'Bot', title: 'Your bot', hint: 'A name and a bargaining style: narm, standard or sakht.', link: { href: '/settings', label: 'Open settings' } },
  { key: 'testOrder', label: 'Test order', title: 'Place a test order', hint: 'Message your shop number from your own phone and buy something, start to finish. The step turns green when the order is placed.', link: { href: '/settings/whatsapp', label: 'Send a test message' } },
];
const rupees = (v: string): number => Math.round(Number(v || 0) * 100);

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
          {step.key === 'delivery'
            ? (s ? <DeliveryPanel s={s} onChange={load} /> : <div className="skeleton" style={{ height: 160 }} />)
            : step.link && <Link href={step.link.href} className="btn">{step.link.label} <ArrowRight aria-hidden /></Link>}
        </div>
      </div>
    </AppShell>
  );
}

/** Step 4: the zones table, the default charge for unlisted areas, and the free-delivery threshold. */
function DeliveryPanel({ s, onChange }: { s: Settings; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [zone, setZone] = useState({ area_name: '', city: '', charge: '', eta_text: '' });
  const [defaults, setDefaults] = useState({
    charge: String((s.settings.defaultDeliveryCharge ?? 0) / 100),
    free: String((s.settings.freeDeliveryThreshold ?? 0) / 100),
    everywhere: s.settings.deliveryConfigured === true,
  });
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

  async function addZone(e: React.FormEvent) {
    e.preventDefault();
    if (zone.area_name.trim().length < 2) return toast('Enter the area name', 'error');
    await run('add', api('/api/v1/admin/delivery-zones', { method: 'POST', body: JSON.stringify({ area_name: zone.area_name, city: zone.city, charge: rupees(zone.charge), eta_text: zone.eta_text }) }), 'Area added');
    setZone({ area_name: '', city: '', charge: '', eta_text: '' });
  }
  const toggle = (z: Zone) => run(z.id, api(`/api/v1/admin/delivery-zones/${z.id}`, { method: 'PATCH', body: JSON.stringify({ is_serviceable: !z.is_serviceable }) }), z.is_serviceable ? `${z.area_name}: not serviceable` : `${z.area_name}: serviceable`);
  const remove = (z: Zone) => run(z.id, api(`/api/v1/admin/delivery-zones/${z.id}`, { method: 'DELETE' }), 'Area removed');
  const saveDefaults = (e: React.FormEvent) => {
    e.preventDefault();
    return run('defaults', api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { defaultDeliveryCharge: rupees(defaults.charge), freeDeliveryThreshold: rupees(defaults.free), deliveryConfigured: defaults.everywhere } }) }), 'Delivery charges saved');
  };

  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Area</th><th>City</th><th className="num">Charge</th><th>ETA</th><th>Serviceable</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {s.deliveryZones.length === 0 && <tr><td colSpan={6} className="hint">No areas yet. Add the areas you deliver to, or tick “one charge for everywhere” below.</td></tr>}
            {s.deliveryZones.map((z) => (
              <tr key={z.id}>
                <td>{z.area_name}</td>
                <td>{z.city ?? '—'}</td>
                <td className="num">{rs(z.charge)}</td>
                <td>{z.eta_text ?? '—'}</td>
                <td><label className="switch"><input type="checkbox" aria-label={`${z.area_name} serviceable`} checked={z.is_serviceable} disabled={busy === z.id} onChange={() => toggle(z)} /><span className="track" /></label></td>
                <td><button type="button" className="btn subtle icon-btn sm" aria-label={`Remove ${z.area_name}`} disabled={busy === z.id} onClick={() => remove(z)}><Trash2 /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addZone} className="form-row" style={{ marginBottom: 22 }}>
        <div className="field"><label htmlFor="z-area">Area</label><input id="z-area" value={zone.area_name} onChange={(e) => setZone({ ...zone, area_name: e.target.value })} placeholder="Model Town" required /></div>
        <div className="field"><label htmlFor="z-city">City</label><input id="z-city" value={zone.city} onChange={(e) => setZone({ ...zone, city: e.target.value })} placeholder="Lahore" /></div>
        <div className="field"><label htmlFor="z-charge">Charge (Rs)</label><input id="z-charge" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={zone.charge} onChange={(e) => setZone({ ...zone, charge: e.target.value })} /></div>
        <div className="field"><label htmlFor="z-eta">ETA</label><input id="z-eta" value={zone.eta_text} onChange={(e) => setZone({ ...zone, eta_text: e.target.value })} placeholder="1–2 din" /></div>
        <div className="field"><button className="btn" disabled={busy === 'add'}><Plus aria-hidden /> Add area</button></div>
      </form>

      <form onSubmit={saveDefaults}>
        <h3>Everywhere else</h3>
        <div className="form-row">
          <div className="field"><label htmlFor="d-charge">Default charge (Rs)</label><input id="d-charge" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={defaults.charge} onChange={(e) => setDefaults({ ...defaults, charge: e.target.value })} /></div>
          <div className="field"><label htmlFor="d-free">Free delivery above (Rs)</label><input id="d-free" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={defaults.free} onChange={(e) => setDefaults({ ...defaults, free: e.target.value })} /></div>
        </div>
        <div className="field">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
            <input type="checkbox" checked={defaults.everywhere} onChange={(e) => setDefaults({ ...defaults, everywhere: e.target.checked })} style={{ marginTop: 3 }} />
            <span>I deliver everywhere at the default charge — no areas list needed.</span>
          </label>
          <div className="help">Buyers outside your listed areas get the default charge; set to 0 for free delivery.</div>
        </div>
        <button className="btn" disabled={busy === 'defaults'}>{busy === 'defaults' ? <Loader2 className="spin" aria-hidden /> : null} Save charges</button>
      </form>
    </>
  );
}
