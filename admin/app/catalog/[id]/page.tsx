'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ImagePlus, Loader2, Sparkles, Trash2 } from 'lucide-react';
import AppShell, { PageHead } from '../../../components/AppShell';
import { api, apiJson } from '../../../lib/api';
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
      if (r.ok) toast('Saved', 'success'); else toast('Save failed', 'error');
    } finally { setBusy(null); }
  }

  async function upload(file: File) {
    if (!file.type.startsWith('image/')) return toast('Sirf image files', 'error');
    setBusy('upload');
    try {
      const dataBase64 = btoa(new Uint8Array(await file.arrayBuffer()).reduce((s, b) => s + String.fromCharCode(b), ''));
      const r = await api(`/api/v1/admin/products/${id}/images`, { method: 'POST', body: JSON.stringify({ dataBase64, contentType: file.type }) });
      if (r.ok) { toast('Photo uploaded', 'success'); load(); } else toast('Upload failed', 'error');
    } finally { setBusy(null); }
  }

  async function removeImage(ref: string) {
    setBusy(ref);
    try {
      const r = await api(`/api/v1/admin/products/${id}/images`, { method: 'DELETE', body: JSON.stringify({ ref }) });
      if (r.ok) load(); else toast('Delete failed', 'error');
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

  if (!d) return <AppShell><div className="card pad"><div className="skeleton" style={{ height: 200 }} /></div></AppShell>;
  const p = d.product;

  return (
    <AppShell>
      <Link href="/catalog" className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 10 }}><ArrowLeft size={15} /> Catalog</Link>
      <PageHead title={p.name} sub="Ye details bot customers ko batayega — jo yahan nahi, wo bot kabhi invent nahi karega"
        action={<button className="btn" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? <Loader2 className="spin" /> : 'Save'}</button>} />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card pad">
            <h2>Photos</h2>
            <p className="hint" style={{ marginBottom: 12 }}>Pehli photo customer ko quote ke sath jati hai. "Photo dikhao" pe bhi yehi bhejta hai.</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {d.imageUrls.map(({ ref, url }) => (
                <div key={ref} style={{ position: 'relative', width: 110, height: 110, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <button className="btn danger sm" style={{ position: 'absolute', top: 4, right: 4, padding: '4px 6px' }} onClick={() => removeImage(ref)} disabled={busy === ref}><Trash2 size={13} /></button>
                </div>
              ))}
              <label className="btn ghost" style={{ width: 110, height: 110, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer', border: '1.5px dashed var(--border)' }}>
                {busy === 'upload' ? <Loader2 className="spin" /> : <ImagePlus />}
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
              </label>
            </div>
          </div>

          <div className="card pad">
            <div className="row between" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>Description</h2>
              <button className="btn ghost sm" onClick={aiDescribe} disabled={busy === 'ai' || d.imageUrls.length === 0} title={d.imageUrls.length ? 'Photo se AI description' : 'Pehle photo upload karein'}>
                {busy === 'ai' ? <Loader2 className="spin" /> : <Sparkles size={15} />} AI se likhwao
              </button>
            </div>
            <textarea rows={5} value={p.description ?? ''} onChange={(e) => edit({ description: e.target.value })} placeholder="Material, style, kis ke liye hai... Bot yehi bata kar bechay ga." style={{ width: '100%' }} />
          </div>

          <div className="card pad">
            <h2>Attributes</h2>
            <p className="hint" style={{ marginBottom: 12 }}>"Size kya hai?" jaise sawalon ke jawab yahan se aate hain. Values comma se alag karein.</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {attrs.map((row, i) => (
                <div className="row" key={i}>
                  <input placeholder="Size / Color / Material" value={row.k} onChange={(e) => setAttrs(attrs.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))} style={{ maxWidth: 180 }} />
                  <input placeholder="S, M, L, XL" value={row.v} onChange={(e) => setAttrs(attrs.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))} />
                  <button className="btn ghost sm" onClick={() => setAttrs(attrs.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => setAttrs([...attrs, { k: '', v: '' }])}>+ Add attribute</button>
            </div>
          </div>
        </div>

        <div className="card pad">
          <h2>Basics</h2>
          <div className="field"><label>Name</label><input value={p.name} onChange={(e) => edit({ name: e.target.value })} /></div>
          <div className="field"><label>SKU</label><input value={p.sku ?? ''} onChange={(e) => edit({ sku: e.target.value || null })} /></div>
          <div className="row">
            <div className="field"><label>Price (Rs)</label><input type="number" value={Math.round(p.price / 100)} onChange={(e) => edit({ price: Math.round(Number(e.target.value) * 100) })} /></div>
            <div className="field"><label>Stock</label><input type="number" value={p.stock ?? ''} onChange={(e) => edit({ stock: e.target.value === '' ? null : Number(e.target.value) })} /></div>
          </div>
          <div className="row between" style={{ margin: '10px 0' }}>
            <span>Negotiable (bhao-taao)</span>
            <label className="switch"><input type="checkbox" checked={p.negotiable} onChange={(e) => edit({ negotiable: e.target.checked })} /><span className="track" /></label>
          </div>
          <div className="row">
            <div className="field"><label>Max % off</label><input type="number" value={p.max_discount_pct ?? ''} onChange={(e) => edit({ max_discount_pct: e.target.value === '' ? null : Number(e.target.value) })} disabled={!p.negotiable} /></div>
            <div className="field"><label>Min price (Rs)</label><input type="number" value={p.min_price != null ? Math.round(p.min_price / 100) : ''} onChange={(e) => edit({ min_price: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} disabled={!p.negotiable} /></div>
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <span>Active (bot bech sakta hai)</span>
            <label className="switch"><input type="checkbox" checked={p.is_active} onChange={(e) => edit({ is_active: e.target.checked })} /><span className="track" /></label>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
