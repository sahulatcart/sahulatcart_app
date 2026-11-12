'use client';
import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Loader2, MailCheck } from 'lucide-react';
import { sendPasswordReset } from '../../lib/api';
import AuthLayout from '../../components/AuthLayout';

export default function ResetPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!email.trim()) return setErr('Enter your email.');
    setBusy(true);
    // Supabase answers a known and an unknown email alike, so a "sent" here reveals nothing. Its errors
    // (rate limit, mailer down) are shown: swallowing them made a failed send look sent (2026-11-12).
    const problem = await sendPasswordReset(email.trim()).catch(() => 'We could not send the reset email right now. Try again in a few minutes.');
    setBusy(false);
    if (problem) setErr(problem);
    else setSent(true);
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <p className="hint" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <MailCheck aria-hidden style={{ flex: 'none', width: 18, height: 18, marginTop: 2 }} />
          <span>If <b>{email.trim()}</b> has an account, a reset link is on its way. Open it on this device.</span>
        </p>
        <p className="hint" style={{ marginBottom: 0 }}><Link href="/login">Back to sign in</Link></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" hint="Enter your email and we will send you a link.">
      <form onSubmit={submit} noValidate>
        {err && <div className="form-error" role="alert"><AlertCircle aria-hidden />{err}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@shop.com" required />
        </div>
        <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? <><Loader2 className="spin" aria-hidden /> Sending…</> : <>Send reset link <ArrowRight aria-hidden /></>}
        </button>
      </form>
      <p className="hint" style={{ marginTop: 18, marginBottom: 0 }}><Link href="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
}
