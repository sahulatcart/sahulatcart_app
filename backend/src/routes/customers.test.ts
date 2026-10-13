// P5 routes through the real server: block/unblock a customer, soft-delete a product.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const fake = new FakeDb();
const USERS: Record<string, { id: string; email: string }> = {
  'jwt.owner.sig': { id: 'u-owner', email: 'owner@shop.pk' },
  'jwt.staff.sig': { id: 'u-staff', email: 'staff@shop.pk' },
};
vi.mock('../lib/supabase', () => ({
  getServiceClient: () => fake.client,
  getAnonClient: () => ({
    auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: { ...USERS[token], user_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
  }),
}));

let app: FastifyInstance;
const owner = { authorization: 'Bearer jwt.owner.sig' };
const staff = { authorization: 'Bearer jwt.staff.sig' };
beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Shop', settings: {} });
  fake.add('merchants', { id: 'M2', business_name: 'Other', settings: {} });
  fake.add('merchant_users', { id: 'member-owner', merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@shop.pk' });
  fake.add('merchant_users', { id: 'member-staff', merchant_id: 'M', auth_user_id: 'u-staff', role: 'staff', is_active: true, email: 'staff@shop.pk' });
  fake.add('customers', { id: 'cust-1', merchant_id: 'M', wa_id: '923001112222', is_blocked: false, wa_opt_in_status: 'in' });
  fake.add('customers', { id: 'cust-other', merchant_id: 'M2', wa_id: '923009998888', is_blocked: false, wa_opt_in_status: 'in' });
  fake.add('products', { id: 'kurta', merchant_id: 'M', name: 'Kurta', price: 150000, is_active: true, deleted_at: null, images: [] });
  fake.add('products', { id: 'shawl', merchant_id: 'M', name: 'Shawl', price: 90000, is_active: true, deleted_at: null, images: [] });
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const customer = (id: string) => fake.rows('customers').find((c) => c.id === id)!;
const product = (id: string) => fake.rows('products').find((p) => p.id === id)!;

describe('block / unblock (FR-P5.8)', () => {
  it('staff get 403', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/customers/cust-1/block', headers: staff });
    expect(r.statusCode).toBe(403);
    expect(customer('cust-1').is_blocked).toBe(false);
  });
  it('an owner blocks, then unblocks', async () => {
    let r = await app.inject({ method: 'POST', url: '/api/v1/admin/customers/cust-1/block', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(customer('cust-1').is_blocked).toBe(true);
    r = await app.inject({ method: 'POST', url: '/api/v1/admin/customers/cust-1/unblock', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(customer('cust-1').is_blocked).toBe(false);
  });
  it("another shop's customer is 404", async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/customers/cust-other/block', headers: owner });
    expect(r.statusCode).toBe(404);
    expect(customer('cust-other').is_blocked).toBe(false);
  });
});

describe('delete a product (FR-P5.4)', () => {
  it('staff get 403', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/admin/products/kurta', headers: staff });
    expect(r.statusCode).toBe(403);
  });
  it('hides the row instead of removing it, and the catalog stops listing it', async () => {
    let r = await app.inject({ method: 'DELETE', url: '/api/v1/admin/products/kurta', headers: owner });
    expect(r.statusCode).toBe(200);
    expect(product('kurta')).toMatchObject({ is_active: false });
    expect(product('kurta').deleted_at).toBeTruthy();
    r = await app.inject({ method: 'GET', url: '/api/v1/admin/products', headers: owner });
    expect(r.json().products.map((p: { id: string }) => p.id)).toEqual(['shawl']);
    r = await app.inject({ method: 'GET', url: '/api/v1/admin/products/kurta', headers: owner });
    expect(r.statusCode).toBe(404);
  });
  it('deleting it again is 404', async () => {
    const r = await app.inject({ method: 'DELETE', url: '/api/v1/admin/products/kurta', headers: owner });
    expect(r.statusCode).toBe(404);
  });
});
