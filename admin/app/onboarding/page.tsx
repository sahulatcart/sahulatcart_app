'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2, Rocket, Sparkles } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { api, apiError } from '../../lib/api';
import { useToast } from '../../components/Toast';

const STEPS = ['Business', 'Negotiation', 'Bank', 'Bot', 'Go live'];

export default function Onboarding() {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ businessName: '', maxDiscountPct: 15, roundsMax: 3, bank_name: '', account_title: '', account_number: '', botName: '', greeting: '' });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const patch = (body: object) => api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(body) });
  // One request per step (null = nothing to save); a failed save keeps the owner on that step.
  const steps: (() => Promise<Response> | null)[] = [
    () => (f.businessName ? patch({ businessName: f.businessName }) : null),
    () => patch({ negotiationDefaults: { maxDiscountPct: Number(f.maxDiscountPct), roundsMax: Number(f.roundsMax) } }),
    () => (f.bank_name && f.account_number ? api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ bank_name: f.bank_name, account_title: f.account_title, account_number: f.account_number, is_default: true }) }) : null),
    () => (f.botName || f.greeting ? patch({ botPersona: { name: f.botName, greeting: f.greeting } }) : null),
    () => patch({ settings: { onboardingCompletedAt: new Date().toISOString(), botEnabled: true } }),
  ];

  async function next() {
    setBusy(true);
    try {
      const r = await steps[step]!();
      if (r && !r.ok) return toast(await apiError(r), 'error');
      if (step === steps.length - 1) { toast('You\'re live — the bot is now selling on WhatsApp', 'success'); router.replace('/'); return; }
      setStep((x) => x + 1);
    } finally { setBusy(false); }
  }

  const last = step === STEPS.length - 1;
  return (
    <AppShell>
      <PageHead title="Set up your shop" sub={`Step ${step + 1} of ${STEPS.length} — a few quick steps to go live`} />
      <ol className="steps" aria-label="Setup progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="n">{i < step ? <Check size={13} aria-label="done" /> : i + 1}</span>{label}
          </li>
        ))}
      </ol>

      <div className="card pad" style={{ maxWidth: 560 }}>
        {step === 0 && <>
          <h2>Business name</h2><p className="hint" style={{ marginBottom: 14 }}>Shown to customers on WhatsApp. The bot introduces itself with it.</p>
          <div className="field"><label htmlFor="ob-name">Business name</label><input id="ob-name" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="e.g. Ali Garments" autoFocus /></div>
        </>}
        {step === 1 && <>
          <h2>Negotiation</h2><p className="hint" style={{ marginBottom: 14 }}>How much the bot may discount, and how many rounds it haggles. You can change these later.</p>
          <div className="form-row">
            <div className="field"><label htmlFor="ob-maxd">Max discount %</label><input id="ob-maxd" type="number" min="0" max="100" value={f.maxDiscountPct} onChange={(e) => set('maxDiscountPct', e.target.value)} className="mini num" /></div>
            <div className="field"><label htmlFor="ob-rounds">Haggle rounds</label><input id="ob-rounds" type="number" min="1" max="10" value={f.roundsMax} onChange={(e) => set('roundsMax', e.target.value)} className="mini num" /></div>
          </div>
        </>}
        {step === 2 && <>
          <h2>Bank account</h2><p className="hint" style={{ marginBottom: 14 }}>Shown to buyers who pay by bank transfer. Skip this if you only take cash on delivery.</p>
          <div className="field"><label htmlFor="ob-bank">Bank name</label><input id="ob-bank" value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. Meezan Bank" /></div>
          <div className="field"><label htmlFor="ob-title">Account title</label><input id="ob-title" value={f.account_title} onChange={(e) => set('account_title', e.target.value)} /></div>
          <div className="field"><label htmlFor="ob-num">Account number / IBAN</label><input id="ob-num" className="mono" value={f.account_number} onChange={(e) => set('account_number', e.target.value)} /></div>
        </>}
        {step === 3 && <>
          <h2>Bot personality</h2><p className="hint" style={{ marginBottom: 14 }}>Both optional — the bot works fine without them.</p>
          <div className="field"><label htmlFor="ob-bot">Bot name</label><input id="ob-bot" value={f.botName} onChange={(e) => set('botName', e.target.value)} placeholder="e.g. Ali Bhai" /></div>
          <div className="field"><label htmlFor="ob-greet">Greeting</label><input id="ob-greet" value={f.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="Assalam-o-Alaikum! Kaise madad karoon?" /></div>
        </>}
        {step === 4 && <>
          <div className="empty-ico" style={{ margin: '0 0 14px', width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--brand-tint)', color: 'var(--brand)' }}><Sparkles size={20} aria-hidden /></div>
          <h2>Almost done</h2>
          <p className="hint">Add your products in the <Link href="/catalog" className="link">Catalog</Link> — manually, by CSV, or from Meta. Then go live and the bot starts selling on WhatsApp.</p>
        </>}
        <div className="row between" style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
          <button className="btn ghost" onClick={() => setStep((x) => Math.max(0, x - 1))} disabled={step === 0 || busy}><ArrowLeft aria-hidden /> Back</button>
          <button className="btn" onClick={next} disabled={busy}>
            {busy ? <Loader2 className="spin" aria-hidden /> : null}
            {last ? <>Go live {!busy && <Rocket aria-hidden />}</> : <>{step === 2 && !(f.bank_name && f.account_number) ? 'Skip' : 'Next'} {!busy && <ArrowRight aria-hidden />}</>}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
