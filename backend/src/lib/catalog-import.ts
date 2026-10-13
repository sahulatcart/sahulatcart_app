// Safe catalog re-import (SRS P8, FR-P8.6). A row matches an existing product by SKU, else by name
// (case-insensitive). Existing → update only the file's columns, never is_active (a hidden product
// stays hidden); Shopify images and attributes only when the product has none (portal uploads win).
// New → insert, active. Rows without a SKU therefore import once, not once per upload.
import type { SupabaseClient } from '@supabase/supabase-js';
import { invalidProductField } from './validation';

export interface ExistingProduct { id: string; sku: string | null; name: string; images: string[] | null; attributes: Record<string, unknown> | null }

export async function loadExisting(db: SupabaseClient, merchantId: string): Promise<ExistingProduct[]> {
  const { data } = await db.from('products').select('id, sku, name, images, attributes').eq('merchant_id', merchantId).is('deleted_at', null);
  return (data ?? []) as ExistingProduct[];
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function matchExisting(existing: ExistingProduct[], sku: unknown, name: unknown): ExistingProduct | undefined {
  const s = typeof sku === 'string' ? sku.trim() : '';
  if (s) {
    const bySku = existing.find((p) => p.sku && p.sku.trim() === s);
    if (bySku) return bySku;
  }
  const n = norm(name);
  return n ? existing.find((p) => norm(p.name) === n) : undefined;
}

/** Validate, then update or insert one row. Returns an error message, or null when imported. */
export async function importRow(db: SupabaseClient, merchantId: string, existing: ExistingProduct[], row: Record<string, unknown>, opts: { shopify?: boolean } = {}): Promise<string | null> {
  const bad = invalidProductField(row);
  if (bad) return `${bad} is invalid`;
  const hit = matchExisting(existing, row.sku, row.name);
  if (hit) {
    const patch: Record<string, unknown> = { ...row };
    delete patch.is_active;
    delete patch.merchant_id;
    if (opts.shopify) {
      if (hit.images?.length) delete patch.images;
      if (hit.attributes && Object.keys(hit.attributes).length) delete patch.attributes;
    }
    const { error } = await db.from('products').update(patch).eq('id', hit.id).eq('merchant_id', merchantId);
    return error ? error.message : null;
  }
  const { data, error } = await db.from('products').insert({ ...row, merchant_id: merchantId, is_active: true }).select('id, sku, name, images, attributes').single();
  if (error || !data) return error?.message ?? 'insert failed';
  existing.push(data as ExistingProduct); // a second row for the same product in one file updates, not duplicates
  return null;
}
