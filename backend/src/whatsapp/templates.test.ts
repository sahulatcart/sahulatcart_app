import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { loadConfig } from '../config';

const fake = { db: new FakeDb() };
vi.mock('../lib/supabase', () => ({ getServiceClient: () => fake.db.client }));

import { forgetAllNumbers, storeToken } from './credentials';
import { handleAccountEvent } from './account-events';
import { approvedTemplate, applyTemplateStatus, ensureTemplates, listTemplates, resubmitTemplate, templateStatusFromEvent } from './templates';

const cfg = loadConfig();
type Call = { path: string; body: Record<string, unknown> | null };
let calls: Call[];
let createResponse: (name: string) => { status: number; body: unknown };

beforeEach(async () => {
  fake.db = new FakeDb();
  forgetAllNumbers();
  cfg.META_APP_ID = 'APP';
  cfg.META_APP_SECRET = 'SECRET';
  calls = [];
  createResponse = (name) => ({ status: 200, body: { id: `tpl-${name}`, status: 'PENDING', category: 'UTILITY' } });
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const u = new URL(url);
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ path: u.pathname, body });
    const r = createResponse(String(body?.name));
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
  const ref = await storeToken(fake.db.client, 'M1', 'tok');
  fake.db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN1', waba_id: 'WABA1', status: 'connected', access_token_ref: ref });
});
afterEach(() => vi.unstubAllGlobals());

describe('ensureTemplates', () => {
  it('creates the two utility templates once, stores them pending, and writes audit rows', async () => {
    const made = await ensureTemplates(fake.db.client, 'M1');
    expect(made.map((t) => t.name)).toEqual(['payment_update', 'order_sent']);
    expect(calls.map((c) => c.path.endsWith('/WABA1/message_templates'))).toEqual([true, true]);
    expect(calls[0]!.body).toMatchObject({ name: 'payment_update', language: 'en', category: 'UTILITY' });
    const comp = (calls[0]!.body!.components as { type: string; text: string; example: { body_text: string[][] } }[])[0]!;
    expect(comp.text).toContain('{{4}}');
    expect(comp.example.body_text[0]).toHaveLength(4);
    const rows = fake.db.rows('message_templates');
    expect(rows.map((r) => [r.status, r.category, r.param_count])).toEqual([['pending', 'utility', 4], ['pending', 'utility', 3]]);
    expect(fake.db.rows('audit_log').map((a) => a.action)).toEqual(['template_submit', 'template_submit']);
    await ensureTemplates(fake.db.client, 'M1');
    expect(calls).toHaveLength(2); // idempotent
  });

  it('a shop without a usable number creates nothing', async () => {
    fake.db.rows('whatsapp_numbers')[0]!.status = 'disconnected';
    expect(await ensureTemplates(fake.db.client, 'M1')).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('a Meta refusal for one template does not stop the other', async () => {
    createResponse = (name) => name === 'payment_update' ? { status: 400, body: { error: { message: 'Invalid parameter', code: 100 } } } : { status: 200, body: { id: 'tpl-2', status: 'PENDING' } };
    const made = await ensureTemplates(fake.db.client, 'M1');
    expect(made.map((t) => t.name)).toEqual(['order_sent']);
  });
});

describe('status updates', () => {
  beforeEach(() => ensureTemplates(fake.db.client, 'M1'));

  it('maps Meta events to the lowercase column', () => {
    expect(templateStatusFromEvent('APPROVED')).toBe('approved');
    expect(templateStatusFromEvent('REJECTED')).toBe('rejected');
    expect(templateStatusFromEvent('IN_APPEAL')).toBe('pending');
    expect(templateStatusFromEvent('WHATEVER')).toBeNull();
  });

  it('APPROVED updates the row silently; REJECTED stores the reason and tells the merchant', async () => {
    await handleAccountEvent(fake.db.client, { field: 'message_template_status_update', wabaId: 'WABA1', entryTime: null, value: { event: 'APPROVED', message_template_name: 'payment_update', message_template_id: 991 } });
    const row = fake.db.rows('message_templates').find((r) => r.name === 'payment_update')!;
    expect(row.status).toBe('approved');
    expect(row.wa_template_id).toBe('991');
    expect(fake.db.rows('notifications')).toHaveLength(0);
    await applyTemplateStatus(fake.db.client, { field: 'message_template_status_update', wabaId: 'WABA1', entryTime: null, value: { event: 'REJECTED', message_template_name: 'order_sent', reason: 'INVALID_FORMAT' } });
    const rej = fake.db.rows('message_templates').find((r) => r.name === 'order_sent')!;
    expect(rej.status).toBe('rejected');
    expect(rej.rejection_reason).toBe('INVALID_FORMAT');
    const n = fake.db.rows('notifications');
    expect(n).toHaveLength(1);
    expect(n[0]!.type).toBe('template_status');
    expect(n[0]!.body).toContain('INVALID_FORMAT');
    // U2: a rejection reaches the founders; the approval above did not.
    const pn = fake.db.rows('platform_notifications');
    expect(pn).toHaveLength(1);
    expect(pn[0]).toMatchObject({ kind: 'whatsapp_attention', merchant_id: 'M1', data: { reason: 'template', template: 'order_sent', status: 'rejected' } });
    expect(pn[0]!.body).toContain('INVALID_FORMAT');
    expect(pn[0]!.title).toContain('order_sent template rejected');
  });

  it('an unknown template name changes nothing', async () => {
    await applyTemplateStatus(fake.db.client, { field: 'message_template_status_update', wabaId: 'WABA1', entryTime: null, value: { event: 'REJECTED', message_template_name: 'something_else' } });
    expect(fake.db.rows('notifications')).toHaveLength(0);
  });
});

describe('resubmit and approvedTemplate', () => {
  beforeEach(() => ensureTemplates(fake.db.client, 'M1'));

  it('resubmits under _v2, and the newest approved version is the one used', async () => {
    const r = await resubmitTemplate(fake.db.client, { merchantId: 'M1', memberId: 'U1' }, 'payment_update');
    expect(r?.name).toBe('payment_update_v2');
    expect(calls.at(-1)!.body).toMatchObject({ name: 'payment_update_v2' });
    expect(fake.db.rows('audit_log').at(-1)).toMatchObject({ action: 'template_resubmit', user_id: 'U1' });
    expect(await approvedTemplate(fake.db.client, 'M1', 'payment_update')).toBeNull();
    await applyTemplateStatus(fake.db.client, { field: 'message_template_status_update', wabaId: 'WABA1', entryTime: null, value: { event: 'APPROVED', message_template_name: 'payment_update_v2' } });
    expect((await approvedTemplate(fake.db.client, 'M1', 'payment_update'))?.name).toBe('payment_update_v2');
    expect((await listTemplates(fake.db.client, 'M1')).map((t) => t.name)).toEqual(['payment_update', 'order_sent', 'payment_update_v2']);
    const r3 = await resubmitTemplate(fake.db.client, { merchantId: 'M1' }, 'payment_update');
    expect(r3?.name).toBe('payment_update_v3');
  });

  it('an unknown kind is refused', async () => {
    expect(await resubmitTemplate(fake.db.client, { merchantId: 'M1' }, 'marketing_blast')).toBeNull();
  });
});
