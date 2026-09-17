'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { signIn } from '../../lib/api';
import Wordmark from '../../components/Wordmark';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
// Marketing site. Set NEXT_PUBLIC_SITE_URL per environment; the default is the
// domain given in the brand guidelines.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.sahulatcart.com';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
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
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: 'radial-gradient(1200px 500px at 50% -10%, var(--brand-tint), var(--bg))' }}>
      <div className="card pad" style={{ width: 380, boxShadow: 'var(--shadow-lg)' }}>
        <div className="row" style={{ marginBottom: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={46} height={38} style={{ display: 'block', flex: 'none' }} />
          <div><div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}><Wordmark name={PRODUCT_NAME} /></div><div className="hint">Merchant Admin</div></div>
        </div>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@shop.com" /></div>
          <div className="field"><label>Password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /></div>
          {err && <div className="pill danger" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? <Loader2 className="spin" /> : <>Log in <ArrowRight /></>}</button>
        </form>
        {/* Secondary by design — "Log in" is the one accent action on this
            screen (brand guidelines §25), so this stays a quiet text link. */}
        <a className="back-to-site" href={siteUrl}>
          <ArrowLeft /> Back to website
        </a>
      </div>
    </div>
  );
}
