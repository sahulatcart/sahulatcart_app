'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { signIn } from '../../lib/api';
import AuthLayout from '../../components/AuthLayout';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const ok = await signIn(email.trim(), pw).catch(() => 'Could not sign in. Please try again.');
    setBusy(false);
    if (ok === true) router.replace('/');
    else setErr(ok);
  }

  return (
    <AuthLayout title="Sign in" hint="Use the email your shop account was created with.">
      <form onSubmit={submit} noValidate>
        {err && <div className="form-error" role="alert"><AlertCircle aria-hidden />{err}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@shop.com" required />
        </div>
        <div className="field">
          <div className="row between" style={{ marginBottom: 6 }}>
            <label htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
            <Link href="/reset" className="hint">Forgot password?</Link>
          </div>
          <div className="input-affix">
            <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required style={{ paddingRight: 48 }} />
            <button type="button" className="btn subtle icon-btn sm affix-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          </div>
        </div>
        <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? <><Loader2 className="spin" aria-hidden /> Signing in…</> : <>Sign in <ArrowRight aria-hidden /></>}
        </button>
      </form>
      <p className="hint" style={{ marginTop: 18, marginBottom: 0 }}>
        New here? <Link href="/signup">Create your shop account</Link>
      </p>
    </AuthLayout>
  );
}
