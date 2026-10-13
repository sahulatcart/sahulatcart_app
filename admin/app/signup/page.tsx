'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';
import { checkSignup, signUp } from '../../lib/api';
import AuthLayout, { useSiteUrl } from '../../components/AuthLayout';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';

/** Pakistani mobile in any usual spelling: +92 300 1234567, 0300-1234567, 923001234567. */
const okPhone = (v: string) => /^923\d{9}$/.test(v.replace(/\D/g, '').replace(/^0(3\d{9})$/, '92$1'));

export default function SignupPage() {
  const siteUrl = useSiteUrl();
  const [f, setF] = useState({ email: '', password: '', shopName: '', ownerName: '', phone: '', noProhibitedGoods: false, optInOnly: false });
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<'sent' | 'closed' | null>(null);
  // Review P1-9: while sign-up is closed, say so before the form, not after seven fields.
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => { fetch('/api/v1/config').then((r) => r.json()).then((c: { signupOpen?: boolean }) => setOpen(c.signupOpen === true)).catch(() => setOpen(null)); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const email = f.email.trim().toLowerCase();
    if (!email || !/\S+@\S+\.\S+/.test(email)) return setErr('Enter a valid email address.');
    if (f.password.length < 8) return setErr('Password must be at least 8 characters.');
    if (f.shopName.trim().length < 2 || f.ownerName.trim().length < 2) return setErr('Shop name and your name need at least 2 characters.');
    if (!okPhone(f.phone)) return setErr('Enter a Pakistani mobile number, like +92 300 1234567.');
    if (!f.noProhibitedGoods || !f.optInOnly) return setErr('Please confirm both statements to continue.');

    setBusy(true);
    try {
      // Ask first, so a refused email never leaves a stray auth user behind.
      if (!(await checkSignup(email))) { setDone('closed'); return; }
      const r = await signUp(email, f.password, {
        shopName: f.shopName.trim(),
        ownerName: f.ownerName.trim(),
        phone: f.phone.trim(),
        attestations: { noProhibitedGoods: true, optInOnly: true },
      });
      if (r.ok) setDone('sent');
      else setErr(r.exists ? 'That email already has an account; log in or reset your password.' : `Could not create the account: ${r.message}`);
    } catch {
      setErr('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done === 'sent') {
    return (
      <AuthLayout title="Check your email">
        <p className="hint" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <MailCheck aria-hidden style={{ flex: 'none', width: 18, height: 18, marginTop: 2 }} />
          <span>We sent a confirmation link to <b>{f.email.trim()}</b>. Open it on this device to finish creating your shop.</span>
        </p>
        <p className="hint" style={{ marginBottom: 0 }}>Already confirmed? <Link href="/login">Sign in</Link></p>
      </AuthLayout>
    );
  }

  if (done === 'closed') {
    return (
      <AuthLayout title="Private pilot">
        <p className="hint">{PRODUCT_NAME} is in private pilot; email us to join. We open to every shop on launch day.</p>
        <p className="hint" style={{ marginBottom: 0 }}>
          <a href={`${siteUrl}/support.html`}>Contact us</a> · <Link href="/login">Sign in</Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your shop" hint="Free to start. Your bot stays off until you finish setting up.">
      <form onSubmit={submit} noValidate>
        {open === false && (
          <p className="hint" role="note" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertCircle aria-hidden style={{ flex: 'none', width: 18, height: 18, marginTop: 2 }} />
            <span>{PRODUCT_NAME} is in private pilot: only invited emails can open a shop right now. <a href={`${siteUrl}/demo.html`}>Book a demo</a> to be invited.</span>
          </p>
        )}
        {err && <div className="form-error" role="alert"><AlertCircle aria-hidden />{err}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoFocus placeholder="you@shop.com" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="input-affix">
            <input id="password" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={f.password} onChange={(e) => set('password', e.target.value)} required style={{ paddingRight: 48 }} />
            <button type="button" className="btn subtle icon-btn sm affix-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
              {show ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </button>
          </div>
          <div className="help">At least 8 characters.</div>
        </div>
        <div className="field">
          <label htmlFor="shopName">Shop name</label>
          <input id="shopName" value={f.shopName} onChange={(e) => set('shopName', e.target.value)} placeholder="Ali Garments" maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="ownerName">Your name</label>
          <input id="ownerName" autoComplete="name" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="phone">Your WhatsApp number</label>
          <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+92 300 1234567" required />
          <div className="help">Your personal number, for alerts and your test order. The shop number is connected later.</div>
        </div>
        <div className="field">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
            <input type="checkbox" checked={f.noProhibitedGoods} onChange={(e) => set('noProhibitedGoods', e.target.checked)} style={{ marginTop: 3 }} />
            <span>My shop sells no goods that WhatsApp prohibits (weapons, drugs, tobacco, adult content, counterfeits).</span>
          </label>
        </div>
        <div className="field">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
            <input type="checkbox" checked={f.optInOnly} onChange={(e) => set('optInOnly', e.target.checked)} style={{ marginTop: 3 }} />
            <span>I will only message customers who contacted my shop first, and stop when they ask.</span>
          </label>
        </div>
        <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? <><Loader2 className="spin" aria-hidden /> Creating…</> : <>Create account <ArrowRight aria-hidden /></>}
        </button>
        <p className="hint" style={{ marginTop: 14, marginBottom: 0 }}>
          By continuing you agree to the <a href={`${siteUrl}/terms.html`}>Terms</a> and <a href={`${siteUrl}/privacy.html`}>Privacy Policy</a>.
        </p>
      </form>
      <p className="hint" style={{ marginTop: 18, marginBottom: 0 }}>
        Already have a shop? <Link href="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
