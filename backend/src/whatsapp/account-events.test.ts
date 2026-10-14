import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { handleAccountEvent } from './account-events';
import { forgetAllNumbers } from './credentials';
import type { AccountEvent } from './types';

let db: FakeDb;
const ev = (field: string, value: Record<string, unknown>, wabaId = 'WABA1'): AccountEvent => ({ field, wabaId, entryTime: 1_790_000_000, value });
const row = () => db.rows('whatsapp_numbers')[0]!;
const notes = () => db.rows('notifications');

beforeEach(() => {
  db = new FakeDb();
  forgetAllNumbers();
  db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN1', waba_id: 'WABA1', phone_e164: '923001111111', status: 'connected', flag_reason: null, quality_rating: 'green', messaging_tier: 'tier_1' });
});

describe('phone_number_quality_update', () => {
  it('a quality flag never reaches the founders (U2: the merchant fixes that one)', async () => {
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '923001111111', event: 'FLAGGED', current_limit: 'TIER_1K' }));
    expect(row().flag_reason).toBe('quality');
    expect(db.rows('platform_notifications')).toHaveLength(0);
  });

  it('FLAGGED → red, needs_attention (quality), merchant told; UNFLAGGED restores', async () => {
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '+92 300 1111111', event: 'FLAGGED', current_limit: 'TIER_250' }));
    expect(row()).toMatchObject({ quality_rating: 'red', status: 'needs_attention', flag_reason: 'quality', messaging_tier: 'unverified' });
    expect(row().attention_message).toContain('flagged');
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.merchant_id).toBe('M1');
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '+923001111111', event: 'UNFLAGGED', current_limit: 'TIER_1K' }));
    expect(row()).toMatchObject({ quality_rating: 'green', status: 'connected', flag_reason: null, attention_message: null, messaging_tier: 'tier_1' });
    expect(notes()).toHaveLength(2);
  });

  it('DOWNGRADE → yellow with a notification; UPGRADE → green silently', async () => {
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '923001111111', event: 'DOWNGRADE' }));
    expect(row().quality_rating).toBe('yellow');
    expect(row().status).toBe('connected');
    expect(notes()).toHaveLength(1);
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '923001111111', event: 'UPGRADE', current_limit: 'TIER_10K' }));
    expect(row()).toMatchObject({ quality_rating: 'green', messaging_tier: 'tier_2' });
    expect(notes()).toHaveLength(1);
  });

  it('UNFLAGGED never clears a token or policy flag', async () => {
    row().status = 'needs_attention';
    row().flag_reason = 'token';
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '923001111111', event: 'UNFLAGGED' }));
    expect(row().status).toBe('needs_attention');
    expect(row().flag_reason).toBe('token');
  });

  it('a number we do not hold is ignored', async () => {
    await handleAccountEvent(db.client, ev('phone_number_quality_update', { display_phone_number: '923009999999', event: 'FLAGGED' }));
    expect(row().status).toBe('connected');
    expect(notes()).toHaveLength(0);
  });
});

describe('account_update', () => {
  it('a restriction flags every number on the WABA with the reason', async () => {
    db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN2', waba_id: 'WABA1', phone_e164: '923002222222', status: 'connected', flag_reason: null });
    await handleAccountEvent(db.client, ev('account_update', { event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: 'DISABLE', waba_ban_date: 'today' } }));
    for (const r of db.rows('whatsapp_numbers')) {
      expect(r.status).toBe('needs_attention');
      expect(r.flag_reason).toBe('policy');
      expect(r.attention_message).toContain('DISABLE');
    }
    expect(notes()).toHaveLength(1); // one merchant, one notification
    expect(db.rows('platform_notifications')).toHaveLength(1); // U2: and one row for the founders
    expect(db.rows('platform_notifications')[0]).toMatchObject({ kind: 'whatsapp_attention', merchant_id: 'M1', data: { reason: 'policy', event: 'DISABLED_UPDATE' } });
    expect(db.rows('platform_notifications')[0]!.title).toContain('Meta restricted WhatsApp, bot stopped');
    expect(db.rows('platform_notifications')[0]!.body).toMatch(/Only the owner can see Meta's reason and appeal/);
  });

  it('PARTNER_REMOVED means reconnect', async () => {
    await handleAccountEvent(db.client, ev('account_update', { event: 'PARTNER_REMOVED' }));
    expect(row()).toMatchObject({ status: 'needs_attention', flag_reason: 'token' });
    expect(notes()[0]!.data.action).toBe('reconnect_whatsapp');
    expect(db.rows('platform_notifications')[0]).toMatchObject({ kind: 'whatsapp_attention', data: { reason: 'token', event: 'PARTNER_REMOVED' } }); // U2
  });

  it('VERIFIED_ACCOUNT only informs', async () => {
    await handleAccountEvent(db.client, ev('account_update', { event: 'VERIFIED_ACCOUNT' }));
    expect(row().status).toBe('connected');
    expect(notes()[0]!.title).toContain('verified');
  });

  it('an unknown WABA is ignored', async () => {
    await handleAccountEvent(db.client, ev('account_update', { event: 'DISABLED_UPDATE' }, 'WABA-X'));
    expect(row().status).toBe('connected');
  });
});

describe('message_template_status_update', () => {
  it('a rejection reaches the merchant as template_status; an approval only updates the row', async () => {
    db.add('message_templates', { merchant_id: 'M1', waba_id: 'WABA1', name: 'payment_update', status: 'pending', rejection_reason: null });
    await handleAccountEvent(db.client, ev('message_template_status_update', { event: 'APPROVED', message_template_name: 'payment_update' }));
    expect(notes()).toHaveLength(0);
    expect(db.rows('message_templates')[0]!.status).toBe('approved');
    await handleAccountEvent(db.client, ev('message_template_status_update', { event: 'REJECTED', message_template_name: 'payment_update', reason: 'INVALID_FORMAT' }));
    expect(notes()).toHaveLength(1);
    expect(notes()[0]!.type).toBe('template_status');
    expect(notes()[0]!.body).toContain('INVALID_FORMAT');
  });
});

it('an unknown field is skipped without throwing', async () => {
  await handleAccountEvent(db.client, ev('something_new', { a: 1 }));
  expect(row().status).toBe('connected');
});
