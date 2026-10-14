'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, Ban, CheckCircle2, ChevronDown, CircleDashed, MessagesSquare, Package, PlayCircle, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import AppShell, { BackLink, PageHead, PaymentPill, Pill, StatusPill, humanize } from '../../../../components/AppShell';
import Dialog from '../../../../components/Dialog';
import { api, apiError, apiJson, dt, rs } from '../../../../lib/api';
import { useToast } from '../../../../components/Toast';
import { ago, changePlan, ChangePlanDialog, day, phone, SellingBadge, sellingTone, type PlanOption, type Selling } from '../../../../components/ConsoleParts';

/**
 * The founders' look inside one shop (U1, reworked after the 2026-10-14 critique). Reading a chat or
 * the shop is recorded in the audit log by the backend. The only writes here are the two platform
 * actions on the shop itself, plan and suspension, each behind a dialog that says what it changes.
 */

interface Detail {
  merchant: { id: string; business_name: string; owner_name: string | null; email: string | null; phone: string | null; address: string | null; category: string | null; logo_url: string | null; status: string; plan: string; created_at: string; business_hours: Record<string, { open?: string; close?: string; closed?: boolean }> | null; bot_persona: { name?: string; style?: string; greeting?: string } | null; negotiation_defaults: Record<string, unknown> | null; settings: Record<string, unknown> | null };
  members: { id: string; email: string | null; name: string | null; role: string; is_active: boolean }[];
  bankAccounts: { id: string; bank_name: string; account_title: string | null; is_default: boolean; is_active: boolean }[];
  zones: { id: string; area_name: string; city: string | null; charge: number; is_serviceable: boolean; eta_text: string | null }[];
  subscription: { plan: string; status: string; trial_ends_at: string | null; current_period_end: string | null; requested_plan: string | null } | null;
  invoices: { id: string; plan: string; period_start: string; period_end: string; amount_paisa: number; status: string; reference: string | null }[];
  usage: { outbound: number; freeQuota: number; paidOutbound: number; estimatedCostPaisa: number; llmCallsToday: number; llmDailyCap: number };
  conversationsThisMonth: number;
  limits: { conversations: number };
  selling: Selling;
  impact: { liveChats: number; midCheckout: number };
  counts: { orders: number; chats: number; products: number };
  plans: PlanOption[];
  readiness: { ready: boolean; steps: Record<string, { ok: boolean; reason?: string }> };
  connection: { status: string; displayPhone?: string; qualityRating?: string; messagingTier?: string; flagReason?: string | null; message?: string | null; lastTestAt?: string | null; templates: { name: string; status: string; rejectionReason: string | null }[] };
}
interface Order { id: string; order_number: string; status: string; payment_method: string; payment_status: string; total: number; delivery_name: string | null; created_at: string }
interface Convo { id: string; status: string; current_state: string; last_message_at: string | null; unread_count: number; customers: { name: string | null; wa_id: string; wa_opt_in_status: string; is_blocked: boolean } | null }
interface Msg { direction: string; sender: string; body: string | null; status: string; created_at: string }
interface Negotiation { id: string; productName: string | null; quantity: number; list_price: number; floor_price: number; rounds: number; last_bot_offer: number | null; last_customer_offer: number | null; agreed_price: number | null; status: string }
interface Chat { messages: Msg[]; negotiations: Negotiation[] }
interface Product { id: string; name: string; sku: string | null; price: number; cost: number | null; floor: number; negotiable: boolean; stock: number | null; track_stock: boolean; is_active: boolean; thumbnailUrl: string | null }
interface Attempt { id: string; status: string; phone_number_id: string | null; error_code: string | null; error_message: string | null; created_at: string }

const STEP_LABEL: Record<string, string> = { profile: 'Shop profile', whatsapp: 'WhatsApp connected', catalog: 'Catalog', delivery: 'Delivery areas', payment: 'Payment method', persona: 'Bot persona', testOrder: 'Test order' };
const QUALITY: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = { green: { tone: 'success', label: 'High' }, yellow: { tone: 'warning', label: 'Medium' }, red: { tone: 'danger', label: 'Low' } };
const subTone = (s: string) => (s === 'active' || s === 'trial' || s === 'paid' ? 'success' : s === 'past_due' || s === 'due' ? 'warning' : s === 'expired' ? 'danger' : 'neutral');
const onOff = (v: unknown) => (v === false ? 'Off' : 'On');
const SECTIONS_KEY = 'sk_console_sections';
const SUSPEND_MAX = 300;

function readOpen(): string[] { try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '[]') as string[]; } catch { return []; } }
function writeOpen(ids: string[]) { try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(ids)); } catch { /* private mode: the sections simply do not remember */ } }

function Meter({ label, used, of, detail }: { label: string; used: number; of: number; detail?: string }) {
  const pct = of > 0 ? Math.min(100, Math.round((used / of) * 100)) : 0;
  return (
    <div className={`meter${pct >= 100 ? ' over' : pct >= 80 ? ' warn' : ''}`}>
      <div className="row"><span className="muted">{label}</span><span className="num">{used.toLocaleString('en-PK')} of {of.toLocaleString('en-PK')}</span></div>
      <div className="bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={of} aria-valuenow={used}><span style={{ width: `${pct}%` }} /></div>
      {detail && <div className="hint">{detail}</div>}
    </div>
  );
}

export default function PlatformShop() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [chats, setChats] = useState<Record<string, Chat>>({});
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [planOpen, setPlanOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [liftOpen, setLiftOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [dlgErr, setDlgErr] = useState<string | null>(null);
  const base = `/api/v1/platform/merchants/${id}`;
  const fail = useCallback((what: string) => (e: unknown) => toast((e as Error)?.message || `Could not load ${what}`, 'error'), [toast]);

  const load = useCallback(() => apiJson<Detail>(base).then((r) => { setD(r); setFailed(null); }).catch((e) => setFailed((e as Error).message || 'Could not load this shop')), [base]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOpenSections(readOpen()); }, []);

  const loaders: Record<string, () => void> = {
    orders: () => { if (!orders) apiJson<{ orders: Order[] }>(`${base}/orders`).then((r) => setOrders(r.orders)).catch(fail('orders')); },
    chats: () => { if (!convos) apiJson<{ conversations: Convo[] }>(`${base}/conversations`).then((r) => setConvos(r.conversations)).catch(fail('chats')); },
    catalog: () => { if (!products) apiJson<{ products: Product[] }>(`${base}/products`).then((r) => setProducts(r.products)).catch(fail('the catalog')); },
    attempts: () => { if (!attempts) apiJson<{ attempts: Attempt[] }>(`${base}/attempts`).then((r) => setAttempts(r.attempts)).catch(fail('connect attempts')); },
  };
  // Sections the founder left open last time open again, and load, on the next visit.
  useEffect(() => { if (d) openSections.forEach((s) => loaders[s]?.()); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSection = (sid: string, isOpen: boolean) => {
    const next = isOpen ? [...new Set([...openSections, sid])] : openSections.filter((x) => x !== sid);
    setOpenSections(next); writeOpen(next);
    if (isOpen) loaders[sid]?.();
  };
  const toggleChat = (cid: string) => {
    if (openChat === cid) { setOpenChat(null); return; }
    setOpenChat(cid);
    if (!chats[cid]) apiJson<Chat>(`${base}/conversations/${cid}`).then((r) => setChats((m) => ({ ...m, [cid]: { messages: r.messages, negotiations: r.negotiations ?? [] } }))).catch(fail('the chat'));
  };

  async function suspend() {
    const r0 = reason.trim();
    if (!r0) return setDlgErr('Write the reason: the owner sees it on every page.');
    setBusy(true); setDlgErr(null);
    const r = await api(`/api/v1/platform/merchants/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason: r0 }) });
    setBusy(false);
    if (!r.ok) return setDlgErr(await apiError(r));
    setSuspendOpen(false); setReason(''); load();
    toast(`${d!.merchant.business_name} is suspended`, 'success', { label: 'Undo', onClick: async () => { const u = await api(`/api/v1/platform/merchants/${id}/unsuspend`, { method: 'POST' }); if (!u.ok) toast(await apiError(u), 'error'); else { toast('Suspension lifted', 'info'); load(); } } });
  }
  async function lift() {
    setBusy(true); setDlgErr(null);
    const r = await api(`/api/v1/platform/merchants/${id}/unsuspend`, { method: 'POST' });
    setBusy(false);
    if (!r.ok) return setDlgErr(await apiError(r));
    setLiftOpen(false); load();
    toast(`${d!.merchant.business_name} is active again`, 'success');
  }

  if (failed) return <AppShell variant="platform"><BackLink href="/platform" label="Shops" /><div className="card"><div className="empty"><div className="display">Could not open this shop</div><div className="hint">{failed}</div><div className="action"><button type="button" className="btn ghost sm" onClick={load}>Try again</button></div></div></div></AppShell>;
  if (!d) return <AppShell variant="platform"><BackLink href="/platform" label="Shops" /><div className="skeleton" style={{ height: 40, width: 260, marginBottom: 20 }} /><div className="skeleton" style={{ height: 64, marginBottom: 20 }} /><div className="skeleton" style={{ height: 240 }} /></AppShell>;

  const m = d.merchant;
  const s = (m.settings ?? {}) as { botEnabled?: boolean; codEnabled?: boolean; defaultDeliveryCharge?: number; afterFreeQuota?: string; unpaidExpiryHours?: number; suspension?: { reason?: string; at?: string; by?: string } };
  const nd = (m.negotiation_defaults ?? {}) as { maxDiscountPct?: number; roundsMax?: number; stalemateAction?: string };
  const hours = Object.entries(m.business_hours ?? {});
  const suspended = m.status === 'suspended';
  const planName = (pid: string) => d.plans.find((p) => p.id === pid)?.label ?? humanize(pid);
  const q = d.connection.qualityRating ? QUALITY[d.connection.qualityRating] : undefined;
  const steps = Object.entries(d.readiness.steps);

  const section = (sid: string, title: string, Icon: typeof ShoppingBag, n: number, body: React.ReactNode) => (
    <details className="card section" style={{ marginTop: 16 }} open={openSections.includes(sid)} onToggle={(e) => toggleSection(sid, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary><h2><Icon aria-hidden /> {title} <span className="n">{n.toLocaleString('en-PK')}</span></h2><ChevronDown className="chev" aria-hidden /></summary>
      {body}
    </details>
  );

  return (
    <AppShell variant="platform">
      <BackLink href="/platform" label="Shops" />
      <PageHead title={m.business_name} sub={`${m.owner_name ?? 'Owner not named'} · ${m.email ?? 'no email'} · joined ${day(m.created_at)}`}
        action={<>
          <button type="button" className="btn ghost sm" onClick={() => { setDlgErr(null); setPlanOpen(true); }}><SlidersHorizontal aria-hidden /> Change plan</button>
          {suspended
            ? <button type="button" className="btn ghost sm" onClick={() => { setDlgErr(null); setLiftOpen(true); }}><PlayCircle aria-hidden /> Lift suspension</button>
            : <button type="button" className="btn danger-ghost sm" onClick={() => { setDlgErr(null); setSuspendOpen(true); }}><Ban aria-hidden /> Suspend…</button>}
        </>} />

      <div className={`status-strip ${sellingTone(d.selling) === 'success' ? '' : sellingTone(d.selling)}`} role="status">
        <SellingBadge s={d.selling} />
        {suspended && s.suspension?.reason && <div className="hint" style={{ maxWidth: 520 }}>Reason given: “{s.suspension.reason}”{s.suspension.by ? ` · by ${s.suspension.by}` : ''}{s.suspension.at ? ` · ${ago(s.suspension.at)}` : ''}</div>}
        <span className="hint">This visit is recorded · <Link href={`/platform/audit?merchantId=${m.id}`} className="link">Audit trail</Link></span>
      </div>

      <div className="split">
        <div className="card pad">
          <h2 style={{ marginBottom: 12 }}>Billing and usage</h2>
          <div className="kv tight">
            <div className="row"><span className="muted">Plan</span><span><span className="strong">{planName(m.plan)}</span>{d.subscription ? <> <Pill kind={subTone(d.subscription.status)}>{humanize(d.subscription.status)}</Pill></> : null}</span></div>
            {!d.subscription && <div className="row"><span className="muted">Subscription</span><span>None yet: sells without plan limits</span></div>}
            {d.subscription?.trial_ends_at && <div className="row"><span className="muted">Free pilot ends</span><span>{day(d.subscription.trial_ends_at)}</span></div>}
            {d.subscription?.current_period_end && <div className="row"><span className="muted">Paid to</span><span>{day(d.subscription.current_period_end)}</span></div>}
            {d.subscription?.requested_plan && <div className="row"><span className="muted">Owner asked for</span><span><span className="strong">{planName(d.subscription.requested_plan)}</span> · <button type="button" className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => setPlanOpen(true)}>review</button></span></div>}
          </div>
          <div className="divider" />
          <div style={{ display: 'grid', gap: 14 }}>
            <Meter label="Conversations this month" used={d.conversationsThisMonth} of={d.limits.conversations} detail="At the limit, new chats go to the owner." />
            <Meter label="Messages sent this month" used={d.usage.outbound} of={d.usage.freeQuota} detail={d.usage.paidOutbound ? `${d.usage.paidOutbound.toLocaleString('en-PK')} paid so far, about ${rs(d.usage.estimatedCostPaisa)}` : 'Meta charges for every message past the free 1,000.'} />
            <Meter label="AI replies today" used={d.usage.llmCallsToday} of={d.usage.llmDailyCap} />
          </div>
          {d.invoices.length > 0 && (
            <><div className="divider" /><h3 style={{ marginBottom: 8 }}>Invoices</h3>
              <div className="table-wrap"><table><thead><tr><th>Period</th><th>Plan</th><th className="num">Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
                {d.invoices.map((i) => <tr key={i.id}><td style={{ whiteSpace: 'nowrap' }}>{day(i.period_start)} to {day(i.period_end)}</td><td>{planName(i.plan)}</td><td className="num">{rs(i.amount_paisa)}</td><td><Pill kind={subTone(i.status)}>{humanize(i.status)}</Pill></td><td className="mono">{i.reference ?? '—'}</td></tr>)}
              </tbody></table></div>
            </>
          )}
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 12 }}>WhatsApp</h2>
          <div className="kv tight">
            <div className="row"><span className="muted">Number</span><span className="mono">{d.connection.displayPhone ? phone(d.connection.displayPhone) : '—'}</span></div>
            <div className="row"><span className="muted">Connection</span><span>{humanize(d.connection.status)}</span></div>
            <div className="row"><span className="muted">Message quality</span><span>{q ? <Pill kind={q.tone}>{q.label}</Pill> : 'Not rated yet'}</span></div>
            <div className="row"><span className="muted">Messaging tier</span><span>{d.connection.messagingTier ? humanize(d.connection.messagingTier) : '—'}</span></div>
            <div className="row"><span className="muted">Last test message</span><span>{ago(d.connection.lastTestAt)}</span></div>
          </div>
          {d.connection.message && <div className="form-error" style={{ marginTop: 12, marginBottom: 0 }}><AlertTriangle aria-hidden /><span>{d.connection.message}</span></div>}
          {d.connection.templates.length > 0 && (
            <><div className="divider" /><h3 style={{ marginBottom: 8 }}>Templates</h3>
              {d.connection.templates.map((t) => <div key={t.name} className="row between" style={{ marginBottom: 6 }}><span className="mono">{t.name}</span><Pill kind={t.status === 'approved' ? 'success' : t.status === 'rejected' || t.status === 'disabled' ? 'danger' : 'warning'}>{humanize(t.status)}</Pill></div>)}
            </>
          )}
          <div className="divider" />
          <details onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loaders.attempts()}>
            <summary className="link" style={{ cursor: 'pointer' }}>Connect attempts</summary>
            <div style={{ marginTop: 8 }}>
              {!attempts ? <div className="skeleton" style={{ height: 32 }} /> : attempts.length === 0 ? <div className="hint">None recorded.</div> : attempts.map((a) => (
                <div key={a.id} className="hint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}><span>{dt(a.created_at)}</span><span className="mono">{a.status}</span>{a.error_code && <span>{a.error_code}: {a.error_message}</span>}</div>
              ))}
            </div>
          </details>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16, alignItems: 'start', gap: 16 }}>
        <div className="card pad">
          <h2 style={{ marginBottom: 4 }}>Ready to sell</h2>
          <p className="hint" style={{ marginBottom: 12 }}>{d.readiness.ready ? 'Every setup step is done.' : `${steps.filter(([, st]) => !st.ok).length} of ${steps.length} setup steps still open.`}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {steps.map(([k, st]) => (
              <li key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                {st.ok ? <CheckCircle2 size={17} aria-hidden style={{ color: 'var(--success-ink)', flex: 'none', marginTop: 2 }} /> : <CircleDashed size={17} aria-hidden style={{ color: 'var(--warning)', flex: 'none', marginTop: 2 }} />}
                <span><span className={st.ok ? '' : 'strong'}>{STEP_LABEL[k] ?? humanize(k)}</span><span className="sr-only">{st.ok ? ': done' : ': not done'}</span>{!st.ok && st.reason && <span className="hint" style={{ display: 'block' }}>{st.reason}</span>}</span>
              </li>
            ))}
          </ul>
          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>People</h3>
          {d.members.map((u) => <div key={u.id} className="row between" style={{ marginBottom: 6 }}><span>{u.email ?? u.name ?? '—'} <span className="hint">· {humanize(u.role)}</span></span>{!u.is_active && <Pill kind="neutral">Inactive</Pill>}</div>)}
          <div className="kv" style={{ marginTop: 10 }}>
            <div className="row"><span className="muted">Phone</span><span className="mono">{phone(m.phone)}</span></div>
            <div className="row"><span className="muted">Address</span><span style={{ textAlign: 'right' }}>{m.address ?? '—'}</span></div>
            <div className="row"><span className="muted">Category</span><span>{m.category ? humanize(m.category) : '—'}</span></div>
          </div>
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 12 }}>How the bot sells</h2>
          <div className="kv tight">
            <div className="row"><span className="muted">Bot switch</span><span>{onOff(s.botEnabled)}</span></div>
            <div className="row"><span className="muted">Cash on delivery</span><span>{onOff(s.codEnabled)}</span></div>
            <div className="row"><span className="muted">Persona</span><span>{m.bot_persona?.name ?? '—'}{m.bot_persona?.style ? ` · ${humanize(m.bot_persona.style)}` : ''}</span></div>
            <div className="row"><span className="muted">Bargaining</span><span>up to {nd.maxDiscountPct ?? 0}% off · {nd.roundsMax ?? 3} rounds · then {nd.stalemateAction === 'hold_and_close' ? 'holds its price' : 'hands to the owner'}</span></div>
            <div className="row"><span className="muted">Default delivery</span><span>{rs(s.defaultDeliveryCharge ?? 0)}</span></div>
            <div className="row"><span className="muted">Unpaid orders expire</span><span>after {s.unpaidExpiryHours ?? 24} h</span></div>
            <div className="row"><span className="muted">After 1,000 free messages</span><span>{s.afterFreeQuota === 'handoff' ? 'Hands new chats to the owner' : 'Keeps selling (paid)'}</span></div>
          </div>
          {m.bot_persona?.greeting && <p className="hint" style={{ marginTop: 10 }}>Greeting: “{m.bot_persona.greeting}”</p>}
          {hours.length > 0 && <><div className="divider" /><h3 style={{ marginBottom: 6 }}>Hours</h3><div className="hint">{hours.map(([dayName, h]) => `${humanize(dayName)} ${h.closed ? 'closed' : `${h.open}–${h.close}`}`).join(' · ')}</div></>}
          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Delivery areas</h3>
          {d.zones.length === 0 ? <div className="hint">None listed.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Area</th><th className="num">Charge</th><th>Delivers</th></tr></thead><tbody>
              {d.zones.map((z) => <tr key={z.id}><td>{z.area_name}{z.city ? `, ${z.city}` : ''}</td><td className="num">{rs(z.charge)}</td><td>{z.is_serviceable ? 'Yes' : <Pill kind="neutral">No</Pill>}</td></tr>)}
            </tbody></table></div>
          )}
          <div className="divider" />
          <h3 style={{ marginBottom: 8 }}>Bank accounts</h3>
          {d.bankAccounts.length === 0 ? <div className="hint">None.</div> : d.bankAccounts.map((b) => <div key={b.id} className="row between" style={{ marginBottom: 4 }}><span>{b.bank_name}{b.account_title ? ` · ${b.account_title}` : ''}</span>{b.is_default && <Pill kind="brand">Default</Pill>}</div>)}
          <div className="hint" style={{ marginTop: 6 }}>Account numbers are never shown here.</div>
        </div>
      </div>

      {section('orders', 'Orders', ShoppingBag, d.counts.orders, !orders ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : orders.length === 0 ? <div className="pad hint">No placed orders yet.</div> : (
        <div className="table-wrap"><table className="rtable"><thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead><tbody>
          {orders.map((o) => <tr key={o.id}><td data-label="Order" className="mono">{o.order_number}</td><td data-label="Placed" className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(o.created_at)}</td><td data-label="Customer">{o.delivery_name ?? '—'}</td><td data-label="Status"><StatusPill status={o.status} /></td><td data-label="Payment"><PaymentPill status={o.payment_status} /><div className="hint">{humanize(o.payment_method)}</div></td><td data-label="Total" className="num strong">{rs(o.total)}</td></tr>)}
        </tbody></table></div>
      ))}

      {section('chats', 'Chats', MessagesSquare, d.counts.chats, !convos ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : convos.length === 0 ? <div className="pad hint">No open chats.</div> : (
        <div className="table-wrap"><table className="rtable"><thead><tr><th>Customer</th><th>Where it stands</th><th>Last message</th></tr></thead><tbody>
          {convos.map((c) => {
            const who = c.customers?.name || phone(c.customers?.wa_id);
            const chat = chats[c.id];
            return (
              <Fragment key={c.id}>
                <tr>
                  <td data-label="Customer">
                    <button type="button" className="btn ghost sm" onClick={() => toggleChat(c.id)} aria-expanded={openChat === c.id} aria-controls={`chat-${c.id}`}>{openChat === c.id ? 'Hide' : 'Read'} chat with {who}</button>
                    {c.customers?.is_blocked && <> <Pill kind="neutral">Blocked</Pill></>}
                    {c.customers?.wa_opt_in_status === 'out' && <> <Pill kind="warning">Opted out</Pill></>}
                  </td>
                  <td data-label="Where it stands">{c.status === 'human_takeover' ? 'Owner replying' : 'Bot'} · {humanize(c.current_state)}{c.unread_count > 0 && <div className="hint">{c.unread_count} unread by the owner</div>}</td>
                  <td data-label="Last message" className="muted">{ago(c.last_message_at)}</td>
                </tr>
                {openChat === c.id && (
                  <tr><td colSpan={3} id={`chat-${c.id}`} style={{ background: 'var(--surface-hover)' }}>
                    {!chat ? <div className="skeleton" style={{ height: 60 }} /> : <>
                      {chat.negotiations.length > 0 && (
                        <div className="table-wrap" style={{ marginBottom: 12 }}>
                          <table><caption className="sr-only">Price negotiation in this chat</caption><thead><tr><th>Product</th><th className="num">List</th><th className="num">Floor</th><th className="num">Customer offered</th><th className="num">Bot offered</th><th>Result</th></tr></thead><tbody>
                            {chat.negotiations.map((n) => {
                              const kept = (n.last_bot_offer == null || n.last_bot_offer >= n.floor_price) && (n.agreed_price == null || n.agreed_price >= n.floor_price);
                              return <tr key={n.id}><td style={{ minWidth: 180 }}>{n.productName ?? 'Cart'}{n.quantity > 1 ? ` × ${n.quantity}` : ''}</td><td className="num">{rs(n.list_price)}</td><td className="num">{rs(n.floor_price)}</td><td className="num">{n.last_customer_offer != null ? rs(n.last_customer_offer) : '—'}</td><td className="num">{n.last_bot_offer != null ? rs(n.last_bot_offer) : '—'}</td>
                                <td>{n.agreed_price != null ? <>Agreed {rs(n.agreed_price)} </> : <>{humanize(n.status)} </>}{kept ? <Pill kind="success">Kept to floor</Pill> : <Pill kind="danger">Below floor</Pill>}</td></tr>;
                            })}
                          </tbody></table>
                        </div>
                      )}
                      {chat.messages.length === 0 ? <div className="hint">No messages.</div> : (
                        <div className="thread" role="log" aria-label={`Chat with ${who}`}>
                          {chat.messages.map((mm, i) => {
                            const inbound = mm.direction === 'inbound';
                            const agent = mm.sender === 'agent';
                            return (
                              <div key={i} className={`bubble-wrap ${inbound ? 'in' : 'out'}${agent ? ' agent' : ''}`}>
                                <div className="who">{inbound ? who : agent ? 'Owner' : 'Bot'} · {dt(mm.created_at)}</div>
                                <div className="bubble">{mm.body ?? `[${humanize(mm.sender)}: no text]`}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>}
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody></table></div>
      ))}

      {section('catalog', 'Catalog', Package, d.counts.products, !products ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : products.length === 0 ? <div className="pad hint">No products.</div> : (
        <div className="table-wrap"><table className="rtable"><thead><tr><th>Product</th><th className="num">Price</th><th className="num">Floor</th><th className="num">Cost</th><th className="num">Stock</th><th>For sale</th></tr></thead><tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td data-label="Product">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {p.thumbnailUrl
                    // eslint-disable-next-line @next/next/no-img-element -- storage thumbnails, already small; next/image would need the Supabase host configured
                    ? <img src={p.thumbnailUrl} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: 'cover' }} />
                    : <span className="thumb" aria-hidden><Package /></span>}
                  <span>{p.name}{p.sku && <span className="hint mono" style={{ display: 'block' }}>{p.sku}</span>}</span>
                </span>
              </td>
              <td data-label="Price" className="num">{rs(p.price)}</td>
              <td data-label="Floor" className="num">{p.negotiable === false ? <span className="hint">Fixed price</span> : rs(p.floor)}</td>
              <td data-label="Cost" className="num">{p.cost != null ? rs(p.cost) : '—'}</td>
              <td data-label="Stock" className="num">{!p.track_stock ? <span className="hint">Not tracked</span> : p.stock == null ? <span className="hint">Unknown, won’t sell</span> : p.stock}</td>
              <td data-label="For sale">{p.is_active ? <Pill kind="success">Yes</Pill> : <Pill kind="neutral">No</Pill>}</td>
            </tr>
          ))}
        </tbody></table></div>
      ))}

      <ChangePlanDialog open={planOpen} shop={m.business_name} merchantId={m.id} current={m.plan} requested={d.subscription?.requested_plan} plans={d.plans} onClose={() => setPlanOpen(false)}
        onDone={(prev, next) => {
          setPlanOpen(false); load();
          toast(`${m.business_name} is now on ${planName(next)}`, 'success', { label: 'Undo', onClick: async () => { const e = await changePlan(m.id, prev); if (e) toast(e, 'error'); else { toast(`Back on ${planName(prev)}`, 'info'); load(); } } });
        }} />

      <Dialog open={suspendOpen} onClose={() => setSuspendOpen(false)} busy={busy} title={`Suspend ${m.business_name}?`}
        actions={<button type="button" className="btn danger" onClick={suspend} disabled={busy}><Ban aria-hidden /> {busy ? 'Suspending…' : 'Suspend shop'}</button>}>
        <p>The bot stops replying at once and the owner’s portal becomes read-only. Buyers’ messages are still stored.</p>
        <dl className="facts">
          <dt>Chats active today</dt><dd>{d.impact.liveChats.toLocaleString('en-PK')}</dd>
          <dt>Buyers mid-checkout</dt><dd>{d.impact.midCheckout.toLocaleString('en-PK')}{d.impact.midCheckout > 0 ? ' (their orders will not complete)' : ''}</dd>
        </dl>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="suspend-reason">Reason, shown to the owner</label>
          <textarea id="suspend-reason" rows={3} maxLength={SUSPEND_MAX} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Invoice for September unpaid after two reminders" />
          <div className="help">{reason.length}/{SUSPEND_MAX}</div>
        </div>
        <div className="preview" aria-label="What the owner will see">
          <div className="strong">This shop is suspended.</div>
          Reason: {reason.trim() || '…'}. The bot is not replying and the portal is read-only. Contact support to resolve this.
        </div>
        {dlgErr && <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>{dlgErr}</span></div>}
      </Dialog>

      <Dialog open={liftOpen} onClose={() => setLiftOpen(false)} busy={busy} title={`Lift ${m.business_name}'s suspension?`}
        actions={<button type="button" className="btn" onClick={lift} disabled={busy}><PlayCircle aria-hidden /> {busy ? 'Lifting…' : 'Lift suspension'}</button>}>
        <p>The bot replies to buyers again and the portal works normally. The owner is told.</p>
        {s.suspension?.reason && <p className="hint">It was suspended for: “{s.suspension.reason}”.</p>}
        {dlgErr && <div className="form-error" role="alert" style={{ margin: 0 }}><AlertTriangle aria-hidden /><span>{dlgErr}</span></div>}
      </Dialog>
    </AppShell>
  );
}
