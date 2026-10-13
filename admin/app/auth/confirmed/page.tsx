'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { apiError, bootstrap } from '../../../lib/api';
import { ArrowRight } from 'lucide-react';
import { getSupabase } from '../../../lib/supabase';
import AuthLayout, { useSiteUrl } from '../../../components/AuthLayout';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';

/**
 * Where the confirmation email lands. Supabase puts the session in the URL hash and the client
 * picks it up; then one call turns the login into a shop (idempotent, so a returning user with
 * no shop is sent here too) and we continue to onboarding.
 */
export default function ConfirmedPage() {
  const router = useRouter();
  const siteUrl = useSiteUrl();
  const [state, setState] = useState<'working' | 'no_session' | 'closed' | 'error' | 'details'>('working');
  const [msg, setMsg] = useState('');
  // Review P1-4: a user whose auth record has no shop details (created in the dashboard, or an old
  // link) used to get a 400 and loop login → here → 400. They fill the three fields here instead.
  const [f, setF] = useState({ shopName: '', ownerName: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const go = useCallback((r: { existing?: boolean }) => router.replace(r.existing ? '/' : '/onboarding'), [router]);
  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg('');
    const r = await bootstrap({ shopName: f.shopName.trim(), ownerName: f.ownerName.trim(), phone: f.phone.trim() });
    setBusy(false);
    if (r.ok) return go(await r.json());
    if (r.status === 403) return setState('closed');
    setMsg(await apiError(r));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = await getSupabase();
      // The hash is parsed on client creation; give a slow parse one more chance before giving up.
      let { data } = await sb.auth.getSession();
      if (!data.session) { await new Promise((r) => setTimeout(r, 800)); ({ data } = await sb.auth.getSession()); }
      if (cancelled) return;
      if (!data.session) return setState('no_session');
      const r = await bootstrap();
      if (cancelled) return;
      if (r.ok) { go(await r.json()); return; }
      if (r.status === 403) return setState('closed');
      if (r.status === 400) return setState('details');
      setMsg(await apiError(r));
      setState('error');
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [router, go]);

  if (state === 'working') {
    return (
      <AuthLayout title="Setting up your shop">
        <p className="hint" style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 0 }}><Loader2 className="spin" aria-hidden /> One moment…</p>
      </AuthLayout>
    );
  }
  if (state === 'closed') {
    return (
      <AuthLayout title="Private pilot">
        <p className="hint">Your email is confirmed, but {PRODUCT_NAME} is in private pilot; email us to join and we will switch your shop on.</p>
        <p className="hint" style={{ marginBottom: 0 }}><a href={`${siteUrl}/support.html`}>Contact us</a></p>
      </AuthLayout>
    );
  }
  if (state === 'details') {
    return (
      <AuthLayout title="A few details to open your shop" hint="Your email is confirmed. We just need the shop name, your name and your WhatsApp number.">
        <form onSubmit={submitDetails} noValidate>
          {msg && <div className="form-error" role="alert"><AlertCircle aria-hidden />{msg}</div>}
          <div className="field"><label htmlFor="d-shop">Shop name</label><input id="d-shop" value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} maxLength={80} required /></div>
          <div className="field"><label htmlFor="d-owner">Your name</label><input id="d-owner" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} maxLength={80} required /></div>
          <div className="field"><label htmlFor="d-phone">Your WhatsApp number</label><input id="d-phone" inputMode="tel" placeholder="+92 300 1234567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required /></div>
          <button className="btn block" disabled={busy || f.shopName.trim().length < 2 || f.ownerName.trim().length < 2 || !f.phone.trim()}>{busy ? <><Loader2 className="spin" aria-hidden /> Opening…</> : <>Open my shop <ArrowRight aria-hidden /></>}</button>
        </form>
      </AuthLayout>
    );
  }
  if (state === 'no_session') {
    return (
      <AuthLayout title="Link expired">
        <p className="hint">This confirmation link has expired or was already used. Sign in to continue; if your email is not confirmed yet, sign up again to get a new link.</p>
        <p className="hint" style={{ marginBottom: 0 }}><Link href="/login">Sign in</Link> · <Link href="/signup">Sign up</Link></p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Something went wrong">
      <div className="form-error" role="alert"><AlertCircle aria-hidden />{msg || 'Could not set up your shop.'}</div>
      <p className="hint" style={{ marginBottom: 0 }}><Link href="/login">Try signing in</Link></p>
    </AuthLayout>
  );
}
