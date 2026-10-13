// P4 routes through the real server: staff may set stages, only managers cancel, invalid steps are 409.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FakeDb } from '../test-support/fake-db';

const fake = new FakeDb();
vi.mock('../whatsapp/client', () => ({
  sendText: async () => ({ waMessageId: 'wamid.1' }),
  sendDocument: async () => ({ waMessageId: null }),
  sendTemplate: async () => ({ waMessageId: null }),
}));
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
let orderId: string;
beforeAll(async () => {
  fake.add('merchants', { id: 'M', business_name: 'Shop', settings: {} });
  fake.add('merchant_users', { id: 'member-owner', merchant_id: 'M', auth_user_id: 'u-owner', role: 'owner', is_active: true, email: 'owner@shop.pk' });
  fake.add('merchant_users', { id: 'member-staff', merchant_id: 'M', auth_user_id: 'u-staff', role: 'staff', is_active: true, email: 'staff@shop.pk' });
  fake.add('customers', { id: 'cust-1', merchant_id: 'M', wa_id: '923001112222' });
  fake.add('whatsapp_numbers', { id: 'num-1', merchant_id: 'M', phone_number_id: 'pn-1' });
  fake.add('conversations', { id: 'conv-1', merchant_id: 'M', customer_id: 'cust-1', whatsapp_number_id: 'num-1', window_expires_at: new Date(Date.now() + 3_600_000).toISOString(), context: {} });
  orderId = fake.add('orders', { merchant_id: 'M', customer_id: 'cust-1', conversation_id: 'conv-1', order_number: 'SK-1001', status: 'confirmed', payment_method: 'cod', payment_status: 'cod_pending', slip_url: null }).id;
  const { buildServer } = await import('../server');
  app = await buildServer();
  await app.ready();
});
afterAll(() => app.close());

const order = () => fake.rows('orders').find((o) => o.id === orderId)!;

describe('stages', () => {
  it('dispatching a confirmed order is 409 (prepare it first)', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/dispatched`, headers: staff, payload: { courier: 'TCS' } });
    expect(r.statusCode).toBe(409);
  });
  it('staff may move an order through the stages', async () => {
    let r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/preparing`, headers: staff });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/dispatched`, headers: staff, payload: { courier: 'TCS', trackingRef: '123' } });
    expect(r.statusCode).toBe(200);
    expect(order()).toMatchObject({ status: 'dispatched', courier: 'TCS', tracking_ref: '123' });
    r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/delivered`, headers: staff });
    expect(r.statusCode).toBe(200);
    expect(order().status).toBe('delivered');
  });
  it('an unknown order is 404', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/orders/nope/preparing', headers: owner });
    expect(r.statusCode).toBe(404);
  });
  it('the detail route carries the history for the stepper', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/admin/orders/${orderId}`, headers: owner });
    expect(r.statusCode).toBe(200);
    expect(r.json().history.map((h: { to_status: string }) => h.to_status)).toEqual(['preparing', 'dispatched', 'delivered']);
  });
});

describe('cancel is a manager\'s action (SRS P4)', () => {
  let id: string;
  beforeAll(() => { id = fake.add('orders', { merchant_id: 'M', customer_id: 'cust-1', conversation_id: 'conv-1', order_number: 'SK-1002', status: 'paid', payment_method: 'bank_transfer', payment_status: 'verified', slip_url: null }).id; });
  it('staff get 403', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${id}/cancel`, headers: staff, payload: {} });
    expect(r.statusCode).toBe(403);
  });
  it('an owner can cancel a paid order (any non-terminal status), and a delivered one is 409', async () => {
    let r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${id}/cancel`, headers: owner, payload: { reason: 'out of stock' } });
    expect(r.statusCode).toBe(200);
    r = await app.inject({ method: 'POST', url: `/api/v1/admin/orders/${orderId}/cancel`, headers: owner, payload: {} });
    expect(r.statusCode).toBe(409);
  });
});
