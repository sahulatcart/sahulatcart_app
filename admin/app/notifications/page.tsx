'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Bell, CheckCheck, Hand, Receipt, ShoppingBag, type LucideIcon } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../components/AppShell';
import { api, apiError, apiJson, dt } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface N { id: string; type: string; title: string | null; body: string | null; data: { orderId?: string; conversationId?: string } | null; read_at: string | null; created_at: string }

/** Where a notification leads: its order, or the inbox for chats handed to a person. */
const target = (n: N) => (n.data?.orderId ? `/orders/${n.data.orderId}` : n.data?.conversationId ? '/inbox' : null);
const LOOK: Record<string, { Icon: LucideIcon; tone: string }> = {
  new_order: { Icon: ShoppingBag, tone: 'brand' },
  payment_claim: { Icon: Receipt, tone: 'warning' },
  takeover_request: { Icon: Hand, tone: 'warning' },
  bot_needs_help: { Icon: Hand, tone: 'warning' },
  system: { Icon: AlertTriangle, tone: 'danger' },
};

export default function Notifications() {
  const toast = useToast();
  const [items, setItems] = useState<N[] | null>(null);
  const load = () => apiJson<{ notifications: N[] }>('/api/v1/admin/notifications').then((r) => setItems(r.notifications)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  async function readAll() {
    const r = await api('/api/v1/admin/notifications/read', { method: 'POST' });
    if (!r.ok) return toast(await apiError(r), 'error');
    window.dispatchEvent(new Event('notifications')); // refresh the nav badge now, not on its next poll
    load();
  }
  const unread = items?.filter((n) => !n.read_at).length ?? 0;

  return (
    <AppShell>
      <PageHead title="Notifications" sub="New orders, payment screenshots, chats handed to you, and messages the bot couldn't deliver"
        action={unread > 0 && <button className="btn ghost" onClick={readAll}><CheckCheck aria-hidden /> Mark all read</button>} />
      <div className="card">
        {items?.map((n) => {
          const href = target(n);
          const { Icon, tone } = LOOK[n.type] ?? { Icon: Bell, tone: '' };
          return (
            <div key={n.id} className={`feed-item ${n.read_at ? '' : 'unread'}`}>
              <div className={`ico ${tone}`}><Icon aria-hidden /></div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="t">{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</div>
                {n.body && <div className="b">{n.body}</div>}
                {href && <Link href={href} className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 13 }}>Open <ArrowRight size={14} aria-hidden /></Link>}
              </div>
              <div className="when">{dt(n.created_at)}</div>
            </div>
          );
        })}
        {items?.length === 0 && <EmptyState icon={Bell} title="All quiet" hint="New orders, payment screenshots and chats that need you will show up here." />}
        {!items && [0, 1, 2].map((i) => <div key={i} className="feed-item"><div className="skeleton" style={{ height: 40, flex: 1 }} /></div>)}
      </div>
    </AppShell>
  );
}
