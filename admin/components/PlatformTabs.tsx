'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The platform console's sections (docs/launch/PLATFORM-PANEL-FAZAL.md). Inbox lands between Shops and Access (U2). */
const TABS: { href: string; label: string }[] = [
  { href: '/platform', label: 'Shops' },
  { href: '/platform/inbox', label: 'Inbox' },
  { href: '/platform/access', label: 'Access' },
  { href: '/platform/audit', label: 'Audit' },
  { href: '/platform/jobs', label: 'Jobs' },
];

export default function PlatformTabs() {
  const pathname = usePathname();
  return (
    <div style={{ marginBottom: 16 }}>
      <nav aria-label="Platform sections" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(({ href, label }) => {
          const active = href === '/platform' ? pathname === '/platform' : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={active ? 'btn sm' : 'btn sm ghost'} aria-current={active ? 'page' : undefined}>{label}</Link>
          );
        })}
      </nav>
    </div>
  );
}
