'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Rocket } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { api } from '../../lib/api';
import { useToast } from '../../components/Toast';

const STEPS = ['Business', 'Negotiation', 'Bank', 'Bot', 'Go live'];

export default function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ businessName: '', maxDiscountPct: 15, roundsMax: 3, bank_name: '', account_title: '', account_number: '', botName: '', greeting: '' });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function next() {
    setBusy(true);
    try {
      if (step === 0 && f.businessName) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ businessName: f.businessName }) });
      if (step === 1) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ negotiationDefaults: { maxDiscountPct: Number(f.maxDiscountPct), roundsMax: Number(f.roundsMax) } }) });
      if (step === 2 && f.bank_name && f.account_number) await api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ bank_name: f.bank_name, account_title: f.account_title, account_number: f.account_number, is_default: true }) });
      if (step === 3 && (f.botName || f.greeting)) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ botPersona: { name: f.botName, greeting: f.greeting } }) });
      if (step === 4) { await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { onboardingCompletedAt: new Date().toISOString(), botEnabled: true } }) }); toast('You\'re live! 🎉', 'success'); router.replace('/'); return; }
      setStep((x) => x + 1);
    } finally { setBusy(false); }
  }

  return (
    <AppShell>
      <PageHead title="Set up your shop" sub="A few quick steps to go live" />
      <div className="row" style={{ gap: 8, marginBottom: 18 }}>
        {STEPS.map((label, i) => (
          <div key={label} className="row" style={{ gap: 7 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, background: i < step ? 'var(--brand)' : i === step ? 'var(--brand-tint-2)' : 'var(--surface-2)', color: i < step ? '#fff' : i === step ? 'var(--brand-ink)' : 'var(--faint)' }}>{i < step ? <Check size={13} /> : i + 1}</div>
            <span className="hint" style={{ color: i === step ? 'var(--ink)' : undefined, fontWeight: i === step ? 600 : 400 }}>{label}</span>
          </div>
        ))}
      </div>

      <div className="card pad" style={{ maxWidth: 540 }}>
        {step === 0 && <><h2>Business name</h2><p className="hint">Shown to customers on WhatsApp.</p><input value={f.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="e.g. Ali Garments" /></>}
        {step === 1 && <><h2>Negotiation</h2><p className="hint">How much the bot may discount, and how many rounds it haggles.</p><div className="row"><div className="field" style={{ margin: 0 }}><label>Max discount %</label><input type="number" value={f.maxDiscountPct} onChange={(e) => set('maxDiscountPct', e.target.value)} className="mini" /></div><div className="field" style={{ margin: 0 }}><label>Haggle rounds</label><input type="number" value={f.roundsMax} onChange={(e) => set('roundsMax', e.target.value)} className="mini" /></div></div></>}
        {step === 2 && <><h2>Bank account</h2><p className="hint">Shown to buyers who pay by bank transfer. Skip if COD-only.</p><div className="field"><label>Bank name</label><input value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} /></div><div className="field"><label>Account title</label><input value={f.account_title} onChange={(e) => set('account_title', e.target.value)} /></div><div className="field" style={{ margin: 0 }}><label>Account number / IBAN</label><input value={f.account_number} onChange={(e) => set('account_number', e.target.value)} /></div></>}
        {step === 3 && <><h2>Bot personality</h2><div className="field"><label>Bot name (optional)</label><input value={f.botName} onChange={(e) => set('botName', e.target.value)} placeholder="e.g. Ali Bhai" /></div><div className="field" style={{ margin: 0 }}><label>Greeting (optional)</label><input value={f.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="Assalam-o-Alaikum! Kaise madad karoon?" /></div></>}
        {step === 4 && <><h2>Almost done! 🎉</h2><p>Add your products in the <Link href="/catalog" style={{ color: 'var(--brand-ink)', fontWeight: 600 }}>Catalog</Link> (manually, by CSV, or from Meta). Then go live — the bot starts selling on WhatsApp.</p></>}
        <div className="row between" style={{ marginTop: 22 }}>
          <button className="btn ghost" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0 || busy}><ArrowLeft /> Back</button>
          <button className="btn" onClick={next} disabled={busy}>{step === STEPS.length - 1 ? <>Go live <Rocket /></> : <>Next <ArrowRight /></>}</button>
        </div>
      </div>
    </AppShell>
  );
}
