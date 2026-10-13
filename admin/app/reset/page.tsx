'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, MailCheck } from 'lucide-react';
import { sendPasswordReset } from '../../lib/api';
import AuthLayout from '../../components/AuthLayout';

export default function ResetPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    // Always "sent": whether the email has an account is not something to reveal here.
    await sendPasswordReset(email.trim()).catch(() => {});
    setBusy(false);
    setSent(true);
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
