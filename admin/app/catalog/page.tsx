'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileUp, Plus, RefreshCw } from 'lucide-react';
import AppShell, { PageHead } from '../../components/AppShell';
import { api, apiJson } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface P { id: string; name: string; price: number; stock: number | null; is_active: boolean; negotiable: boolean; max_discount_pct: number | null; min_price: number | null; thumbnailUrl?: string | null }

export default function Catalog() {
  const toast = useToast();
  const [products, setProducts] = useState<P[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', price: '', stock: '' });

  const load = () => apiJson<{ products: P[] }>('/api/v1/admin/products').then((r) => setProducts(r.products)).catch(() => {});
  useEffect(() => { load(); }, []);

  const edit = (id: string, patch: Partial<P>) => setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  async function save(p: P) {
    setSaving(p.id);
    await api(`/api/v1/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ price: p.price, stock: p.stock, is_active: p.is_active, negotiable: p.negotiable, max_discount_pct: p.max_discount_pct, min_price: p.min_price }) });
    setSaving(null); toast('Saved', 'success');
  }
  async function add() {
    if (!adding.name || !adding.price) return;
    await api('/api/v1/admin/products', { method: 'POST', body: JSON.stringify({ name: adding.name, price: Math.round(Number(adding.price)) * 100, stock: adding.stock ? Number(adding.stock) : null, track_stock: !!adding.stock, negotiable: true, is_active: true }) });
    setAdding({ name: '', price: '', stock: '' }); toast('Product added', 'success'); load();
  }
  async function importCsv(file: File) {
    const r = await apiJson<{ imported: number; errors: string[]; total: number }>('/api/v1/admin/products/import', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
    toast(`Imported ${r.imported}/${r.total}${r.errors.length ? ` · ${r.errors.length} errors` : ''}`, r.errors.length ? 'error' : 'success');
    load();
  }
  async function metaSync() {
    const r = await apiJson<{ synced: number; message?: string }>('/api/v1/admin/products/catalog-sync', { method: 'POST' });
    toast(r.message ? r.message : `Synced ${r.synced} products from Meta`, r.message ? 'info' : 'success');
    load();
  }
  const template = 'data:text/csv;charset=utf-8,' + encodeURIComponent('name,price,stock,negotiable,max_discount_pct,min_price,sku,description\nT-Shirt,2500,50,yes,20,,TSHIRT,Cotton tee\nMug,800,100,no,,,MUG,');

  return (
    <AppShell>
      <PageHead title="Catalog" sub="Products the bot can sell and negotiate" action={
        <div className="row">
          <label className="btn ghost sm" style={{ cursor: 'pointer' }}><FileUp /> Import CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
          <a className="btn ghost sm" href={template} download="catalog-template.csv"><Download /> Template</a>
          <button className="btn ghost sm" onClick={metaSync}><RefreshCw /> Meta sync</button>
        </div>
      } />

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="row">
          <input placeholder="Product name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} style={{ maxWidth: 240 }} />
          <input placeholder="Price (Rs)" type="number" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} className="mini" />
          <input placeholder="Stock" type="number" value={adding.stock} onChange={(e) => setAdding({ ...adding, stock: e.target.value })} className="mini" />
          <button className="btn" onClick={add}><Plus /> Add</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Price</th><th>Stock</th><th>Negotiable</th><th>Max % off</th><th>Min price</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/catalog/${p.id}`} className="strong" style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--brand-ink)' }}>
                      {p.thumbnailUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.thumbnailUrl} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border)' }} />
                        : <span style={{ width: 34, height: 34, borderRadius: 8, display: 'grid', placeItems: 'center', background: 'var(--bg)', border: '1px dashed var(--border)', fontSize: 15 }}>📦</span>}
                      {p.name}
                    </Link>
                  </td>
                  <td><input type="number" value={Math.round(p.price / 100)} onChange={(e) => edit(p.id, { price: Math.round(Number(e.target.value)) * 100 })} className="mini" /></td>
                  <td><input type="number" value={p.stock ?? ''} onChange={(e) => edit(p.id, { stock: e.target.value === '' ? null : Number(e.target.value) })} className="mini" style={{ width: 64 }} /></td>
                  <td><label className="switch"><input type="checkbox" checked={p.negotiable} onChange={(e) => edit(p.id, { negotiable: e.target.checked })} /><span className="track" /></label></td>
                  <td><input type="number" value={p.max_discount_pct ?? ''} onChange={(e) => edit(p.id, { max_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} className="mini" style={{ width: 64 }} disabled={!p.negotiable} /></td>
                  <td><input type="number" value={p.min_price != null ? Math.round(p.min_price / 100) : ''} onChange={(e) => edit(p.id, { min_price: e.target.value === '' ? null : Math.round(Number(e.target.value)) * 100 })} className="mini" disabled={!p.negotiable} /></td>
                  <td><label className="switch"><input type="checkbox" checked={p.is_active} onChange={(e) => edit(p.id, { is_active: e.target.checked })} /><span className="track" /></label></td>
                  <td><button className="btn ghost sm" onClick={() => save(p)} disabled={saving === p.id}>{saving === p.id ? '…' : 'Save'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 12 }}>“Max % off” is the deepest discount the bot may give; “Min price” is an absolute floor (wins over %). Product name pe click kar ke photos, description aur attributes add karein. CSV import Shopify ka product export bhi samajhta hai.</p>
    </AppShell>
  );
}
