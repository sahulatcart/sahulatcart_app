'use client';
import { useEffect, useState } from 'react';
import { Banknote, Handshake, Percent, ShoppingBag, TrendingUp, Wallet, type LucideIcon } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { apiJson, rs } from '../../lib/api';

interface A {
  totalOrders: number; grossRevenue: number; collectedRevenue: number; returnCancelRate: number;
  codVsBank: { cod: number; bank: number }; negotiationWinRate: number; avgDiscountPct: number; negotiationsAgreed: number;
}
const Stat = ({ Icon, k, v, sub }: { Icon: LucideIcon; k: string; v: string | number; sub?: string }) => (
  <div className="stat"><div className="ico"><Icon aria-hidden /></div><div className="k">{k}</div><div className="v">{v}</div>{sub && <div className="hint">{sub}</div>}</div>
);

export default function Analytics() {
  const [a, setA] = useState<A | null>(null);
  useEffect(() => { apiJson<A>('/api/v1/admin/analytics').then(setA).catch(() => {}); }, []);
  if (!a) return <AppShell><PageHead title="Analytics" sub="How your shop and bot are performing" /><div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div></AppShell>;

  const payTotal = a.codVsBank.cod + a.codVsBank.bank;
  const pct = (n: number) => (payTotal ? Math.round((n / payTotal) * 100) : 0);

  return (
    <AppShell>
      <PageHead title="Analytics" sub="How your shop and bot are performing — all time" />

      <div className="eyebrow">Sales</div>
      <div className="stats">
        <Stat Icon={ShoppingBag} k="Orders placed" v={a.totalOrders} />
        <Stat Icon={Wallet} k="Collected revenue" v={rs(a.collectedRevenue)} sub="Verified or cash collected" />
        <Stat Icon={Banknote} k="Gross revenue" v={rs(a.grossRevenue)} sub="All placed orders" />
        <Stat Icon={TrendingUp} k="Return / cancel rate" v={`${a.returnCancelRate}%`} />
      </div>

      <div className="eyebrow">Negotiation</div>
      <div className="stats">
        <Stat Icon={Handshake} k="Win rate" v={`${a.negotiationWinRate}%`} sub="Of haggles that closed" />
        <Stat Icon={Percent} k="Average discount" v={`${a.avgDiscountPct}%`} sub="Off list price, on agreed deals" />
        <Stat Icon={Handshake} k="Deals agreed" v={a.negotiationsAgreed} />
      </div>

      <div className="eyebrow">Payment mix</div>
      <div className="card pad">
        {payTotal === 0 ? (
          <div className="hint">No placed orders yet, so there&apos;s no payment mix to show.</div>
        ) : (
          <>
            <div className="bar" role="img" aria-label={`Cash on delivery ${pct(a.codVsBank.cod)} percent, bank transfer ${pct(a.codVsBank.bank)} percent`}>
              <span style={{ width: `${pct(a.codVsBank.cod)}%`, background: 'var(--brand)' }} />
              <span style={{ width: `${pct(a.codVsBank.bank)}%`, background: 'var(--chart-2)' }} />
            </div>
            <div className="legend num">
              <span><span className="sw" style={{ background: 'var(--brand)' }} />Cash on delivery — <strong>{a.codVsBank.cod}</strong> ({pct(a.codVsBank.cod)}%)</span>
              <span><span className="sw" style={{ background: 'var(--chart-2)' }} />Bank transfer — <strong>{a.codVsBank.bank}</strong> ({pct(a.codVsBank.bank)}%)</span>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
