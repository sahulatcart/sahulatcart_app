'use client';
import { useEffect, useState } from 'react';
import { Banknote, Handshake, Percent, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { apiJson, rs } from '../../lib/api';

interface A {
  totalOrders: number; grossRevenue: number; collectedRevenue: number; returnCancelRate: number;
  codVsBank: { cod: number; bank: number }; negotiationWinRate: number; avgDiscountPct: number; negotiationsAgreed: number;
}
const Stat = ({ icon, k, v, sub }: { icon: React.ReactNode; k: string; v: string | number; sub?: string }) => (
  <div className="stat"><div className="ico">{icon}</div><div className="k">{k}</div><div className="v">{v}</div>{sub && <div className="hint">{sub}</div>}</div>
);

export default function Analytics() {
  const [a, setA] = useState<A | null>(null);
  useEffect(() => { apiJson<A>('/api/v1/admin/analytics').then(setA).catch(() => {}); }, []);
  if (!a) return <AppShell><PageHead title="Analytics" /><div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 110 }} />)}</div></AppShell>;

  return (
    <AppShell>
      <PageHead title="Analytics" sub="How your shop and bot are performing" />
      <h2 style={{ marginTop: 4 }}>Sales</h2>
      <div className="stats">
        <Stat icon={<ShoppingBag />} k="Orders placed" v={a.totalOrders} />
        <Stat icon={<Wallet />} k="Collected revenue" v={rs(a.collectedRevenue)} />
        <Stat icon={<Banknote />} k="Gross (all orders)" v={rs(a.grossRevenue)} />
        <Stat icon={<TrendingUp />} k="Return / cancel rate" v={`${a.returnCancelRate}%`} />
      </div>
      <h2 style={{ marginTop: 24 }}>Negotiation</h2>
      <div className="stats">
        <Stat icon={<Handshake />} k="Win rate" v={`${a.negotiationWinRate}%`} sub="of haggles closed" />
        <Stat icon={<Percent />} k="Avg discount given" v={`${a.avgDiscountPct}%`} />
        <Stat icon={<Handshake />} k="Deals agreed" v={a.negotiationsAgreed} />
      </div>
      <h2 style={{ marginTop: 24 }}>Payment mix</h2>
      <div className="stats">
        <Stat icon={<Banknote />} k="Cash on Delivery" v={a.codVsBank.cod} />
        <Stat icon={<Wallet />} k="Bank transfer" v={a.codVsBank.bank} />
      </div>
    </AppShell>
  );
}
