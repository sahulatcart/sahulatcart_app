'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { clearToken, getToken } from '../lib/api';

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatkaar';
const links = [
  ['/', 'Dashboard'],
  ['/orders', 'Orders'],
  ['/catalog', 'Catalog'],
  ['/settings', 'Settings'],
];

export default function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace('/login');
    else setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <>
      <nav className="nav">
        <span className="brand">{PRODUCT_NAME}</span>
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={pathname === href ? 'active' : ''}>
            {label}
          </Link>
        ))}
        <span className="spacer" />
        <button
          className="btn sec"
          onClick={() => {
            clearToken();
            router.replace('/login');
          }}
        >
          Logout
        </button>
      </nav>
      <div className="wrap">{children}</div>
    </>
  );
}
