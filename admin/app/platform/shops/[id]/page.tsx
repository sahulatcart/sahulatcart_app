'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Package, MessagesSquare, ShoppingBag } from 'lucide-react';
import AppShell, { BackLink, PageHead, PaymentPill, Pill, StatusPill, humanize } from '../../../../components/AppShell';
import { apiJson, dt, rs } from '../../../../lib/api';
import { useToast } from '../../../../components/Toast';

/** U1: the founders' read-only look inside one shop. Nothing on this page can write. */

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
  botMode: { mode: string; reason: string | null };
  readiness: { ready: boolean; steps: Record<string, { ok: boolean; reason?: string }> };
  connection: { status: string; displayPhone?: string; qualityRating?: string; messagingTier?: string; flagReason?: string | null; message?: string | null; lastTestAt?: string | null; templates: { name: string; status: string; rejectionReason: string | null }[] };
}
interface Order { id: string; order_number: string; status: string; payment_method: string; payment_status: string; total: number; delivery_name: string | null; created_at: string }
interface Convo { id: string; status: string; current_state: string; last_message_at: string | null; unread_count: number; customers: { name: string | null; wa_id: string; wa_opt_in_status: string; is_blocked: boolean } | null }
interface Msg { direction: string; sender: string; body: string | null; status: string; created_at: string }
interface Product { id: string; name: string; sku: string | null; price: number; cost: number | null; stock: number | null; is_active: boolean; thumbnailUrl: string | null }

const connTone = (s: string) => (s === 'connected' ? 'success' : s === 'needs_attention' || s === 'connecting' ? 'warning' : s === 'disconnected' ? 'danger' : 'neutral');
const subTone = (s: string) => (s === 'active' || s === 'trial' || s === 'paid' ? 'success' : s === 'past_due' || s === 'due' ? 'warning' : s === 'expired' ? 'danger' : 'neutral');
const yesNo = (v: unknown) => (v === false ? 'off' : 'on');

export default function PlatformShop() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [openChat, setOpenChat] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({});
  const fail = useCallback((what: string) => (e: unknown) => toast((e as Error)?.message || `Could not load ${what}`, 'error'), [toast]);
  const base = `/api/v1/platform/merchants/${id}`;

  useEffect(() => { apiJson<Detail>(base).then(setD).catch(fail('this shop')); }, [base, fail]);
  const loadOrders = () => { if (!orders) apiJson<{ orders: Order[] }>(`${base}/orders`).then((r) => setOrders(r.orders)).catch(fail('orders')); };
  const loadConvos = () => { if (!convos) apiJson<{ conversations: Convo[] }>(`${base}/conversations`).then((r) => setConvos(r.conversations)).catch(fail('chats')); };
  const loadProducts = () => { if (!products) apiJson<{ products: Product[] }>(`${base}/products`).then((r) => setProducts(r.products)).catch(fail('the catalog')); };
  const toggleChat = (cid: string) => {
    if (openChat === cid) { setOpenChat(null); return; }
    setOpenChat(cid);
    if (!msgs[cid]) apiJson<{ messages: Msg[] }>(`${base}/conversations/${cid}`).then((r) => setMsgs((m) => ({ ...m, [cid]: r.messages }))).catch(fail('the chat'));
  };

  if (!d) return <AppShell><BackLink href="/platform" label="Platform" /><div className="skeleton" style={{ height: 40, width: 260, marginBottom: 20 }} /><div className="skeleton" style={{ height: 240 }} /></AppShell>;
  const m = d.merchant;
  const s = (m.settings ?? {}) as { botEnabled?: boolean; codEnabled?: boolean; defaultDeliveryCharge?: number; freeDeliveryThreshold?: number; afterFreeQuota?: string; unpaidExpiryHours?: number; suspension?: { reason?: string } };
  const nd = (m.negotiation_defaults ?? {}) as { maxDiscountPct?: number; roundsMax?: number; stalemateAction?: string; openingStance?: string };
  const hours = Object.entries(m.business_hours ?? {});

  return (
    <AppShell>
      <BackLink href="/platform" label="Platform" />
      <PageHead title={m.business_name} sub={`${m.owner_name ?? '—'} · ${m.email ?? '—'} · joined ${dt(m.created_at, true)}`}
        action={<><Pill kind={m.status === 'suspended' ? 'danger' : 'success'}>{m.status}</Pill><Pill kind="brand">{m.plan}</Pill><Pill kind={connTone(d.connection.status)}>WhatsApp {humanize(d.connection.status)}</Pill></>} />
      {s.suspension?.reason && <div className="notice" role="note">Suspended: {s.suspension.reason}</div>}

      <div className="split">
        <div className="card pad">
          <h2 style={{ marginBottom: 10 }}>Overview</h2>
          <div className="kv">
            <div className="row"><span className="muted">Phone</span><span className="mono">{m.phone ?? '—'}</span></div>
            <div className="row"><span className="muted">Address</span><span>{m.address ?? '—'}</span></div>
            <div className="row"><span className="muted">Category</span><span>{m.category ? humanize(m.category) : '—'}</span></div>
          </div>
          <div className="divider" />
          <h3>Members</h3>
          <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>State</th></tr></thead><tbody>
            {d.members.map((u) => <tr key={u.id}><td>{u.email ?? u.name ?? '—'}</td><td>{humanize(u.role)}</td><td><Pill kind={u.is_active ? 'success' : 'neutral'}>{u.is_active ? 'active' : 'inactive'}</Pill></td></tr>)}
          </tbody></table></div>
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 10 }}>WhatsApp</h2>
          <div className="kv">
            <div className="row"><span className="muted">Number</span><span className="mono">{d.connection.displayPhone ? `+${d.connection.displayPhone}` : '—'}</span></div>
            <div className="row"><span className="muted">Quality</span><span>{d.connection.qualityRating ?? '—'}</span></div>
            <div className="row"><span className="muted">Tier</span><span>{d.connection.messagingTier ? humanize(d.connection.messagingTier) : '—'}</span></div>
            <div className="row"><span className="muted">Last test</span><span>{dt(d.connection.lastTestAt)}</span></div>
          </div>
          {d.connection.flagReason && <div className="hint" style={{ marginTop: 8 }}>Flag: {d.connection.flagReason}. {d.connection.message}</div>}
          {d.connection.templates.length > 0 && (
            <><div className="divider" /><h3>Templates</h3>
              {d.connection.templates.map((t) => <div key={t.name} className="row between"><span className="mono">{t.name}</span><Pill kind={t.status === 'approved' ? 'success' : t.status === 'rejected' ? 'danger' : 'warning'}>{t.status}</Pill></div>)}
            </>
          )}
          <div className="divider" />
          <h3>Readiness</h3>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(d.readiness.steps).map(([k, st]) => <Pill key={k} kind={st.ok ? 'success' : 'warning'}>{humanize(k)}</Pill>)}
          </div>
          {Object.entries(d.readiness.steps).filter(([, st]) => !st.ok).map(([k, st]) => <div key={k} className="hint">{humanize(k)}: {st.reason}</div>)}
        </div>
      </div>

      <div className="split" style={{ marginTop: 24 }}>
        <div className="card pad">
          <h2 style={{ marginBottom: 10 }}>Billing</h2>
          <div className="kv">
            <div className="row"><span className="muted">Subscription</span><span>{d.subscription ? <><Pill kind={subTone(d.subscription.status)}>{humanize(d.subscription.status)}</Pill> {humanize(d.subscription.plan)}</> : 'none (sells, pre-P7)'}</span></div>
            {d.subscription?.trial_ends_at && <div className="row"><span className="muted">Trial ends</span><span>{dt(d.subscription.trial_ends_at)}</span></div>}
            {d.subscription?.current_period_end && <div className="row"><span className="muted">Period ends</span><span>{dt(d.subscription.current_period_end)}</span></div>}
            {d.subscription?.requested_plan && <div className="row"><span className="muted">Requested</span><span>{humanize(d.subscription.requested_plan)}</span></div>}
            <div className="row"><span className="muted">Bot mode</span><span><Pill kind={d.botMode.mode === 'sell' ? 'success' : d.botMode.mode === 'handoff' ? 'warning' : 'neutral'}>{d.botMode.mode}</Pill>{d.botMode.reason ? ` ${humanize(d.botMode.reason)}` : ''}</span></div>
            <div className="row"><span className="muted">Conversations this month</span><span>{d.conversationsThisMonth.toLocaleString('en-PK')} of {d.limits.conversations.toLocaleString('en-PK')}</span></div>
            <div className="row"><span className="muted">Messages sent</span><span>{d.usage.outbound.toLocaleString('en-PK')} of {d.usage.freeQuota.toLocaleString('en-PK')} free{d.usage.paidOutbound ? `, ${d.usage.paidOutbound.toLocaleString('en-PK')} paid (~${rs(d.usage.estimatedCostPaisa)})` : ''}</span></div>
            <div className="row"><span className="muted">AI calls today</span><span>{d.usage.llmCallsToday.toLocaleString('en-PK')} of {d.usage.llmDailyCap.toLocaleString('en-PK')}</span></div>
          </div>
          {d.invoices.length > 0 && (
            <><div className="divider" /><h3>Invoices</h3>
              <div className="table-wrap"><table><thead><tr><th>Period</th><th>Plan</th><th className="num">Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>
                {d.invoices.map((i) => <tr key={i.id}><td style={{ whiteSpace: 'nowrap' }}>{dt(i.period_start)} to {dt(i.period_end)}</td><td>{humanize(i.plan)}</td><td className="num">{rs(i.amount_paisa)}</td><td><Pill kind={subTone(i.status)}>{i.status}</Pill></td><td className="mono">{i.reference ?? '—'}</td></tr>)}
              </tbody></table></div>
            </>
          )}
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 10 }}>Settings</h2>
          <div className="kv">
            <div className="row"><span className="muted">Bot</span><span>{yesNo(s.botEnabled)}</span></div>
            <div className="row"><span className="muted">Cash on delivery</span><span>{yesNo(s.codEnabled)}</span></div>
            <div className="row"><span className="muted">Default delivery</span><span>{rs(s.defaultDeliveryCharge ?? 0)}</span></div>
            <div className="row"><span className="muted">After free messages</span><span>{humanize(s.afterFreeQuota ?? 'continue')}</span></div>
            <div className="row"><span className="muted">Unpaid orders expire</span><span>{s.unpaidExpiryHours ?? 24} h</span></div>
            <div className="row"><span className="muted">Bot persona</span><span>{m.bot_persona?.name ?? '—'}{m.bot_persona?.style ? ` · ${humanize(m.bot_persona.style)}` : ''}</span></div>
            <div className="row"><span className="muted">Max discount</span><span>{nd.maxDiscountPct ?? '—'}% · {nd.roundsMax ?? '—'} rounds · {humanize(nd.stalemateAction ?? 'handoff')}</span></div>
          </div>
          {m.bot_persona?.greeting && <div className="hint" style={{ marginTop: 8 }}>Greeting: {m.bot_persona.greeting}</div>}
          {hours.length > 0 && <><div className="divider" /><h3>Hours</h3><div className="hint">{hours.map(([day, h]) => `${humanize(day)} ${h.closed ? 'closed' : `${h.open}–${h.close}`}`).join(' · ')}</div></>}
          <div className="divider" />
          <h3>Delivery areas</h3>
          {d.zones.length === 0 ? <div className="hint">None listed.</div> : (
            <div className="table-wrap"><table><thead><tr><th>Area</th><th className="num">Charge</th><th>Serviceable</th></tr></thead><tbody>
              {d.zones.map((z) => <tr key={z.id}><td>{z.area_name}{z.city ? `, ${z.city}` : ''}</td><td className="num">{rs(z.charge)}</td><td>{z.is_serviceable ? 'yes' : 'no'}</td></tr>)}
            </tbody></table></div>
          )}
          <div className="divider" />
          <h3>Bank accounts</h3>
          {d.bankAccounts.length === 0 ? <div className="hint">None.</div> : d.bankAccounts.map((b) => <div key={b.id} className="row between"><span>{b.bank_name}{b.account_title ? ` · ${b.account_title}` : ''}</span>{b.is_default && <Pill kind="brand">default</Pill>}</div>)}
          <div className="hint" style={{ marginTop: 6 }}>Account numbers are never shown here.</div>
        </div>
      </div>

      <details className="card" style={{ marginTop: 24 }} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadOrders()}>
        <summary className="card-head" style={{ cursor: 'pointer' }}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ShoppingBag aria-hidden /> Orders</h2></summary>
        {!orders ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : orders.length === 0 ? <div className="pad hint">No placed orders.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead><tbody>
            {orders.map((o) => <tr key={o.id}><td className="mono">{o.order_number}</td><td className="muted" style={{ whiteSpace: 'nowrap' }}>{dt(o.created_at)}</td><td>{o.delivery_name ?? '—'}</td><td><StatusPill status={o.status} /></td><td><PaymentPill status={o.payment_status} /><div className="hint">{humanize(o.payment_method)}</div></td><td className="num strong">{rs(o.total)}</td></tr>)}
          </tbody></table></div>
        )}
      </details>

      <details className="card" style={{ marginTop: 16 }} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadConvos()}>
        <summary className="card-head" style={{ cursor: 'pointer' }}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MessagesSquare aria-hidden /> Chats</h2></summary>
        {!convos ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : convos.length === 0 ? <div className="pad hint">No chats.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Customer</th><th>State</th><th>Last message</th><th className="num">Unread</th></tr></thead><tbody>
            {convos.map((c) => (
              <>
                <tr key={c.id}>
                  <td><button className="btn ghost sm" onClick={() => toggleChat(c.id)} aria-expanded={openChat === c.id}>{c.customers?.name || c.customers?.wa_id || '?'}</button>{c.customers?.is_blocked && <Pill kind="neutral">blocked</Pill>}{c.customers?.wa_opt_in_status === 'out' && <Pill kind="warning">opted out</Pill>}</td>
                  <td>{c.status === 'human_takeover' ? 'Merchant replying' : 'Bot'} · {humanize(c.current_state)}</td>
                  <td className="muted">{dt(c.last_message_at)}</td>
                  <td className="num">{c.unread_count}</td>
                </tr>
                {openChat === c.id && (
                  <tr key={`${c.id}-msgs`}><td colSpan={4} style={{ background: 'var(--surface)' }}>
                    {!msgs[c.id] ? <div className="skeleton" style={{ height: 40 }} /> : msgs[c.id]!.length === 0 ? <div className="hint">No messages.</div> : msgs[c.id]!.map((mm, i) => (
                      <div key={i} style={{ textAlign: mm.direction === 'inbound' ? 'left' : 'right', margin: '4px 0' }}>
                        <div className="bubble" style={{ display: 'inline-block', maxWidth: '70%' }}>{mm.body ?? `[${mm.sender}]`}</div>
                        <div className="hint">{mm.direction === 'inbound' ? 'Customer' : mm.sender === 'agent' ? 'Merchant' : 'Bot'} · {dt(mm.created_at)}</div>
                      </div>
                    ))}
                  </td></tr>
                )}
              </>
            ))}
          </tbody></table></div>
        )}
      </details>

      <details className="card" style={{ marginTop: 16 }} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadProducts()}>
        <summary className="card-head" style={{ cursor: 'pointer' }}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Package aria-hidden /> Catalog</h2></summary>
        {!products ? <div className="skeleton" style={{ height: 60, margin: 16 }} /> : products.length === 0 ? <div className="pad hint">No products.</div> : (
          <div className="table-wrap"><table><thead><tr><th>Product</th><th className="num">Price</th><th className="num">Cost</th><th className="num">Stock</th><th>Active</th></tr></thead><tbody>
            {products.map((p) => (
              <tr key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{p.thumbnailUrl ? <img src={p.thumbnailUrl} alt="" width={32} height={32} style={{ borderRadius: 6, objectFit: 'cover' }} /> : <span className="thumb" aria-hidden><Package /></span>}{p.name}{p.sku && <span className="hint mono"> {p.sku}</span>}</span></td>
                <td className="num">{rs(p.price)}</td><td className="num">{p.cost != null ? rs(p.cost) : '—'}</td><td className="num">{p.stock ?? '∞'}</td><td><Pill kind={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'active' : 'inactive'}</Pill></td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </details>

      <p className="hint" style={{ marginTop: 16 }}><Link href={`/platform/audit?merchantId=${m.id}`} className="link">Audit trail for this shop</Link> · every look at this page is recorded.</p>
    </AppShell>
  );
}
