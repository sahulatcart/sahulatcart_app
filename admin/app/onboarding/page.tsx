'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '../../components/AppShell';
import { api } from '../../lib/api';

const STEPS = ['Business', 'Negotiation', 'Bank', 'Bot', 'Go live'];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    businessName: '', maxDiscountPct: 15, roundsMax: 3,
    bank_name: '', account_title: '', account_number: '',
    botName: '', greeting: '',
  });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function next() {
    setBusy(true);
    try {
      if (step === 0 && f.businessName) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ businessName: f.businessName }) });
      if (step === 1) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ negotiationDefaults: { maxDiscountPct: Number(f.maxDiscountPct), roundsMax: Number(f.roundsMax) } }) });
      if (step === 2 && f.bank_name && f.account_number) await api('/api/v1/admin/bank-accounts', { method: 'POST', body: JSON.stringify({ bank_name: f.bank_name, account_title: f.account_title, account_number: f.account_number, is_default: true }) });
      if (step === 3 && (f.botName || f.greeting)) await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ botPersona: { name: f.botName, greeting: f.greeting } }) });
      if (step === 4) {
        await api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { onboardingCompletedAt: new Date().toISOString(), botEnabled: true } }) });
        router.replace('/');
        return;
      }
      setStep((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1>Setup</h1>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        {STEPS.map((s, i) => (
          <span key={s} className={`badge ${i === step ? 'info' : i < step ? 'ok' : ''}`} style={{ border: '1px solid var(--line)' }}>{i + 1}. {s}</span>
        ))}
      </div>

      <div className="section" style={{ maxWidth: 520 }}>
        {step === 0 && (
          <>
            <h2>Business name</h2>
            <p style={{ color: 'var(--muted)' }}>Shown to customers on WhatsApp.</p>
            <input style={{ width: '100%' }} value={f.businessName} onChange={(e) => set('businessName', e.target.value)} placeholder="e.g. Ali Garments" />
          </>
        )}
        {step === 1 && (
          <>
            <h2>Negotiation</h2>
            <p style={{ color: 'var(--muted)' }}>How much the bot may discount, and how many rounds it haggles.</p>
            <div className="row">
              <div><label>Max discount %</label><input type="number" value={f.maxDiscountPct} onChange={(e) => set('maxDiscountPct', e.target.value)} style={{ width: 100 }} /></div>
              <div><label>Haggle rounds</label><input type="number" value={f.roundsMax} onChange={(e) => set('roundsMax', e.target.value)} style={{ width: 100 }} /></div>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h2>Bank account</h2>
            <p style={{ color: 'var(--muted)' }}>Shown to buyers who pay by bank transfer. (Skip if COD-only.)</p>
            <label>Bank name</label><input style={{ width: '100%' }} value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
            <label style={{ marginTop: 8 }}>Account title</label><input style={{ width: '100%' }} value={f.account_title} onChange={(e) => set('account_title', e.target.value)} />
            <label style={{ marginTop: 8 }}>Account number / IBAN</label><input style={{ width: '100%' }} value={f.account_number} onChange={(e) => set('account_number', e.target.value)} />
          </>
        )}
        {step === 3 && (
          <>
            <h2>Bot personality</h2>
            <label>Bot name (optional)</label><input style={{ width: '100%' }} value={f.botName} onChange={(e) => set('botName', e.target.value)} placeholder="e.g. Ali Bhai" />
            <label style={{ marginTop: 8 }}>Greeting (optional)</label><input style={{ width: '100%' }} value={f.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder="Assalam-o-Alaikum! Kaise madad karoon?" />
          </>
        )}
        {step === 4 && (
          <>
            <h2>Almost done!</h2>
            <p>Add your products in the <Link href="/catalog">Catalog</Link> (manually, by CSV, or from your Meta catalog). Then go live — the bot starts replying to customers on WhatsApp.</p>
          </>
        )}
        <div className="row" style={{ marginTop: 20, justifyContent: 'space-between' }}>
          <button className="btn sec" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>Back</button>
          <button className="btn" onClick={next} disabled={busy}>{step === STEPS.length - 1 ? 'Go live 🚀' : 'Next'}</button>
        </div>
      </div>
    </AppShell>
  );
}
