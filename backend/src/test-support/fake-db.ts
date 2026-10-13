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
  gte(c: string, v: string | number) { return this.where((r) => (get(r, c) as string | number) >= v); }
  lte(c: string, v: string | number) { return this.where((r) => (get(r, c) as string | number) <= v); }
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
    if (this.op === 'insert') {
      // The one unique constraint the code relies on as logic: webhook_events.event_id is the idempotency check.
      const dup = this.table === 'webhook_events' && [this.payload].flat().some((p) => table.some((r) => r.event_id === p.event_id));
      if (dup) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      rows = [this.payload].flat().map((r) => this.db.add(this.table, r));
    }
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

  /** Test doubles of the SQL functions in db/migrations 0006, 0008 and 0012 (those are tested in Postgres). */
  /** Pakistan-time 'today', for the AI day counter; tests may override. */
  karachiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  rpcs: Record<string, (args: Row) => unknown> = {
    // db/migrations/0011: one row per number per month, atomic increments, AI calls per day.
    bump_message_usage: ({ p_phone, p_month, p_outbound, p_inbound, p_llm }) => {
      const num = this.rows('whatsapp_numbers').find((n) => n.phone_number_id === p_phone);
      if (!num) return [];
      let row = this.rows('message_usage').find((u) => u.phone_number_id === p_phone && u.period_month === p_month && u.merchant_id === num.merchant_id);
      if (!row) row = this.add('message_usage', { merchant_id: num.merchant_id, phone_number_id: p_phone, period_month: p_month, outbound_count: 0, inbound_count: 0, llm_calls: 0, llm_calls_day: this.karachiToday });
      row.outbound_count += p_outbound ?? 0;
      row.inbound_count += p_inbound ?? 0;
      row.llm_calls = (row.llm_calls_day === this.karachiToday ? row.llm_calls : 0) + (p_llm ?? 0);
      row.llm_calls_day = this.karachiToday;
      return [{ merchant_id: row.merchant_id, outbound_count: row.outbound_count, inbound_count: row.inbound_count, llm_calls: row.llm_calls }];
    },
    create_merchant_for_user: ({ p_auth_user, p_email, p_shop, p_owner, p_phone, p_attestations }) => {
      const mine = this.rows('merchant_users').find((u) => u.auth_user_id === p_auth_user && u.is_active);
      if (mine) return [{ merchant_id: mine.merchant_id, role: mine.role }];
      // Migration 0019: the one-shop-ever index and merchants.email unique, as distinct errors.
      if (this.rows('merchant_users').some((u) => u.auth_user_id === p_auth_user)) throw { code: 'SC001', message: 'inactive_membership' };
      if (this.rows('merchants').some((m) => String(m.email ?? '').toLowerCase() === String(p_email).toLowerCase())) throw { code: 'SC002', message: 'email_in_use' };
      const settings = { botEnabled: false, codEnabled: true, paymentInstructions: '', defaultDeliveryCharge: 0, freeDeliveryThreshold: 0, lowStockThreshold: 3, onboardingCompletedAt: null, metaCatalog: null, ...(p_attestations ? { attestations: p_attestations } : {}) };
      const m = this.add('merchants', { business_name: p_shop, owner_name: p_owner, email: p_email, phone: p_phone, status: 'active', settings });
      this.add('merchant_users', { merchant_id: m.id, auth_user_id: p_auth_user, email: p_email, name: p_owner, role: 'owner', is_active: true });
      return [{ merchant_id: m.id, role: 'owner' }];
    },
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

  /** Storage keys deleted through the fake, in order. */
  removed: string[] = [];
  storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      createSignedUrl: async (key: string) => ({ data: { signedUrl: `https://storage.test/${key}` } }),
      remove: async (keys: string[]) => { this.removed.push(...keys); return { data: keys.map((name) => ({ name })), error: null }; },
    }),
  };

  /** Empty every table (route modules capture the client once, so tests reset rather than replace it). */
  reset(): void { this.tables = {}; this.counters = {}; this.removed = []; }
  rows(table: string): Row[] { return (this.tables[table] ??= []); }
  add(table: string, r: Row): Row {
    const row = { id: crypto.randomUUID(), created_at: new Date((this.clock += 1000)).toISOString(), ...clone(r) };
    this.rows(table).push(row);
    return row;
  }
  from(table: string) { return new Query(this, table); }
  async rpc(name: string, args: Row): Promise<Result> {
    const fn = this.rpcs[name];
    if (!fn) return { data: null, error: { code: 'PGRST202', message: `function ${name} not found` } };
    try { return { data: fn(args), error: null }; }
    catch (e) { const err = e as { code?: string; message?: string }; return { data: null, error: { code: err.code ?? 'P0001', message: err.message ?? String(e) } }; }
  }
  /** Typed as the real client for the code under test. */
  get client(): SupabaseClient { return this as unknown as SupabaseClient; }
}
