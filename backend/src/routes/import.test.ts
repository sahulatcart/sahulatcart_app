// P8 (FR-P8.6): re-importing a catalog never un-hides, never duplicates, never overwrites portal photos.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const fake = new FakeDb();
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({ auth: { getUser: async (t: string) => (t === 'jwt.owner.sig' ? { data: { user: { id: 'u-owner', email: 'o@shop.pk', user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) } }),
}));

let app: FastifyInstance;
const owner = { authorization: 'Bearer jwt.owner.sig' };
const products = () => fake.rows('products').filter((p) => p.merchant_id === 'M');
const byName = (n: string) => products().filter((p) => String(p.name).toLowerCase() === n.toLowerCase());
const importCsv = (csv: string) => app.inject({ method: 'POST', url: '/api/v1/admin/products/import', headers: owner, payload: { csv } });

beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Shop', status: 'active', settings: {} });
  fake.add('merchant_users', { merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'o@shop.pk' });
  fake.add('products', { merchant_id: 'M', name: 'Hidden Kurta', sku: 'HK-1', price: 100000, is_active: false, deleted_at: null, images: [], attributes: {} });
  fake.add('products', { merchant_id: 'M', name: 'Lawn Suit', sku: 'LS-1', price: 200000, is_active: true, deleted_at: null, images: ['M/lawn/portal.png'], attributes: { Size: ['M'] } });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

describe('plain CSV', () => {
  const csv = 'name,sku,price,stock\nHidden Kurta,HK-1,1500,4\nPlain Dupatta,,800,\nplain dupatta,,850,';
  it('a hidden product stays hidden and gets the file\'s price; two no-SKU rows for one name are one product', async () => {
    const r = await importCsv(csv);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ imported: 3, errors: [] });
    expect(byName('Hidden Kurta')[0]).toMatchObject({ is_active: false, price: 150000, stock: 4, track_stock: true });
    expect(byName('Plain Dupatta')).toHaveLength(1);
    expect(byName('Plain Dupatta')[0]).toMatchObject({ is_active: true, price: 85000 });
  });
  it('importing the same file again adds nothing', async () => {
    const before = products().length;
    await importCsv(csv);
    expect(products()).toHaveLength(before);
    expect(byName('Hidden Kurta')[0]!.is_active).toBe(false);
  });
  it('a bad row is reported and skipped', async () => {
    const r = await importCsv('name,price\nFree Thing,0');
    expect(r.json().errors[0]).toContain('price');
    expect(byName('Free Thing')).toHaveLength(0);
  });
});

describe('Shopify export', () => {
  const shopify = [
    'Handle,Title,Body (HTML),Variant SKU,Variant Price,Variant Inventory Qty,Image Src,Option1 Name,Option1 Value',
    'lawn-suit,Lawn Suit,<p>Soft lawn</p>,LS-1,1800.00,7,https://cdn.shopify.com/lawn.jpg,Size,L',
    'lawn-suit,,,LS-1B,1900.00,2,https://cdn.shopify.com/lawn2.jpg,Size,XL',
    'new-cap,New Cap,,NC-1,450.00,10,https://cdn.shopify.com/cap.jpg,Title,Default Title',
  ].join('\n');
  it('keeps the portal photos and attributes of an existing product, updates its price; inserts the new one', async () => {
    const r = await importCsv(shopify);
    expect(r.json()).toMatchObject({ imported: 2, errors: [], source: 'shopify' });
    const lawn = byName('Lawn Suit')[0]!;
    expect(lawn.images).toEqual(['M/lawn/portal.png']);
    expect(lawn.attributes).toEqual({ Size: ['M'] });
    expect(lawn).toMatchObject({ price: 180000, stock: 9, description: 'Soft lawn', is_active: true });
    expect(byName('New Cap')).toHaveLength(1);
    expect(byName('New Cap')[0]).toMatchObject({ images: ['https://cdn.shopify.com/cap.jpg'], is_active: true });
  });
});
