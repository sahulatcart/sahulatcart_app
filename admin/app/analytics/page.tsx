'use client';
import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import { apiJson, rs } from '../../lib/api';

interface A {
  totalOrders: number;
  grossRevenue: number;
  collectedRevenue: number;
  returnCancelRate: number;
  codVsBank: { cod: number; bank: number };
  negotiationWinRate: number;
  avgDiscountPct: number;
  negotiationsAgreed: number;
}

export default function Analytics() {
  const [a, setA] = useState<A | null>(null);
  useEffect(() => { apiJson<A>('/api/v1/admin/analytics').then(setA).catch(() => {}); }, []);
  if (!a) return <AppShell><p>Loading…</p></AppShell>;

  return (
    <AppShell>
      <h1>Analytics</h1>
      <div className="cards">
        <div className="card"><div className="k">Orders placed</div><div className="v">{a.totalOrders}</div></div>
        <div className="card"><div className="k">Collected revenue</div><div className="v">{rs(a.collectedRevenue)}</div></div>
        <div className="card"><div className="k">Gross (all orders)</div><div className="v">{rs(a.grossRevenue)}</div></div>
        <div className="card"><div className="k">Return / cancel rate</div><div className="v">{a.returnCancelRate}%</div></div>
      </div>
      <h2>Negotiation</h2>
      <div className="cards">
        <div className="card"><div className="k">Win rate</div><div className="v">{a.negotiationWinRate}%</div><div className="k">of haggles closed</div></div>
        <div className="card"><div className="k">Avg discount given</div><div className="v">{a.avgDiscountPct}%</div></div>
        <div className="card"><div className="k">Deals agreed</div><div className="v">{a.negotiationsAgreed}</div></div>
      </div>
      <h2>Payment mix</h2>
      <div className="cards">
        <div className="card"><div className="k">Cash on Delivery</div><div className="v">{a.codVsBank.cod}</div></div>
        <div className="card"><div className="k">Bank transfer</div><div className="v">{a.codVsBank.bank}</div></div>
      </div>
    </AppShell>
  );
}
