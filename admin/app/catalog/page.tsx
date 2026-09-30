'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, FileUp, Loader2, Package, Plus, RefreshCw } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../components/AppShell';
import { api, apiError, apiJson } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface P { id: string; name: string; price: number; stock: number | null; is_active: boolean; negotiable: boolean; max_discount_pct: number | null; min_price: number | null; thumbnailUrl?: string | null }

const paisa = (rupees: string) => Math.round(Number(rupees) * 100); // exact: Rs 99.99 → 9999

export default function Catalog() {
  const toast = useToast();
  const [products, setProducts] = useState<P[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', price: '', stock: '' });

  const load = () => apiJson<{ products: P[] }>('/api/v1/admin/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  useEffect(() => { load(); }, []);

  const edit = (id: string, patch: Partial<P>) => setProducts((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  async function save(p: P) {
    setSaving(p.id);
    const r = await api(`/api/v1/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ price: p.price, stock: p.stock, is_active: p.is_active, negotiable: p.negotiable, max_discount_pct: p.max_discount_pct, min_price: p.min_price }) });
    setSaving(null);
    if (r.ok) toast('Saved', 'success'); else toast(await apiError(r), 'error');
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name || !adding.price) return;
    const r = await api('/api/v1/admin/products', { method: 'POST', body: JSON.stringify({ name: adding.name, price: paisa(adding.price), stock: adding.stock ? Number(adding.stock) : null, track_stock: !!adding.stock, negotiable: true, is_active: true }) });
    if (!r.ok) return toast(await apiError(r), 'error');
    setAdding({ name: '', price: '', stock: '' }); toast('Product added', 'success'); load();
  }
  async function importCsv(file: File) {
    const res = await api('/api/v1/admin/products/import', { method: 'POST', body: JSON.stringify({ csv: await file.text() }) });
    if (!res.ok) return toast(await apiError(res), 'error');
    const r = (await res.json()) as { imported: number; errors: string[]; total: number };
    toast(`Imported ${r.imported}/${r.total}${r.errors.length ? ` · ${r.errors.length} errors` : ''}`, r.errors.length ? 'error' : 'success');
    load();
  }
  async function metaSync() {
    const res = await api('/api/v1/admin/products/catalog-sync', { method: 'POST' });
    if (!res.ok) return toast(await apiError(res), 'error');
    const r = (await res.json()) as { synced: number; skipped?: number; message?: string };
    const skipped = r.skipped ? ` · ${r.skipped} skipped (no readable price)` : '';
    toast(r.message ?? `Synced ${r.synced} products from Meta${skipped}`, r.message ? 'info' : 'success');
    load();
  }
  const template = 'data:text/csv;charset=utf-8,' + encodeURIComponent('name,price,stock,negotiable,max_discount_pct,min_price,sku,description\nT-Shirt,2500,50,yes,20,,TSHIRT,Cotton tee\nMug,800,100,no,,,MUG,');

  return (
    <AppShell>
      <PageHead title="Catalog" sub="Products the bot can sell and negotiate" action={
        <>
          {/* The input stays in the tab order (sr-only, not display:none) so the button works from the keyboard. */}
          <label className="btn ghost sm" style={{ margin: 0 }}><FileUp aria-hidden /> Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
          <a className="btn ghost sm" href={template} download="catalog-template.csv"><Download aria-hidden /> CSV template</a>
          <button className="btn ghost sm" onClick={metaSync}><RefreshCw aria-hidden /> Sync from Meta</button>
        </>
      } />

      <form className="card pad" onSubmit={add} style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 12 }}>Add a product</h2>
        <div className="form-row">
          <div className="field" style={{ flex: '1 1 220px' }}><label htmlFor="new-name">Name</label><input id="new-name" placeholder="e.g. Lawn suit" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="new-price">Price (Rs)</label><input id="new-price" type="number" min="0" step="any" value={adding.price} onChange={(e) => setAdding({ ...adding, price: e.target.value })} className="mini" /></div>
          <div className="field"><label htmlFor="new-stock">Stock</label><input id="new-stock" type="number" min="0" placeholder="∞" value={adding.stock} onChange={(e) => setAdding({ ...adding, stock: e.target.value })} className="mini" /></div>
          <button className="btn" disabled={!adding.name || !adding.price}><Plus aria-hidden /> Add product</button>
        </div>
      </form>

      <div className="card">
        {products && products.length === 0 ? (
          <EmptyState icon={Package} title="No products yet" hint="Add one above, import a CSV (Shopify exports work too), or sync from your Meta catalog." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Price (Rs)</th><th>Stock</th><th>Negotiable</th><th>Max % off</th><th>Min price (Rs)</th><th>Active</th><th><span className="sr-only">Save</span></th></tr></thead>
              <tbody>
                {(products ?? []).map((p) => (
                  <tr key={p.id}>
                    <td style={{ minWidth: 200 }}>
                      <Link href={`/catalog/${p.id}`} className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        {p.thumbnailUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={p.thumbnailUrl} alt="" className="thumb" loading="lazy" />
                          : <span className="thumb" aria-hidden><Package /></span>}
                        {p.name}
                      </Link>
                    </td>
                    <td><input aria-label={`${p.name} price in rupees`} type="number" min="0" step="any" value={p.price / 100} onChange={(e) => edit(p.id, { price: paisa(e.target.value) })} className="mini num" /></td>
                    <td><input aria-label={`${p.name} stock`} type="number" min="0" placeholder="∞" value={p.stock ?? ''} onChange={(e) => edit(p.id, { stock: e.target.value === '' ? null : Number(e.target.value) })} className="xs num" /></td>
                    <td><label className="switch"><input type="checkbox" aria-label={`${p.name} negotiable`} checked={p.negotiable} onChange={(e) => edit(p.id, { negotiable: e.target.checked })} /><span className="track" /></label></td>
                    <td><input aria-label={`${p.name} maximum percent off`} type="number" min="0" max="100" value={p.max_discount_pct ?? ''} onChange={(e) => edit(p.id, { max_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} className="xs num" disabled={!p.negotiable} /></td>
                    <td><input aria-label={`${p.name} minimum price in rupees`} type="number" min="0" step="any" value={p.min_price != null ? p.min_price / 100 : ''} onChange={(e) => edit(p.id, { min_price: e.target.value === '' ? null : paisa(e.target.value) })} className="mini num" disabled={!p.negotiable} /></td>
                    <td><label className="switch"><input type="checkbox" aria-label={`${p.name} active`} checked={p.is_active} onChange={(e) => edit(p.id, { is_active: e.target.checked })} /><span className="track" /></label></td>
                    <td><button className="btn ghost sm" onClick={() => save(p)} disabled={saving === p.id}>{saving === p.id ? <Loader2 className="spin" aria-label="Saving" /> : 'Save'}</button></td>
                  </tr>
                ))}
                {!products && [0, 1, 2].map((i) => <tr key={i}><td colSpan={8}><div className="skeleton" style={{ height: 22 }} /></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-foot hint" style={{ display: 'block' }}>
          <strong style={{ color: 'var(--ink-2)' }}>Max % off</strong> is the deepest discount the bot may give; <strong style={{ color: 'var(--ink-2)' }}>Min price</strong> is an absolute floor and wins over %. Open a product to add photos, description and attributes. CSV import also understands Shopify product exports.
        </div>
      </div>
    </AppShell>
  );
}
