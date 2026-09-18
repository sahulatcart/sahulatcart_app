'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { signIn } from '../../lib/api';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

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
          <span style={{ width: 38, height: 38, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--brand), var(--brand-strong))', color: '#fff', fontWeight: 800, fontSize: 18 }}>{PRODUCT_NAME.charAt(0)}</span>
          <div><div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-.02em' }}>{PRODUCT_NAME}</div><div className="hint">Merchant Admin</div></div>
        </div>
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="you@shop.com" /></div>
          <div className="field"><label>Password</label><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /></div>
          {err && <div className="pill danger" style={{ marginBottom: 12 }}>{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? <Loader2 className="spin" /> : <>Log in <ArrowRight /></>}</button>
        </form>
      </div>
    </div>
  );
}
