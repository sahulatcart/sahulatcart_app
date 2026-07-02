'use client';
import { useEffect, useState } from 'react';
import AppShell from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';

interface P { id: string; name: string; price: number; stock: number | null; is_active: boolean; negotiable: boolean; max_discount_pct: number | null; min_price: number | null }

export default function Catalog() {
  const [products, setProducts] = useState<P[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', price: '', stock: '' });

  const load = () => apiJson<{ products: P[] }>('/api/v1/admin/products').then((r) => setProducts(r.products)).catch(() => {});
  useEffect(() => { load(); }, []);

  function edit(id: string, patch: Partial<P>) {
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  async function save(p: P) {
    setSaving(p.id);
    await api(`/api/v1/admin/products/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ price: p.price, stock: p.stock, is_active: p.is_active, negotiable: p.negotiable, max_discount_pct: p.max_discount_pct, min_price: p.min_price }),
    });
    setSaving(null);
  }
  async function add() {
    if (!adding.name || !adding.price) return;
    await api('/api/v1/admin/products', { method: 'POST', body: JSON.stringify({ name: adding.name, price: Math.round(Number(adding.price)) * 100, stock: adding.stock ? Number(adding.stock) : null, track_stock: !!adding.stock, negotiable: true, is_active: true }) });
    setAdding({ name: '', price: '', stock: '' });
    load();
  }

  return (
    <AppShell>
      <h1>Catalog</h1>
      <div className="section">
        <h2>Add product</h2>
        <div className="row">
          <input placeholder="Name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input placeholder="Price (Rs)" type="number" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} style={{ width: 120 }} />
          <input placeholder="Stock" type="number" value={adding.stock} onChange={(e) => setAdding({ ...adding, stock: e.target.value })} style={{ width: 90 }} />
          <button className="btn" onClick={add}>Add</button>
        </div>
      </div>
      <table>
        <thead><tr><th>Name</th><th>Price (Rs)</th><th>Stock</th><th>Negotiable</th><th>Max % off</th><th>Min price (Rs)</th><th>Active</th><th></th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td><input type="number" value={Math.round(p.price / 100)} onChange={(e) => edit(p.id, { price: Math.round(Number(e.target.value)) * 100 })} style={{ width: 90 }} /></td>
              <td><input type="number" value={p.stock ?? ''} onChange={(e) => edit(p.id, { stock: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 70 }} /></td>
              <td><input type="checkbox" checked={p.negotiable} onChange={(e) => edit(p.id, { negotiable: e.target.checked })} /></td>
              <td><input type="number" value={p.max_discount_pct ?? ''} onChange={(e) => edit(p.id, { max_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 70 }} disabled={!p.negotiable} /></td>
              <td><input type="number" value={p.min_price != null ? Math.round(p.min_price / 100) : ''} onChange={(e) => edit(p.id, { min_price: e.target.value === '' ? null : Math.round(Number(e.target.value)) * 100 })} style={{ width: 90 }} disabled={!p.negotiable} /></td>
              <td><input type="checkbox" checked={p.is_active} onChange={(e) => edit(p.id, { is_active: e.target.checked })} /></td>
              <td><button className="btn sec" onClick={() => save(p)} disabled={saving === p.id}>{saving === p.id ? '…' : 'Save'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>Tip: “Max % off” is the deepest discount the bot may give; “Min price” is an absolute floor (wins over %).</p>
    </AppShell>
  );
}
