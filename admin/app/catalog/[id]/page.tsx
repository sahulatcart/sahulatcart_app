'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ImagePlus, Loader2, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import AppShell, { BackLink, PageHead } from '../../../components/AppShell';
import { api, apiError, apiJson } from '../../../lib/api';
import { useToast } from '../../../components/Toast';

interface Product {
  id: string; name: string; sku: string | null; description: string | null;
  price: number; stock: number | null; track_stock: boolean; is_active: boolean;
  negotiable: boolean; max_discount_pct: number | null; min_price: number | null;
  attributes: Record<string, string[] | string> | null;
}
interface Detail { product: Product; imageUrls: { ref: string; url: string | null }[] }

/** attributes jsonb ⇄ editable rows of {key, comma-separated values} */
const toRows = (a: Product['attributes']): { k: string; v: string }[] =>
  Object.entries(a ?? {}).map(([k, v]) => ({ k, v: Array.isArray(v) ? v.join(', ') : String(v) }));
const fromRows = (rows: { k: string; v: string }[]): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const { k, v } of rows) {
    const key = k.trim();
    const vals = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (key && vals.length) out[key] = vals;
  }
  return out;
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [attrs, setAttrs] = useState<{ k: string; v: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<Detail>(`/api/v1/admin/products/${id}`);
      if (!r.product) throw new Error('not found');
      setD(r);
      setAttrs(toRows(r.product.attributes));
    } catch { toast('Could not load product', 'error'); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const edit = (patch: Partial<Product>) => setD((cur) => (cur ? { ...cur, product: { ...cur.product, ...patch } } : cur));

  async function save() {
    if (!d) return;
    setBusy('save');
    try {
      const p = d.product;
      const r = await api(`/api/v1/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify({
        name: p.name, description: p.description, price: p.price, stock: p.stock,
        track_stock: p.stock != null, is_active: p.is_active, negotiable: p.negotiable,
        max_discount_pct: p.max_discount_pct, min_price: p.min_price, sku: p.sku,
        attributes: fromRows(attrs),
      }) });
      if (r.ok) toast('Saved', 'success'); else toast(await apiError(r), 'error');
    } finally { setBusy(null); }
  }

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) return toast('Sirf image files', 'error');
    setBusy('upload');
    try {
      const dataBase64 = btoa(new Uint8Array(await file.arrayBuffer()).reduce((s, b) => s + String.fromCharCode(b), ''));
      const r = await api(`/api/v1/admin/products/${id}/images`, { method: 'POST', body: JSON.stringify({ dataBase64, contentType: file.type }) });
      if (r.ok) { toast('Photo uploaded', 'success'); load(); } else toast(await apiError(r), 'error');
    } finally { setBusy(null); }
  }

  async function removeImage(ref: string) {
    setBusy(ref);
    try {
      const r = await api(`/api/v1/admin/products/${id}/images`, { method: 'DELETE', body: JSON.stringify({ ref }) });
      if (r.ok) load(); else toast(await apiError(r), 'error');
    } finally { setBusy(null); }
  }

  async function aiDescribe() {
    setBusy('ai');
    try {
      const r = await api(`/api/v1/admin/products/${id}/describe`, { method: 'POST' });
      const j = (await r.json()) as { description?: string; error?: { message?: string } };
      if (r.ok && j.description) { edit({ description: j.description }); toast('AI ne likh diya — review kar ke Save karein', 'success'); }
      else toast(j.error?.message ?? 'AI unavailable', 'error');
    } finally { setBusy(null); }
  }

  if (!d) return <AppShell><div className="skeleton" style={{ height: 40, width: 280, marginBottom: 20 }} /><div className="split"><div className="skeleton" style={{ height: 320 }} /><div className="skeleton" style={{ height: 320 }} /></div></AppShell>;
  const p = d.product;
  const setAttr = (i: number, patch: Partial<{ k: string; v: string }>) => setAttrs(attrs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <AppShell>
      <BackLink href="/catalog" label="Catalog" />
      <PageHead title={p.name || 'Product'} sub="What you write here is all the bot will say about this product — it never invents details."
        action={<button className="btn" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />} Save changes</button>} />

      <div className="split">
        <div>
          <div className="card pad">
            <h2>Photos</h2>
            <p className="hint" style={{ marginBottom: 14 }}>The first photo is sent with the price quote, and whenever a customer asks to see the product.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {d.imageUrls.map(({ ref, url }, i) => (
                <div key={ref} style={{ position: 'relative', width: 112, height: 112, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt={i === 0 ? `${p.name} — main photo` : `${p.name} — photo ${i + 1}`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {i === 0 && <span className="pill brand" style={{ position: 'absolute', left: 6, bottom: 6 }}>Main</span>}
                  <button className="btn ghost icon-btn sm" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => removeImage(ref)} disabled={busy === ref} aria-label={`Delete photo ${i + 1}`}>
                    {busy === ref ? <Loader2 className="spin" /> : <Trash2 />}
                  </button>
                </div>
              ))}
              {/* sr-only input keeps the upload reachable from the keyboard */}
              <label className="btn ghost" style={{ width: 112, height: 112, borderRadius: 'var(--r)', flexDirection: 'column', gap: 6, borderStyle: 'dashed', margin: 0, fontWeight: 500 }}>
                {busy === 'upload' ? <Loader2 className="spin" aria-hidden /> : <ImagePlus aria-hidden />}
                <span style={{ fontSize: 12.5 }}>Add photo</span>
                <input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          <div className="card pad">
            <div className="row between" style={{ marginBottom: 12 }}>
              <label htmlFor="desc" style={{ margin: 0 }}><h2 style={{ margin: 0 }}>Description</h2></label>
              <button className="btn ghost sm" onClick={aiDescribe} disabled={busy === 'ai' || d.imageUrls.length === 0} title={d.imageUrls.length ? 'Write a description from the main photo' : 'Upload a photo first'}>
                {busy === 'ai' ? <Loader2 className="spin" aria-hidden /> : <Sparkles aria-hidden />} Write with AI
              </button>
            </div>
            <textarea id="desc" rows={5} value={p.description ?? ''} onChange={(e) => edit({ description: e.target.value })} placeholder="Material, style, who it's for… The bot uses this to answer questions." />
            {d.imageUrls.length === 0 && <p className="hint" style={{ marginTop: 8 }}>Add a photo to let AI draft this for you.</p>}
          </div>

          <div className="card pad">
            <h2>Attributes</h2>
            <p className="hint" style={{ marginBottom: 14 }}>Answers questions like &ldquo;size kya hai?&rdquo;. Separate several values with commas.</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {attrs.map((row, i) => (
                <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
                  <input aria-label={`Attribute ${i + 1} name`} placeholder="Size / Color / Material" value={row.k} onChange={(e) => setAttr(i, { k: e.target.value })} style={{ maxWidth: 180 }} />
                  <input aria-label={`Attribute ${i + 1} values`} placeholder="S, M, L, XL" value={row.v} onChange={(e) => setAttr(i, { v: e.target.value })} />
                  <button className="btn subtle icon-btn" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))} aria-label={`Remove attribute ${row.k || i + 1}`}><Trash2 /></button>
                </div>
              ))}
              <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAttrs([...attrs, { k: '', v: '' }])}><Plus aria-hidden /> Add attribute</button>
            </div>
          </div>
        </div>

        <div className="card pad">
          <h2 style={{ marginBottom: 14 }}>Basics</h2>
          <div className="field"><label htmlFor="name">Name</label><input id="name" value={p.name} onChange={(e) => edit({ name: e.target.value })} /></div>
          <div className="field"><label htmlFor="sku">SKU</label><input id="sku" className="mono" value={p.sku ?? ''} onChange={(e) => edit({ sku: e.target.value || null })} /></div>
          <div className="grid-2" style={{ marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor="price">Price (Rs)</label><input id="price" className="num" type="number" min="0" step="any" value={p.price / 100} onChange={(e) => edit({ price: Math.round(Number(e.target.value) * 100) })} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="stock">Stock</label><input id="stock" className="num" type="number" min="0" placeholder="Not tracked" value={p.stock ?? ''} onChange={(e) => edit({ stock: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          </div>
          <div className="divider" />
          <div className="setting-row" style={{ marginBottom: 14 }}>
            <div><div className="t" style={{ fontSize: 14 }}>Negotiable</div><div className="d">Let the bot haggle within the limits below</div></div>
            <label className="switch"><input type="checkbox" aria-label="Negotiable" checked={p.negotiable} onChange={(e) => edit({ negotiable: e.target.checked })} /><span className="track" /></label>
          </div>
          <div className="grid-2">
            <div className="field" style={{ margin: 0 }}><label htmlFor="maxoff">Max % off</label><input id="maxoff" className="num" type="number" min="0" max="100" value={p.max_discount_pct ?? ''} onChange={(e) => edit({ max_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} disabled={!p.negotiable} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="minprice">Min price (Rs)</label><input id="minprice" className="num" type="number" min="0" step="any" value={p.min_price != null ? p.min_price / 100 : ''} onChange={(e) => edit({ min_price: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} disabled={!p.negotiable} /></div>
          </div>
          <div className="divider" />
          <div className="setting-row">
            <div><div className="t" style={{ fontSize: 14 }}>Active</div><div className="d">The bot can offer and sell this product</div></div>
            <label className="switch"><input type="checkbox" aria-label="Active" checked={p.is_active} onChange={(e) => edit({ is_active: e.target.checked })} /><span className="track" /></label>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
