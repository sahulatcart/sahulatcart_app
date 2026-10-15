'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, FileUp, Loader2, Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import AppShell, { EmptyState, PageHead } from '../../components/AppShell';
import { api, apiError, apiJson } from '../../lib/api';
import { useToast } from '../../components/Toast';
import Dialog, { ConfirmDialog } from '../../components/Dialog';

interface P { id: string; name: string; price: number; stock: number | null; is_active: boolean; negotiable: boolean; max_discount_pct: number | null; min_price: number | null; thumbnailUrl?: string | null }

const paisa = (rupees: string) => Math.round(Number(rupees) * 100); // exact: Rs 99.99 → 9999

export default function Catalog() {
  const toast = useToast();
  const router = useRouter();
  const [products, setProducts] = useState<P[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState({ name: '', price: '', stock: '' });
  const [del, setDel] = useState<P | null>(null);
  // The details dialog: open while non-null. Photos and attributes need the product to exist, so they stay on its page.
  const [details, setDetails] = useState<{ description: string; sku: string; negotiable: boolean; maxOff: string; minPrice: string } | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => apiJson<{ products: P[] }>('/api/v1/admin/products').then((r) => setProducts(r.products)).catch(() => setProducts([]));
  useEffect(() => { load(); }, []);

  const edit = (id: string, patch: Partial<P>) => setProducts((ps) => (ps ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)));
  async function save(p: P) {
    setSaving(p.id);
    const r = await api(`/api/v1/admin/products/${p.id}`, { method: 'PATCH', body: JSON.stringify({ price: p.price, stock: p.stock, is_active: p.is_active, negotiable: p.negotiable, max_discount_pct: p.max_discount_pct, min_price: p.min_price }) });
    setSaving(null);
    if (r.ok) toast('Saved', 'success'); else toast(await apiError(r), 'error');
  }
  // P5: a deleted product is hidden, never removed (orders reference it).
  async function remove(p: P) {
    setDel(null);
    const r = await api(`/api/v1/admin/products/${p.id}`, { method: 'DELETE' });
    if (r.ok) { toast('Product deleted', 'info'); load(); } else toast(await apiError(r), 'error');
  }
  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!adding.name || !adding.price) return;
    setDetails({ description: '', sku: '', negotiable: true, maxOff: '', minPrice: '' });
  }
  async function create() {
    if (!details) return;
    setCreating(true);
    const r = await api('/api/v1/admin/products', { method: 'POST', body: JSON.stringify({
      name: adding.name, price: paisa(adding.price), stock: adding.stock ? Number(adding.stock) : null, track_stock: !!adding.stock, is_active: true,
      description: details.description.trim() || null, sku: details.sku.trim() || null, negotiable: details.negotiable,
      max_discount_pct: details.negotiable && details.maxOff !== '' ? Number(details.maxOff) : null,
      min_price: details.negotiable && details.minPrice !== '' ? paisa(details.minPrice) : null,
    }) });
    setCreating(false);
    if (!r.ok) return toast(await apiError(r), 'error');
    const { id } = (await r.json()) as { id?: string };
    setDetails(null); setAdding({ name: '', price: '', stock: '' }); load();
    toast('Product added', 'success', id ? { label: 'Add photos', onClick: () => router.push(`/catalog/${id}`) } : undefined);
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
          <label className="btn ghost sm m0"><FileUp aria-hidden /> Import CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
          <a className="btn ghost sm" href={template} download="catalog-template.csv"><Download aria-hidden /> CSV template</a>
          <button className="btn ghost sm" onClick={metaSync}><RefreshCw aria-hidden /> Sync from Meta</button>
        </>
      } />

      <form className="card pad mb-2" onSubmit={add} >
        <h2 className="mb-2">Add a product</h2>
        <div className="form-row">
          <div className="field grow"><label htmlFor="new-name">Name</label><input id="new-name" placeholder="e.g. Lawn suit" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} /></div>
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
                      <Link href={`/catalog/${p.id}`} className="link row-top">
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
                    <td className="nowrap"><button className="btn ghost sm" onClick={() => save(p)} disabled={saving === p.id}>{saving === p.id ? <Loader2 className="spin" aria-label="Saving" /> : 'Save'}</button> <button className="btn subtle icon-btn sm" onClick={() => setDel(p)} aria-label={`Delete ${p.name}`}><Trash2 /></button></td>
                  </tr>
                ))}
                {!products && [0, 1, 2].map((i) => <tr key={i}><td colSpan={8}><div className="skeleton" style={{ height: 22 }} /></td></tr>)}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-foot hint block">
          <strong className="ink-2">Max % off</strong> is the deepest discount the bot may give; <strong className="ink-2">Min price</strong> is an absolute floor and wins over %. Open a product to add photos, description and attributes. CSV import also understands Shopify product exports.
        </div>
      </div>
      <Dialog open={!!details} onClose={() => setDetails(null)} title={`Add ${adding.name || 'product'}`} busy={creating}
        actions={<button type="button" className="btn" onClick={create} disabled={creating}>{creating ? <Loader2 className="spin" aria-hidden /> : <Plus aria-hidden />} Add product</button>}>
        {details && (
          <div className="grid-1">
            <p className="hint m0">Rs {adding.price}{adding.stock ? ` · ${adding.stock} in stock` : ''}. The bot answers questions from the description; photos and attributes can be added on the product page after.</p>
            <div className="field m0"><label htmlFor="new-desc">Description</label><textarea id="new-desc" rows={4} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })} placeholder="Material, style, who it's for…" autoFocus /></div>
            <div className="field m0"><label htmlFor="new-sku">SKU (optional)</label><input id="new-sku" className="mono" value={details.sku} onChange={(e) => setDetails({ ...details, sku: e.target.value })} /></div>
            <div className="setting-row">
              <div><div className="t">Negotiable</div><div className="d">Let the bot haggle within the limits below</div></div>
              <label className="switch"><input type="checkbox" aria-label="Negotiable" checked={details.negotiable} onChange={(e) => setDetails({ ...details, negotiable: e.target.checked })} /><span className="track" /></label>
            </div>
            {details.negotiable && (
              <div className="grid-2">
                <div className="field m0"><label htmlFor="new-maxoff">Max % off</label><input id="new-maxoff" className="num" type="number" min="0" max="100" placeholder="Shop default" value={details.maxOff} onChange={(e) => setDetails({ ...details, maxOff: e.target.value })} /></div>
                <div className="field m0"><label htmlFor="new-minprice">Min price (Rs)</label><input id="new-minprice" className="num" type="number" min="0" step="any" placeholder="None" value={details.minPrice} onChange={(e) => setDetails({ ...details, minPrice: e.target.value })} /></div>
              </div>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} onConfirm={() => del && remove(del)} title={`Delete "${del?.name}"?`} confirmLabel="Delete product" danger>
        <p className="m0">Past orders keep it; the bot and the catalog stop showing it.</p>
      </ConfirmDialog>
    </AppShell>
  );
}
