'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '../../lib/api';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const ok = await login(pw).catch(() => false);
    setBusy(false);
    if (ok) router.replace('/');
    else setErr('Galat password. Dobara koshish karein.');
  }

  return (
    <div style={{ maxWidth: 360, margin: '10vh auto', padding: 24 }}>
      <div className="section">
        <h1 style={{ color: 'var(--brand)', marginTop: 0 }}>{PRODUCT_NAME}</h1>
        <p style={{ color: 'var(--muted)', marginTop: -8 }}>Merchant Admin</p>
        <form onSubmit={submit}>
          <label>Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ width: '100%' }} autoFocus />
          {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
          <button className="btn" style={{ width: '100%', marginTop: 14 }} disabled={busy}>
            {busy ? '...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
