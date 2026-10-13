'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { updatePassword } from '../../../lib/api';
import { getSupabase } from '../../../lib/supabase';
import AuthLayout from '../../../components/AuthLayout';

/** Where the password-reset email lands: the recovery session is in the URL hash. */
export default function NewPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<'checking' | 'ok' | 'no_session'>('checking');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Review P1-10: only a recovery link may set a new password without the old one. The link's
    // hash says type=recovery and the client fires PASSWORD_RECOVERY; a plain signed-in visit gets neither.
    let cancelled = false;
    const fromLink = /type=recovery/.test(window.location.hash);
    let unsub = () => {};
    (async () => {
      const sb = await getSupabase();
      const { data: sub } = sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY' && !cancelled) setReady('ok'); });
      unsub = () => sub.subscription.unsubscribe();
      let { data } = await sb.auth.getSession();
      if (!data.session) { await new Promise((r) => setTimeout(r, 800)); ({ data } = await sb.auth.getSession()); }
      if (!cancelled) setReady((prev) => (prev === 'ok' ? 'ok' : data.session && fromLink ? 'ok' : 'no_session'));
    })().catch(() => { if (!cancelled) setReady('no_session'); });
    return () => { cancelled = true; unsub(); };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) return setErr('Password must be at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    const problem = await updatePassword(pw).catch(() => 'Could not update the password.');
    setBusy(false);
    if (problem) setErr(problem);
    else router.replace('/');
  }

  if (ready === 'checking') {
    return (
      <AuthLayout title="Reset your password">
        <p className="hint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 0 }}><Loader2 className="spin" aria-hidden /> One moment…</p>
      </AuthLayout>
    );
  }
  if (ready === 'no_session') {
    return (
      <AuthLayout title="Link expired">
        <p className="hint">This reset link has expired or was already used. Request a new one.</p>
        <p className="hint" style={{ marginBottom: 0 }}><Link href="/reset">Send a new link</Link> · <Link href="/login">Sign in</Link></p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password">
      <form onSubmit={submit} noValidate>
        {err && <div className="form-error" role="alert"><AlertCircle aria-hidden />{err}</div>}
        <div className="field">
          <label htmlFor="password">New password</label>
          <div className="input-affix">
            <input id="password" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required style={{ paddingRight: 48 }} />
            <button type="button" className="btn subtle icon-btn sm affix-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          </div>
          <div className="help">At least 8 characters.</div>
        </div>
        <div className="field">
          <label htmlFor="password2">Repeat new password</label>
          <input id="password2" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        </div>
        <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? <><Loader2 className="spin" aria-hidden /> Saving…</> : <>Save password <ArrowRight aria-hidden /></>}
        </button>
      </form>
    </AuthLayout>
  );
}
