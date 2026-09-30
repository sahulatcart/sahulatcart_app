'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, MessagesSquare, ShieldCheck, Wallet } from 'lucide-react';
import { signIn } from '../../lib/api';
import Wordmark from '../../components/Wordmark';
import ThemeToggle from '../../components/ThemeToggle';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
// Marketing site. Set NEXT_PUBLIC_SITE_URL per environment; the default is the
// domain given in the brand guidelines.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.sahulatcart.com';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [siteUrl, setSiteUrl] = useState(SITE_URL);

  // Locally the marketing site runs beside the portal on :4173. Resolved after
  // mount so the server-rendered href stays the production one (no hydration
  // mismatch), then swapped in the browser when we're on localhost.
  useEffect(() => {
    const { hostname, protocol } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      setSiteUrl(`${protocol}//${hostname}:4173`);
    }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const ok = await signIn(email.trim(), pw).catch(() => false);
    setBusy(false);
    if (ok) router.replace('/');
    else setErr('Wrong email or password.');
  }

  return (
    <div className="auth">
      {/* Brand panel — dark forest, so only the standalone mark appears here: the
          two-tone wordmark is only sanctioned on light surfaces. */}
      <section className="auth-brand" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="mark" src="/logo.svg" alt="" width={48} height={40} />
        <div>
          <h2>Your WhatsApp sales agent, working while you rest.</h2>
          <p className="lede">Watch every chat, verify payments and manage your catalog — all from one place.</p>
          <ul className="auth-points">
            <li><MessagesSquare /> Sells and haggles with buyers in Roman Urdu, day and night.</li>
            <li><ShieldCheck /> Never goes below the prices you set.</li>
            <li><Wallet /> Cash on delivery or bank transfer — you verify every payment.</li>
          </ul>
        </div>
        <div className="foot">© {PRODUCT_NAME}</div>
      </section>

      <section className="auth-form">
        <ThemeToggle className="auth-theme" />
        <div className="auth-card">
          <div className="card">
            <div className="row" style={{ gap: 10 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="" width={38} height={32} style={{ display: 'block', flex: 'none' }} />
              <span style={{ fontSize: 19 }}><Wordmark name={PRODUCT_NAME} /></span>
            </div>
            <h1>Sign in</h1>
            <p className="hint" style={{ marginBottom: 22 }}>Use the email your shop account was created with.</p>

            <form onSubmit={submit} noValidate>
              {err && <div className="form-error" role="alert"><AlertCircle aria-hidden />{err}</div>}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@shop.com" required />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="input-affix">
                  <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required style={{ paddingRight: 48 }} />
                  <button type="button" className="btn subtle icon-btn sm affix-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                    {show ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </div>
              <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
                {busy ? <><Loader2 className="spin" aria-hidden /> Signing in…</> : <>Sign in <ArrowRight aria-hidden /></>}
              </button>
            </form>
          </div>
          {/* Secondary by design — "Sign in" is the one accent action on this screen. */}
          <a className="back-to-site" href={siteUrl}><ArrowLeft aria-hidden /> Back to website</a>
        </div>
      </section>
    </div>
  );
}
