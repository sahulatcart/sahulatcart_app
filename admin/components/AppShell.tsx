'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { BarChart3, LayoutDashboard, LogOut, Menu, MessagesSquare, Package, Settings, ShoppingBag } from 'lucide-react';
import { hasSession, signOut } from '../lib/api';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';
const NAV = [
  { href: '/', label: 'Dashboard', Icon: LayoutDashboard },
  { href: '/inbox', label: 'Inbox', Icon: MessagesSquare },
  { href: '/orders', label: 'Orders', Icon: ShoppingBag },
  { href: '/catalog', label: 'Catalog', Icon: Package },
  { href: '/analytics', label: 'Analytics', Icon: BarChart3 },
  { href: '/settings', label: 'Settings', Icon: Settings },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    hasSession().then((ok) => { if (!ok) router.replace('/login'); else setReady(true); });
  }, [router]);
  useEffect(() => { setOpen(false); }, [pathname]);
  if (!ready) return null;

  const logout = async () => { await signOut(); router.replace('/login'); };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mark" src="/logo.svg" alt="" width={37} height={30} />
          <span className="name">{PRODUCT_NAME}</span>
        </div>
        <nav className="nav-group">
          {NAV.map(({ href, label, Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''}`}>
                <Icon /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="nav-link" onClick={logout}><LogOut /> Logout</div>
        </div>
      </aside>

      <div className={`scrim ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <div className="topbar">
          <button className="btn ghost sm" onClick={() => setOpen(true)} aria-label="menu"><Menu /></button>
          <span style={{ fontWeight: 700 }}>{PRODUCT_NAME}</span>
        </div>
        <div className="content">{children}</div>
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
      {action}
    </div>
  );
}

export function Pill({ kind, children }: { kind: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'; children: ReactNode }) {
  return <span className={`pill ${kind}`}><span className="dot" />{children}</span>;
}

const PAYMENT_PILL: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  unpaid: 'neutral', claimed: 'warning', verified: 'success', failed: 'danger', cod_pending: 'info', cod_collected: 'success', refunded: 'neutral',
};
export function PaymentPill({ status }: { status: string }) {
  return <Pill kind={PAYMENT_PILL[status] ?? 'neutral'}>{status.replace('_', ' ')}</Pill>;
}
