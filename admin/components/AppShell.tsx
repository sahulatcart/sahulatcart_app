'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, BarChart3, Bell, LayoutDashboard, LogOut, Menu, MessagesSquare, Package, Settings, ShoppingBag, X, type LucideIcon } from 'lucide-react';
import { apiJson, hasSession, signOut } from '../lib/api';
import Wordmark from '../components/Wordmark';

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
      { href: '/settings', label: 'Settings', Icon: Settings },
    ],
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

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
    if (!ready) return;
    const load = () => apiJson<{ unread: number }>('/api/v1/admin/notifications?count=1').then((r) => setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    window.addEventListener('notifications', load);
    return () => { clearInterval(t); window.removeEventListener('notifications', load); };
  }, [ready]);
  if (!ready) return null;

  const logout = async () => { await signOut(); router.replace('/login'); };

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="row between" style={{ flexWrap: 'nowrap' }}>
          <Link href="/" className="brand-lockup">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/logo.svg" alt="" width={34} height={28} />
            <span>
              <span className="name"><Wordmark name={PRODUCT_NAME} /></span>
              <span className="tag">Merchant admin</span>
            </span>
          </Link>
          {open && <button className="btn subtle icon-btn drawer-close" onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>}
        </div>
        <nav>
          {NAV.map(({ section, items }) => (
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
          <button className="nav-link" onClick={logout}><LogOut aria-hidden /> Log out</button>
        </div>
      </aside>

      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} aria-hidden />

      <div className="main">
        <header className="topbar">
          <button className="btn subtle icon-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}><Menu /></button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={22} />
          <span style={{ fontSize: 16 }}><Wordmark name={PRODUCT_NAME} /></span>
          {unread > 0 && (
            <Link href="/notifications" className="btn subtle icon-btn" style={{ marginLeft: 'auto', position: 'relative' }} aria-label={`Notifications, ${unread} unread`}>
              <Bell />
              <span style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)' }} />
            </Link>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
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
