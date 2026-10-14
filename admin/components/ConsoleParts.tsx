'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Clock, PauseCircle, XCircle } from 'lucide-react';
import Dialog from './Dialog';
import { api, apiError, rs } from '../lib/api';

/** Shared pieces of the founders' console (2026-10-14 critique): one vocabulary on every page. */

export type SellingCode = 'selling' | 'quality' | 'suspended' | 'bot_off' | 'no_whatsapp' | 'connecting' | 'token' | 'policy' | 'registration' | 'disconnected' | 'past_due' | 'limit';
export interface Selling { selling: boolean; code: SellingCode; reason: string | null }
export interface PlanOption { id: string; label: string; conversations: number; pricePaisa: number }
export interface DueInvoice { id: string; plan: string; periodStart: string; periodEnd: string; amountPaisa: number; reference: string | null; claimedAt: string | null }

/** WhatsApp ids are digits only ("923004561230"); people read "+92 300 4561230". */
export function phone(p: string | null | undefined): string {
  const d = String(p ?? '').replace(/\D/g, '');
  if (!d) return '—';
  if (d.startsWith('92') && d.length === 12) return `+92 ${d.slice(2, 5)} ${d.slice(5)}`;
  return `+${d}`;
}

/** "4 min ago", "3 h ago", "2 days ago"; older than a week, the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) { const d = Math.floor(s / 86_400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return day(iso);
}

/** A date with no clock time ("08 Nov"), in Pakistan time: billing periods are days, not minutes. */
export function day(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short' });
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral';
const SELLING_LOOK: Record<SellingCode, { tone: Tone; Icon: typeof CheckCircle2 }> = {
  selling: { tone: 'success', Icon: CheckCircle2 },
  quality: { tone: 'warning', Icon: AlertTriangle },
  suspended: { tone: 'danger', Icon: Ban },
  bot_off: { tone: 'neutral', Icon: PauseCircle },
  no_whatsapp: { tone: 'warning', Icon: Clock },
  connecting: { tone: 'warning', Icon: Clock },
  token: { tone: 'danger', Icon: XCircle },
  policy: { tone: 'danger', Icon: XCircle },
  registration: { tone: 'danger', Icon: XCircle },
  disconnected: { tone: 'danger', Icon: XCircle },
  past_due: { tone: 'warning', Icon: AlertTriangle },
  limit: { tone: 'warning', Icon: AlertTriangle },
};
export const sellingTone = (s: Selling): Tone => SELLING_LOOK[s.code]?.tone ?? 'neutral';
/** Attention order for the shop list: broken first, then billing hand-over, then waiting, then fine. */
export const sellingRank = (s: Selling): number => ({ danger: 0, warning: 2, neutral: 3, success: 4 })[sellingTone(s)];

/** "Selling" or "Not selling", always with an icon and the reason in words (never colour alone). */
export function SellingBadge({ s }: { s: Selling }) {
  const { tone, Icon } = SELLING_LOOK[s.code] ?? SELLING_LOOK.selling;
  return (
    <span className={`selling ${tone}`}>
      <Icon aria-hidden />
      <span>
        <span className="t">{s.selling ? 'Selling' : 'Not selling'}</span>
        {s.reason && <span className="r" style={{ display: 'block' }}>{s.reason}</span>}
      </span>
    </span>
  );
}

/**
 * Mark an invoice paid. Unclaimed invoices get a warning first: the founders should only confirm
 * money they can see in the Nubrix account. Marking paid cannot be undone, and the dialog says so.
 */
export function MarkPaidDialog({ open, onClose, onDone, shop, invoice }: {
  open: boolean; onClose: () => void; onDone: () => void; shop: string; invoice: DueInvoice | null;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) setErr(null); }, [open]);
  if (!invoice) return null;
  const claimed = !!invoice.reference;
  async function confirm() {
    setBusy(true); setErr(null);
    const r = await api(`/api/v1/platform/invoices/${invoice!.id}/paid`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return setErr(await apiError(r));
    onDone();
  }
  return (
    <Dialog open={open} onClose={onClose} busy={busy} title={`Mark ${rs(invoice.amountPaisa)} from ${shop} as received?`}
      actions={<button type="button" className="btn" onClick={confirm} disabled={busy}>{busy ? 'Marking…' : `Mark ${rs(invoice.amountPaisa)} paid`}</button>}>
      {claimed
        ? <p>{shop} says they transferred it, reference <span className="mono">{invoice.reference}</span>{invoice.claimedAt ? `, ${ago(invoice.claimedAt)}` : ''}. Check that the Nubrix account shows it before you confirm.</p>
        : <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>No transfer reference yet. Only confirm if you can already see {rs(invoice.amountPaisa)} from {shop} in the Nubrix account.</span></div>}
      <dl className="facts">
        <dt>Plan</dt><dd style={{ textTransform: 'capitalize' }}>{invoice.plan}</dd>
        <dt>Period</dt><dd>{day(invoice.periodStart)} to {day(invoice.periodEnd)}</dd>
      </dl>
      <p className="hint">Their plan then runs to {day(invoice.periodEnd)} and the bot sells again. This cannot be undone.</p>
      {err && <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>{err}</span></div>}
    </Dialog>
  );
}

/** POST a plan change. Shared by the dialog and by Undo. */
export async function changePlan(merchantId: string, plan: string): Promise<string | null> {
  const r = await api(`/api/v1/platform/merchants/${merchantId}/plan`, { method: 'POST', body: JSON.stringify({ plan }) });
  return r.ok ? null : apiError(r);
}

/** Change a shop's plan, showing what it costs before anything is sent. */
export function ChangePlanDialog({ open, onClose, onDone, shop, merchantId, current, requested, plans }: {
  open: boolean; onClose: () => void; onDone: (prev: string, next: string) => void;
  shop: string; merchantId: string; current: string; requested?: string | null; plans: PlanOption[];
}) {
  const [pick, setPick] = useState(requested ?? current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) { setPick(requested ?? current); setErr(null); } }, [open, requested, current]);
  const chosen = plans.find((p) => p.id === pick);
  const price = (p: PlanOption) => (p.pricePaisa > 0 ? `${rs(p.pricePaisa)} a month` : 'Free');

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) return;
    e.preventDefault();
    const i = plans.findIndex((p) => p.id === pick);
    const next = plans[(i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : plans.length - 1)) % plans.length]!;
    setPick(next.id);
    group.current?.querySelector<HTMLButtonElement>(`[data-plan="${next.id}"]`)?.focus();
  }
  async function confirm() {
    setBusy(true); setErr(null);
    const e = await changePlan(merchantId, pick);
    setBusy(false);
    if (e) return setErr(e);
    onDone(current, pick);
  }
  return (
    <Dialog open={open} onClose={onClose} busy={busy} title={`Change ${shop}'s plan`}
      actions={<button type="button" className="btn" onClick={confirm} disabled={busy || pick === current}>{busy ? 'Changing…' : pick === current ? 'Already on this plan' : `Change to ${chosen?.label ?? pick}`}</button>}>
      {requested && requested !== current && <p className="hint">The owner asked for {plans.find((p) => p.id === requested)?.label ?? requested}.</p>}
      <div className="choices" role="radiogroup" aria-label="Plan" ref={group} onKeyDown={onKey} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
        {plans.map((p) => (
          <button key={p.id} type="button" role="radio" data-plan={p.id} aria-checked={pick === p.id} tabIndex={pick === p.id ? 0 : -1} className="choice" onClick={() => setPick(p.id)}>
            <span style={{ flex: 1 }}>
              <span className="t">{p.label}{p.id === current ? ' (current)' : ''}</span>
              <span className="d" style={{ display: 'block' }}>{price(p)} · up to {p.conversations.toLocaleString('en-PK')} conversations</span>
            </span>
          </button>
        ))}
      </div>
      {chosen && pick !== current && <p className="hint">The new price applies from their next invoice, and the owner is told.</p>}
      {err && <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>{err}</span></div>}
    </Dialog>
  );
}
