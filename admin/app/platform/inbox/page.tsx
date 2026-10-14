'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpCircle, Check, CheckCheck, Inbox, MessageCircle, PhoneOff, Receipt, Timer } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../../components/AppShell';
import { api, apiError, apiJson, dt, rs } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { ago, changePlan, ChangePlanDialog, MarkPaidDialog, type DueInvoice, type PlanOption } from '../../../components/ConsoleParts';

/**
 * The founders' inbox (U2, reworked after the 2026-10-14 critique): every alert carries its own
 * action, so a claim is marked paid and a plan request applied right here, not after a hunt through
 * the Shops page. Acting on a row marks it read.
 */

type Kind = 'invoice_claimed' | 'plan_requested' | 'whatsapp_attention' | 'job_failed';
interface Row { id: string; kind: Kind; merchant_id: string | null; businessName: string | null; ownerPhone: string | null; title: string; body: string; data: Record<string, unknown>; read_at: string | null; created_at: string }
interface Invoice { id: string; merchant_id: string; businessName: string | null; plan: string; period_start: string; period_end: string; amount_paisa: number; reference: string | null; claimed_at: string | null }
interface PlanRequest { id: string; merchant_id: string; businessName: string | null; plan: string; requested_plan: string }

const PRODUCT_NAME = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'Sahulatcart';
const ICON: Record<Kind, { Icon: typeof Receipt; tone: string; label: string }> = {
  invoice_claimed: { Icon: Receipt, tone: 'brand', label: 'Invoice claimed' },
  plan_requested: { Icon: ArrowUpCircle, tone: 'brand', label: 'Plan request' },
  whatsapp_attention: { Icon: PhoneOff, tone: 'warning', label: 'WhatsApp' },
  job_failed: { Icon: Timer, tone: 'danger', label: 'Job failed' },
};
const JOB_NAME: Record<string, string> = { replay_sweeper: 'missed-message replay', retention: 'data retention', unpaid_expiry: 'unpaid-order expiry', billing: 'billing' };
const waLink = (digits: string, shop: string) => `https://wa.me/${digits.replace(/\D/g, '')}?text=${encodeURIComponent(`Assalam o alaikum! ${PRODUCT_NAME} team here about ${shop}: your WhatsApp connection needs attention in Settings → WhatsApp, so the bot can reply to buyers again.`)}`;

export default function PlatformInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [requests, setRequests] = useState<PlanRequest[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<{ row: Row; inv: Invoice } | null>(null);
  const [applying, setApplying] = useState<{ row: Row; req: PlanRequest } | null>(null);

  const load = useCallback(() => {
    apiJson<{ notifications: Row[] }>('/api/v1/platform/inbox').then((r) => setRows(r.notifications)).catch((e) => { setRows((cur) => cur ?? []); toast((e as Error).message, 'error'); });
    apiJson<{ invoices: Invoice[]; requests: PlanRequest[]; plans: PlanOption[] }>('/api/v1/platform/invoices').then((r) => { setInvoices(r.invoices); setRequests(r.requests); setPlans(r.plans ?? []); }).catch(() => undefined);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function markRead(ids?: string[]) {
    if (!ids) setBusy(true);
    const r = await api('/api/v1/platform/inbox/read', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) });
    if (!ids) setBusy(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    const now = new Date().toISOString();
    setRows((cur) => (cur ?? []).map((x) => (!ids || ids.includes(x.id) ? { ...x, read_at: x.read_at ?? now } : x)));
    window.dispatchEvent(new Event('platform-inbox'));
  }

  const unread = (rows ?? []).filter((r) => !r.read_at).length;
  const planLabel = (id: string) => plans.find((p) => p.id === id)?.label ?? id;

  function action(r: Row) {
    if (r.kind === 'invoice_claimed') {
      const inv = invoices.find((i) => i.id === r.data.invoiceId);
      return inv
        ? <button type="button" className="btn sm" onClick={() => setPaying({ row: r, inv })} aria-label={`Mark ${rs(inv.amount_paisa)} from ${r.businessName ?? 'this shop'} paid`}>Mark {rs(inv.amount_paisa)} paid</button>
        : <span className="hint"><Check size={14} aria-hidden style={{ verticalAlign: -2 }} /> Settled</span>;
    }
    if (r.kind === 'plan_requested') {
      const req = requests.find((q) => q.merchant_id === r.merchant_id && q.requested_plan);
      return req
        ? <button type="button" className="btn ghost sm" onClick={() => setApplying({ row: r, req })} aria-label={`Review ${r.businessName ?? 'this shop'}'s request for ${planLabel(req.requested_plan)}`}>Apply {planLabel(req.requested_plan)}…</button>
        : <span className="hint"><Check size={14} aria-hidden style={{ verticalAlign: -2 }} /> Handled</span>;
    }
    if (r.kind === 'whatsapp_attention' && r.ownerPhone) {
      return <a className="btn ghost sm" href={waLink(r.ownerPhone, r.businessName ?? 'your shop')} target="_blank" rel="noopener noreferrer" onClick={() => !r.read_at && markRead([r.id])} aria-label={`Message ${r.businessName ?? 'the owner'} on WhatsApp`}><MessageCircle aria-hidden /> Message owner</a>;
    }
    if (r.kind === 'job_failed') return <Link href="/platform/jobs" className="btn ghost sm">Open jobs</Link>;
    return null;
  }

  return (
    <AppShell variant="platform">
      <PageHead title="Inbox" sub="What needs a founder: payments to confirm, plan requests, WhatsApp numbers that stopped the bot, and failed jobs. Each is also emailed to every platform admin."
        action={<button type="button" className="btn ghost sm" onClick={() => markRead()} disabled={busy || unread === 0}><CheckCheck aria-hidden /> Mark all read</button>} />
      <div className="card">
        {rows && rows.length === 0 && <EmptyState icon={Inbox} title="All clear" hint="Payment claims, plan requests, WhatsApp problems and failed jobs land here the moment they happen." />}
        {rows && rows.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((r) => {
              const look = ICON[r.kind];
              const title = r.kind === 'job_failed' && typeof r.data.job === 'string' ? `Job failed: ${JOB_NAME[r.data.job] ?? r.data.job}` : r.title;
              return (
                <li key={r.id} className={`feed-item${r.read_at ? '' : ' unread'}`}>
                  <span className={`ico ${look.tone}`}><look.Icon aria-hidden /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t">{!r.read_at && <span className="sr-only">New: </span>}{title}</div>
                    <div className="b">{r.body}</div>
                    <div className="hint" style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span title={dt(r.created_at, true)}>{ago(r.created_at)}</span>
                      {r.merchant_id && <Link href={`/platform/shops/${r.merchant_id}`} className="link">Open {r.businessName ?? 'shop'}</Link>}
                    </div>
                  </div>
                  <div className="feed-actions">
                    {action(r)}
                    {!r.read_at && <button type="button" className="btn subtle icon-btn sm" onClick={() => markRead([r.id])} aria-label={`Mark read: ${title}`} title="Mark read"><Check aria-hidden /></button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!rows && <div className="skeleton" style={{ height: 160, margin: 16 }} />}
      </div>

      <MarkPaidDialog open={!!paying} shop={paying?.row.businessName ?? 'this shop'} onClose={() => setPaying(null)}
        invoice={paying ? ({ id: paying.inv.id, plan: paying.inv.plan, periodStart: paying.inv.period_start, periodEnd: paying.inv.period_end, amountPaisa: paying.inv.amount_paisa, reference: paying.inv.reference, claimedAt: paying.inv.claimed_at } satisfies DueInvoice) : null}
        onDone={async () => { const p = paying!; setPaying(null); toast(`${rs(p.inv.amount_paisa)} from ${p.row.businessName ?? 'the shop'} marked paid`, 'success'); if (!p.row.read_at) await markRead([p.row.id]); load(); }} />
      {applying && (
        <ChangePlanDialog open={!!applying} shop={applying.row.businessName ?? 'this shop'} merchantId={applying.req.merchant_id} current={applying.req.plan} requested={applying.req.requested_plan} plans={plans} onClose={() => setApplying(null)}
          onDone={async (prev, next) => {
            const a = applying; setApplying(null);
            if (!a.row.read_at) await markRead([a.row.id]);
            load();
            toast(`${a.row.businessName ?? 'The shop'} is now on ${planLabel(next)}`, 'success', { label: 'Undo', onClick: async () => { const e = await changePlan(a.req.merchant_id, prev); if (e) toast(e, 'error'); else { toast(`Back on ${planLabel(prev)}`, 'info'); load(); } } });
          }} />
      )}
    </AppShell>
  );
}
