'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { apiError, bootstrap } from '../../../lib/api';
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
  const [state, setState] = useState<'working' | 'no_session' | 'closed' | 'error'>('working');
  const [msg, setMsg] = useState('');

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
      if (r.ok) { router.replace('/onboarding'); return; }
      if (r.status === 403) return setState('closed');
      setMsg(await apiError(r));
      setState('error');
    })().catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [router]);

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
