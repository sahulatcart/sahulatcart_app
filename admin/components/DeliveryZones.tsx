'use client';
import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api, apiError, rs } from '../lib/api';
import { useToast } from './Toast';

export interface Zone { id: string; area_name: string; city: string | null; charge: number; is_serviceable: boolean; eta_text: string | null }
export interface DeliverySettings {
  settings: { defaultDeliveryCharge?: number; freeDeliveryThreshold?: number; deliveryConfigured?: boolean };
  deliveryZones: Zone[];
}
const rupees = (v: string): number => Math.round(Number(v || 0) * 100);

/**
 * Delivery areas and charges (P2 step 4, and Settings per FR-P2.7): the zones table, the default
 * charge for unlisted areas, and the free-delivery threshold. Every action saves on its own.
 */
export default function DeliveryZones({ s, onChange }: { s: DeliverySettings; onChange: () => Promise<void> }) {
  const toast = useToast();
  const [zone, setZone] = useState({ area_name: '', city: '', charge: '', eta_text: '' });
  const [defaults, setDefaults] = useState({
    charge: String((s.settings.defaultDeliveryCharge ?? 0) / 100),
    free: String((s.settings.freeDeliveryThreshold ?? 0) / 100),
    everywhere: s.settings.deliveryConfigured === true,
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, req: Promise<Response>, ok: string): Promise<boolean> {
    setBusy(key);
    try {
      const r = await req;
      if (!r.ok) { toast(await apiError(r), 'error'); return false; }
      toast(ok, 'success');
      await onChange();
      return true;
    } finally { setBusy(null); }
  }

  async function addZone(e: React.FormEvent) {
    e.preventDefault();
    if (zone.area_name.trim().length < 2) return toast('Enter the area name', 'error');
    if (zone.charge.trim() === '' || !Number.isFinite(Number(zone.charge)) || Number(zone.charge) < 0) return toast('Enter the delivery charge (0 for free)', 'error'); // review P2-15: a blank is not Rs 0
    const ok = await run('add', api('/api/v1/admin/delivery-zones', { method: 'POST', body: JSON.stringify({ area_name: zone.area_name, city: zone.city, charge: rupees(zone.charge), eta_text: zone.eta_text }) }), 'Area added');
    if (ok) setZone({ area_name: '', city: '', charge: '', eta_text: '' }); // keep the form after a 409 so the typing is not lost
  }
  const toggle = (z: Zone) => run(z.id, api(`/api/v1/admin/delivery-zones/${z.id}`, { method: 'PATCH', body: JSON.stringify({ is_serviceable: !z.is_serviceable }) }), z.is_serviceable ? `${z.area_name}: not serviceable` : `${z.area_name}: serviceable`);
  const remove = (z: Zone) => run(z.id, api(`/api/v1/admin/delivery-zones/${z.id}`, { method: 'DELETE' }), 'Area removed');
  const saveDefaults = (e: React.FormEvent) => {
    e.preventDefault();
    return run('defaults', api('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify({ settings: { defaultDeliveryCharge: rupees(defaults.charge), freeDeliveryThreshold: rupees(defaults.free), deliveryConfigured: defaults.everywhere } }) }), 'Delivery charges saved');
  };

  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Area</th><th>City</th><th className="num">Charge</th><th>ETA</th><th>Serviceable</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {s.deliveryZones.length === 0 && <tr><td colSpan={6} className="hint">No areas yet. Add the areas you deliver to, or tick “one charge for everywhere” below.</td></tr>}
            {s.deliveryZones.map((z) => (
              <tr key={z.id}>
                <td>{z.area_name}</td>
                <td>{z.city ?? '—'}</td>
                <td className="num">{rs(z.charge)}</td>
                <td>{z.eta_text ?? '—'}</td>
                <td><label className="switch"><input type="checkbox" aria-label={`${z.area_name} serviceable`} checked={z.is_serviceable} disabled={busy === z.id} onChange={() => toggle(z)} /><span className="track" /></label></td>
                <td><button type="button" className="btn subtle icon-btn sm" aria-label={`Remove ${z.area_name}`} disabled={busy === z.id} onClick={() => remove(z)}><Trash2 aria-hidden /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addZone} className="form-row" style={{ marginBottom: 22 }}>
        <div className="field"><label htmlFor="z-area">Area</label><input id="z-area" value={zone.area_name} onChange={(e) => setZone({ ...zone, area_name: e.target.value })} placeholder="Model Town" required /></div>
        <div className="field"><label htmlFor="z-city">City</label><input id="z-city" value={zone.city} onChange={(e) => setZone({ ...zone, city: e.target.value })} placeholder="Lahore" /></div>
        <div className="field"><label htmlFor="z-charge">Charge (Rs)</label><input id="z-charge" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={zone.charge} onChange={(e) => setZone({ ...zone, charge: e.target.value })} /></div>
        <div className="field"><label htmlFor="z-eta">ETA</label><input id="z-eta" value={zone.eta_text} onChange={(e) => setZone({ ...zone, eta_text: e.target.value })} placeholder="1–2 din" /></div>
        <div className="field"><button className="btn" disabled={busy === 'add'}><Plus aria-hidden /> Add area</button></div>
      </form>

      <form onSubmit={saveDefaults}>
        <h3>Everywhere else</h3>
        <div className="form-row">
          <div className="field"><label htmlFor="d-charge">Default charge (Rs)</label><input id="d-charge" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={defaults.charge} onChange={(e) => setDefaults({ ...defaults, charge: e.target.value })} /></div>
          <div className="field"><label htmlFor="d-free">Free delivery above (Rs)</label><input id="d-free" type="number" min="0" step="1" inputMode="numeric" className="mini num" value={defaults.free} onChange={(e) => setDefaults({ ...defaults, free: e.target.value })} /></div>
        </div>
        <div className="field">
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 400 }}>
            <input type="checkbox" checked={defaults.everywhere} onChange={(e) => setDefaults({ ...defaults, everywhere: e.target.checked })} style={{ marginTop: 3 }} />
            <span>I deliver everywhere at the default charge — no areas list needed.</span>
          </label>
          <div className="help">Buyers outside your listed areas get the default charge; set to 0 for free delivery.</div>
        </div>
        <button className="btn" disabled={busy === 'defaults'}>{busy === 'defaults' ? <Loader2 className="spin" aria-hidden /> : null} Save charges</button>
      </form>
    </>
  );
}
