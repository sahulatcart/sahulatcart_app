'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Activity, ArrowLeft, ArrowLeftRight, BarChart3, Bell, CreditCard, Inbox, LayoutDashboard, LogOut, Menu, MessagesSquare, Package, ScrollText, Settings, ShieldCheck, ShoppingBag, Store, X, type LucideIcon } from 'lucide-react';
import { api, apiJson, hasSession, signOut } from '../lib/api';
import { disablePush } from '../lib/push';
import Wordmark from '../components/Wordmark';
import ThemeToggle from './ThemeToggle';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
// Two groups: daily operations first, shop setup second.
const NAV: { section: string; items: { href: string; label: string; Icon: LucideIcon }[] }[] = [
  {
    section: 'Operate',
    items: [
      { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
      { href: '/inbox', label: 'Inbox', Icon: MessagesSquare },
      { href: '/orders', label: 'Orders', Icon: ShoppingBag },
      { href: '/notifications', label: 'Notifications', Icon: Bell },
    ],
  },
  {
    section: 'Manage',
    items: [
      { href: '/catalog', label: 'Catalog', Icon: Package },
      { href: '/analytics', label: 'Analytics', Icon: BarChart3 },
      { href: '/billing', label: 'Billing', Icon: CreditCard },
      { href: '/settings', label: 'Settings', Icon: Settings },
    ],
  },
];

// The founders' console (docs/launch/PLATFORM-PANEL-UZAIR.md) has its own nav. It is the same shell
// with a different variant, never a second component: the drawer, theme toggle and logout are shared.
const PLATFORM_NAV: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: '/platform', label: 'Shops', Icon: Store },
  { href: '/platform/inbox', label: 'Inbox', Icon: Inbox },
  { href: '/platform/access', label: 'Access', Icon: ShieldCheck },
  { href: '/platform/audit', label: 'Audit', Icon: ScrollText },
  { href: '/platform/jobs', label: 'Jobs', Icon: Activity },
];

export type ShellVariant = 'merchant' | 'platform';

/**
 * `variant="platform"` is the founders' console: its own nav, the inbox count, no merchant calls,
 * and only platform admins may stay. The merchant dashboard never shows console items; the two
 * meet only through the one "Switch to…" link in the sidebar foot, shown to people who have both.
 */
export default function AppShell({ children, variant = 'merchant' }: { children: ReactNode; variant?: ShellVariant }) {
  const router = useRouter();
  const pathname = usePathname();
  const platform = variant === 'platform';
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [platformAdmin, setPlatformAdmin] = useState(false);
  const [hasShop, setHasShop] = useState(false);
  const [platformUnread, setPlatformUnread] = useState(0);
  const [suspension, setSuspension] = useState<string | null>(null);

  useEffect(() => {
    hasSession().then((ok) => { if (!ok) router.replace('/login'); else setReady(true); });
  }, [router]);
  useEffect(() => { setOpen(false); }, [pathname]);
  // Close the mobile drawer with Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // Unread badge: cheap count poll, plus an instant refresh when a page marks them read.
  useEffect(() => {
    if (!ready || platform) return;
    const load = () => apiJson<{ unread: number }>('/api/v1/admin/notifications?count=1').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener('notifications', load);
    return () => { clearInterval(t); window.removeEventListener('notifications', load); };
  }, [ready, platform]);
  // U2: the founders' inbox count on the console's Inbox link, refreshed when the inbox page marks rows read.
  useEffect(() => {
    if (!ready || !platform || !platformAdmin) return;
    const load = () => apiJson<{ unread: number }>('/api/v1/platform/inbox?count=1').then((r) => setPlatformUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener('platform-inbox', load);
    return () => { clearInterval(t); window.removeEventListener('platform-inbox', load); };
  }, [ready, platform, platformAdmin]);
  // Who is this: a platform admin (and do they also own a shop)? The console sends anyone else home.
  // On the merchant side a suspended shop sees why it is read-only.
  useEffect(() => {
    if (!ready) return;
    // Only a 403 means "not a platform admin". A network blip, a 429 or a 5xx says nothing about who
    // this is, so the console keeps its page instead of bouncing a founder to the merchant side (the
    // backend guards every console route anyway). A 401 is handled inside api(): back to /login.
    api('/api/v1/platform/me')
      .then(async (r) => {
        if (r.ok) {
          const me = (await r.json()) as { isPlatformAdmin?: boolean; merchantId?: string | null };
          setPlatformAdmin(!!me.isPlatformAdmin);
          setHasShop(!!me.merchantId);
        } else if (r.status === 403) {
          setPlatformAdmin(false);
          if (platform) router.replace('/');
        }
      })
      .catch(() => { /* network error: not an answer about who this is; leave things as they are */ });
    if (!platform) {
      apiJson<{ merchant?: { status?: string; settings?: { suspension?: { reason?: string } } } }>('/api/v1/admin/me')
        .then((r) => setSuspension(r.merchant?.status === 'suspended' ? (r.merchant.settings?.suspension?.reason ?? 'no reason given') : null))
        .catch(() => {});
    }
  }, [ready, platform, router]);
  if (!ready) return null;

  // Logging out also forgets this device's push subscription: on a shared phone the next person must
  // not keep getting this shop's orders (review P3-9). Push errors never block the logout.
  const logout = async () => { await disablePush().catch(() => {}); await signOut(); router.replace('/login'); };

  return (
    <div className="shell" data-area={variant}>
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <Link href={platform ? '/platform' : '/'} className="brand-lockup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/logo.svg" alt="" width={34} height={28} />
            <span>
              <span className="name"><Wordmark name={PRODUCT_NAME} /></span>
              <span className="tag">{platform ? 'Platform console' : 'Merchant Dashboard'}</span>
            </span>
          </Link>
          {open && <button className="btn subtle icon-btn drawer-close" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>}
        </div>
        <nav>
          {platform && (
            <div>
              <div className="nav-section">Console</div>
              <div className="nav-group">
                {PLATFORM_NAV.map(({ href, label, Icon }) => {
                  const active = href === '/platform' ? pathname === '/platform' || pathname.startsWith('/platform/shops') : pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                      <Icon aria-hidden /> {label}
                      {href === '/platform/inbox' && platformUnread > 0 && (
                        <span className="count" aria-label={`${platformUnread} unread`}>{platformUnread > 99 ? '99+' : platformUnread}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
          {!platform && NAV.map(({ section, items }) => (
            <div key={section}>
              <div className="nav-section">{section}</div>
              <div className="nav-group">
                {items.map(({ href, label, Icon }) => {
                  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
                  return (
                    <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                      <Icon aria-hidden /> {label}
                      {href === '/notifications' && unread > 0 && (
                        <span className="count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {!platform && platformAdmin && <Link href="/platform" className="nav-link"><ArrowLeftRight aria-hidden /> Switch to console</Link>}
          {platform && hasShop && <Link href="/" className="nav-link"><ArrowLeftRight aria-hidden /> Switch to my shop</Link>}
          <button className="nav-link" onClick={logout}><LogOut aria-hidden /> Log out</button>
          <ThemeToggle />
        </div>
      </aside>

      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden />

      <div className="main">
        <header className="topbar">
          <button className="btn subtle icon-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={22} />
          <span style={{ fontSize: 16 }}><Wordmark name={PRODUCT_NAME} /></span>
          {platform && <span className="console-chip">Console</span>}
          <ThemeToggle className="push-right" />
          {!platform && unread > 0 && (
            <Link href="/notifications" className="btn subtle icon-btn" style={{ position: 'relative' }} aria-label={`Notifications, ${unread} unread`}>
              <Bell />
              <span style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />
            </Link>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>
          {suspension && <div className="callout" role="alert" style={{ marginBottom: 16, borderColor: 'var(--danger-border)', background: 'var(--danger-tint)' }}><div className="strong">This shop is suspended.</div><div className="hint">Reason: {suspension}. The bot is not replying and the portal is read-only. Contact support to resolve this.</div></div>}
          {children}
        </main>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className="back-link"><ArrowLeft aria-hidden /> {label}</Link>;
}

/** Empty state: Kaisei Decol headline (the brand's one sanctioned use of it), hint, optional action. */
export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-ico"><Icon aria-hidden /></div>
      <div className="display">{title}</div>
      {hint && <div className="hint">{hint}</div>}
      {action && <div className="action">{action}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
export function Pill({ kind, children }: { kind: Tone; children: ReactNode }) {
  return <span className={`pill ${kind}`}><span className="dot" aria-hidden />{children}</span>;
}

/** 'cod_pending' → 'COD pending': enum values as sentence-case labels. */
export const humanize = (s: string) => { const t = s.replace(/_/g, ' ').replace(/\bcod\b/g, 'COD'); return t.charAt(0).toUpperCase() + t.slice(1); };
const PAYMENT_TONE: Record<string, Tone> = {
  unpaid: 'neutral', claimed: 'warning', verified: 'success', failed: 'danger', cod_pending: 'info', cod_collected: 'success', refunded: 'neutral',
};
export function PaymentPill({ status }: { status: string }) {
  return <Pill kind={PAYMENT_TONE[status] ?? 'neutral'}>{humanize(status)}</Pill>;
}

const ORDER_TONE: Record<string, Tone> = {
  draft: 'neutral', pending_confirmation: 'warning', confirmed: 'info', awaiting_payment: 'warning', paid: 'success',
  preparing: 'brand', dispatched: 'brand', delivered: 'success', cancelled: 'danger', returned: 'neutral',
};
export function StatusPill({ status }: { status: string }) {
  return <Pill kind={ORDER_TONE[status] ?? 'neutral'}>{humanize(status)}</Pill>;
}
