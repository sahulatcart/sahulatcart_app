import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { accountEventId, claimWebhookPayload, upsertCustomer } from './webhook';
import { FakeDb } from '../test-support/fake-db';
import type { WebhookPayload } from './types';

const payload = (ids: string[]): WebhookPayload => ({
  entry: [{
    changes: [{
      field: 'messages',
      value: {
        metadata: { phone_number_id: 'PN1' },
        contacts: [{ profile: { name: 'Ahmed' }, wa_id: '923001234567' }],
        messages: ids.map((id) => ({ id, from: '923001234567', type: 'text', text: { body: 'hi' } })),
      },
    }],
  }],
});

/** Just the two calls the claim step makes: the tenant lookup and the webhook_events insert. */
function stubDb(opts: { tenantError?: boolean; insert?: (eventId: string) => { code: string; message: string } | null }) {
  const inserted: string[] = [];
  const db = {
    from: (table: string) => table === 'whatsapp_numbers'
      ? {
          select: () => ({ eq: () => ({ maybeSingle: async () => opts.tenantError
            ? { data: null, error: { message: 'connection reset' } }
            : { data: { id: 'W1', merchant_id: 'M1', phone_number_id: 'PN1', merchants: { business_name: 'Shop' } }, error: null } }) }),
        }
      : {
          insert: async (row: { event_id: string }) => {
            const error = opts.insert?.(row.event_id) ?? null;
            if (!error) inserted.push(row.event_id);
            return { error };
          },
        },
  };
  return { db: db as unknown as SupabaseClient, inserted };
}

describe('claimWebhookPayload (before the 200 to Meta)', () => {
  it('records every message and returns them for processing', async () => {
    const { db, inserted } = stubDb({});
    const { changes, complete } = await claimWebhookPayload(payload(['a', 'b']), db);
    expect(complete).toBe(true);
    expect(inserted).toEqual(['a', 'b']);
    expect(changes[0]!.messages.map((m) => m.waMessageId)).toEqual(['a', 'b']);
  });

  it('skips a message already recorded (Meta redelivery)', async () => {
    const { db } = stubDb({ insert: (id) => (id === 'a' ? { code: '23505', message: 'duplicate key' } : null) });
    const { changes, complete } = await claimWebhookPayload(payload(['a', 'b']), db);
    expect(complete).toBe(true);
    expect(changes[0]!.messages.map((m) => m.waMessageId)).toEqual(['b']);
  });

  it('a message that cannot be recorded is not processed, and the payload is incomplete so Meta retries', async () => {
    const { db } = stubDb({ insert: (id) => (id === 'b' ? { code: '08006', message: 'connection failure' } : null) });
    const { changes, complete } = await claimWebhookPayload(payload(['a', 'b']), db);
    expect(complete).toBe(false);
    expect(changes[0]!.messages.map((m) => m.waMessageId)).toEqual(['a']);
  });

  it('a failed tenant lookup is a retry, not an unknown number', async () => {
    const { db, inserted } = stubDb({ tenantError: true });
    const { changes, complete } = await claimWebhookPayload(payload(['a']), db);
    expect(complete).toBe(false);
    expect(changes).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});

describe('account events (M3)', () => {
  const eventPayload: WebhookPayload = {
    entry: [{ id: 'WABA1', time: 1, changes: [{ field: 'phone_number_quality_update', value: { display_phone_number: '1', event: 'FLAGGED' } as never }] }],
  };

  it('is claimed under item_type event with a payload-derived id, so a redelivery is a duplicate', async () => {
    const seen = new Set<string>();
    const { db } = stubDb({ insert: (id) => { if (seen.has(id)) return { code: '23505', message: 'dup' }; seen.add(id); return null; } });
    const first = await claimWebhookPayload(eventPayload, db);
    expect(first.complete).toBe(true);
    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.eventId).toMatch(/^phone_number_quality_update:WABA1:[0-9a-f]{32}$/);
    expect(first.events[0]!.eventId).toBe(accountEventId(first.events[0]!.event));
    const again = await claimWebhookPayload(eventPayload, db);
    expect(again.events).toHaveLength(0);
    expect(again.complete).toBe(true);
  });

  it('a failed claim makes the payload incomplete so Meta redelivers', async () => {
    const { db } = stubDb({ insert: () => ({ code: '08006', message: 'connection failure' }) });
    const r = await claimWebhookPayload(eventPayload, db);
    expect(r.complete).toBe(false);
    expect(r.events).toHaveLength(0);
  });
});

describe('upsertCustomer (P5, FR-P5.3: the first message is the opt-in)', () => {
  it('marks a new customer opted in by inbound message, and never undoes a STOP', async () => {
    const db = new FakeDb();
    const first = await upsertCustomer(db.client, 'M1', '923001234567', 'Ahmed');
    const row = () => db.rows('customers').find((c) => c.id === first!.id)!;
    expect(row()).toMatchObject({ wa_opt_in_status: 'in', wa_opt_in_source: 'inbound_message', name: 'Ahmed' });
    expect(row().wa_opt_in_at).toBeTruthy();
    row().wa_opt_in_status = 'out';
    await upsertCustomer(db.client, 'M1', '923001234567', null);
    expect(row().wa_opt_in_status).toBe('out');
    expect(db.rows('customers')).toHaveLength(1);
  });
});
