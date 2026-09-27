'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell, { PageHead } from '../../components/AppShell';
import { api, apiError, apiJson, dt } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface N { id: string; title: string | null; body: string | null; data: { orderId?: string; conversationId?: string } | null; read_at: string | null; created_at: string }

/** Where a notification leads: its order, or the inbox for chats handed to a person. */
const target = (n: N) => (n.data?.orderId ? `/orders/${n.data.orderId}` : n.data?.conversationId ? '/inbox' : null);

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
        action={unread > 0 && <button className="btn ghost" onClick={readAll}>Mark all read</button>} />
      <div className="card">
        {items?.map((n) => {
          const href = target(n);
          return (
            <div key={n.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', background: n.read_at ? undefined : 'var(--brand-tint)' }}>
              <div className="row between"><span style={{ fontWeight: 600 }}>{n.title}</span><span className="hint">{dt(n.created_at)}</span></div>
              {n.body && <div style={{ marginTop: 4, fontSize: 13.5, color: 'var(--ink-2)' }}>{n.body}</div>}
              {href && <Link href={href} className="hint" style={{ display: 'inline-block', marginTop: 6 }}>Open →</Link>}
            </div>
          );
        })}
        {items?.length === 0 && <div className="hint" style={{ padding: 28, textAlign: 'center' }}>No notifications yet.</div>}
      </div>
    </AppShell>
  );
}
