import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimWebhookPayload } from './webhook';
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
