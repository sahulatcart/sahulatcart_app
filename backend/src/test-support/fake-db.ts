// In-memory stand-in for the Supabase client — just the query-builder calls the order flow makes,
// so tests can run whole conversations without a database. Test-only; nothing at runtime imports it.
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Result = { data: unknown; error: { code: string; message: string } | null; count?: number };

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
/** Column value, including PostgREST JSON paths like `context->>pendingOrderId` (compared as text). */
const get = (r: Row, col: string): unknown => {
  if (!col.includes('->>')) return r[col] ?? null;
  const [c, key] = col.split('->>') as [string, string];
  const v = r[c]?.[key];
  return v == null ? null : String(v);
};

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: Row | Row[] = {};
  private filters: ((r: Row) => boolean)[] = [];
  private cols = '*';
  private want: 'many' | 'single' | 'maybe' = 'many';
  private head = false;
  private sort?: [string, boolean];
  private max?: number;
  private conflict?: string[];

  constructor(private db: FakeDb, private table: string) {}

  select(cols = '*', opts?: { count?: string; head?: boolean }) { this.cols = cols; this.head = !!opts?.head; return this; }
  insert(v: Row | Row[]) { this.op = 'insert'; this.payload = v; return this; }
  update(v: Row) { this.op = 'update'; this.payload = v; return this; }
  upsert(v: Row, o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = v; this.conflict = o?.onConflict?.split(','); return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: unknown) { return this.where((r) => get(r, c) === v); }
  neq(c: string, v: unknown) { return this.where((r) => get(r, c) !== v); }
  in(c: string, vs: unknown[]) { return this.where((r) => vs.includes(get(r, c))); }
  is(c: string, v: null) { return this.where((r) => get(r, c) === v); }
  not(c: string, _op: 'is', v: null) { return this.where((r) => get(r, c) !== v); }
  gt(c: string, v: string | number) { return this.where((r) => (get(r, c) as string | number) > v); }
  lt(c: string, v: string | number) { return this.where((r) => (get(r, c) as string | number) < v); }
  match(o: Row) { Object.entries(o).forEach(([k, v]) => this.eq(k, v)); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.sort = [c, o?.ascending !== false]; return this; }
  limit(n: number) { this.max = n; return this; }
  single() { this.want = 'single'; return this; }
  maybeSingle() { this.want = 'maybe'; return this; }

  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }

  private where(f: (r: Row) => boolean) { this.filters.push(f); return this; }
  private matching(): Row[] { return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r))); }

  private run(): Result {
    let rows: Row[];
    const table = this.db.rows(this.table);
    if (this.op === 'insert') rows = [this.payload].flat().map((r) => this.db.add(this.table, r));
    else if (this.op === 'update') rows = this.matching().map((r) => Object.assign(r, clone(this.payload)));
    else if (this.op === 'delete') rows = this.matching().map((r) => table.splice(table.indexOf(r), 1)[0]!);
    else if (this.op === 'upsert') {
      const p = this.payload as Row;
      const hit = table.find((r) => this.conflict!.every((k) => r[k] === p[k]));
      rows = [hit ? Object.assign(hit, clone(p)) : this.db.add(this.table, p)];
    } else rows = this.matching();

    if (this.sort) {
      const [c, asc] = this.sort;
      rows = [...rows].sort((a, b) => ((a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)));
    }
    rows = rows.slice(0, this.max).map((r) => this.embed(clone(r)));
    const count = rows.length;
    if (this.head) return { data: null, error: null, count };
    if (this.want === 'many') return { data: rows, error: null, count };
    if (rows.length > 1 || (this.want === 'single' && !rows.length)) return { data: null, error: { code: 'PGRST116', message: `${rows.length} rows` } };
    return { data: rows[0] ?? null, error: null };
  }

  /** `products(name)` on a row with product_id → the related row (many-to-one embeds only). */
  private embed(r: Row): Row {
    for (const [, rel] of this.cols.matchAll(/(\w+)\(/g)) {
      const fk = `${rel!.replace(/s$/, '')}_id`;
      r[rel!] = clone(this.db.rows(rel!).find((x) => x.id === r[fk]) ?? null);
    }
    return r;
  }
}

export class FakeDb {
  private tables: Record<string, Row[]> = {};
  private clock = Date.parse('2026-09-01T00:00:00Z');
  private counters: Record<string, number> = {};

  /** Test doubles of the SQL functions in db/migrations 0006 and 0008 (those are tested in Postgres). */
  rpcs: Record<string, (args: Row) => unknown> = {
    next_order_number: ({ p_merchant }) => `SK-${(this.counters[p_merchant] = (this.counters[p_merchant] ?? 1000) + 1)}`,
    reserve_stock: ({ p_order }) => {
      const order = this.rows('orders').find((o) => o.id === p_order)!;
      if (order.stock_reserved) return true;
      const lines = this.rows('order_items').filter((i) => i.order_id === p_order);
      const tracked = (i: Row) => this.rows('products').find((p) => p.id === i.product_id && p.track_stock && p.stock != null);
      if (lines.some((i) => (tracked(i)?.stock ?? Infinity) < i.quantity)) return false;
      lines.forEach((i) => { const p = tracked(i); if (p) p.stock -= i.quantity; });
      return (order.stock_reserved = true);
    },
    release_stock: ({ p_order }) => {
      const order = this.rows('orders').find((o) => o.id === p_order)!;
      if (!order.stock_reserved) return null;
      order.stock_reserved = false;
      for (const i of this.rows('order_items').filter((x) => x.order_id === p_order)) {
        const p = this.rows('products').find((x) => x.id === i.product_id && x.track_stock && x.stock != null);
        if (p) p.stock += i.quantity;
      }
      return null;
    },
  };

  storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` } }),
    }),
  };

  rows(table: string): Row[] { return (this.tables[table] ??= []); }
  add(table: string, r: Row): Row {
    const row = { id: crypto.randomUUID(), created_at: new Date((this.clock += 1000)).toISOString(), ...clone(r) };
    this.rows(table).push(row);
    return row;
  }
  from(table: string) { return new Query(this, table); }
  async rpc(name: string, args: Row): Promise<Result> {
    const fn = this.rpcs[name];
    return fn ? { data: fn(args), error: null } : { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } };
  }
  /** Typed as the real client for the code under test. */
  get client(): SupabaseClient { return this as unknown as SupabaseClient; }
}
