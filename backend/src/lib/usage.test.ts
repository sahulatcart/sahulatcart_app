import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { LlmUnavailableError } from '../llm/types';
import { bumpUsage, chargeLlmCall, FREE_QUOTA, getUsage, karachiDate, outboundThisMonth, periodMonth, withLlmBudget } from './usage';

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb();
  db.add('merchants', { id: 'M1', settings: {} });
  db.add('whatsapp_numbers', { merchant_id: 'M1', phone_number_id: 'PN1', status: 'connected' });
});

describe('periods', () => {
  it('month and day are in Pakistan time', () => {
    // 2026-10-31 20:30 UTC is 2026-11-01 01:30 in Karachi (UTC+5).
    const d = new Date('2026-10-31T20:30:00Z');
    expect(periodMonth(d)).toBe('2026-11');
    expect(karachiDate(d)).toBe('2026-11-01');
    expect(periodMonth(new Date('2026-10-31T18:30:00Z'))).toBe('2026-10');
  });
});

describe('bumpUsage', () => {
  it('counts outbound, inbound and AI calls on one row per number per month', async () => {
    expect(await bumpUsage(db.client, 'PN1', { outbound: 1 })).toMatchObject({ merchantId: 'M1', outbound: 1, inbound: 0, llmCalls: 0 });
    expect(await bumpUsage(db.client, 'PN1', { inbound: 1, llm: 2 })).toMatchObject({ outbound: 1, inbound: 1, llmCalls: 2 });
    expect(db.rows('message_usage')).toHaveLength(1);
    expect(db.rows('message_usage')[0]).toMatchObject({ merchant_id: 'M1', phone_number_id: 'PN1', period_month: periodMonth() });
  });

  it('50 concurrent sends count 50', async () => {
    await Promise.all(Array.from({ length: 50 }, () => bumpUsage(db.client, 'PN1', { outbound: 1 })));
    expect(await outboundThisMonth(db.client, 'PN1')).toBe(50);
  });

  it('a number we do not hold counts nothing and does not throw', async () => {
    expect(await bumpUsage(db.client, 'PN-NONE', { outbound: 1 })).toBeNull();
    expect(db.rows('message_usage')).toHaveLength(0);
  });

  it('warns once at 80% and once at 100%, never again', async () => {
    await bumpUsage(db.client, 'PN1', { outbound: 799 });
    expect(db.rows('notifications')).toHaveLength(0);
    await bumpUsage(db.client, 'PN1', { outbound: 1 });
    expect(db.rows('notifications')).toHaveLength(1);
    expect(db.rows('notifications')[0]!.title).toContain('80%');
    await bumpUsage(db.client, 'PN1', { outbound: 199 });
    expect(db.rows('notifications')).toHaveLength(1);
    await bumpUsage(db.client, 'PN1', { outbound: 5 }); // 999 → 1004 crosses 1000 once
    expect(db.rows('notifications')).toHaveLength(2);
    expect(db.rows('notifications')[1]!.title).toContain('used up');
    expect(db.rows('notifications')[1]!.body).toContain('Rs 4');
    await bumpUsage(db.client, 'PN1', { outbound: 100 });
    expect(db.rows('notifications')).toHaveLength(2);
  });

  it('the AI day counter resets when the day changes', async () => {
    await bumpUsage(db.client, 'PN1', { llm: 3 });
    db.rows('message_usage')[0]!.llm_calls_day = '2020-01-01';
    expect((await bumpUsage(db.client, 'PN1', { llm: 1 }))!.llmCalls).toBe(1);
  });
});

describe('getUsage', () => {
  it('sums the month, prices the overage, and reads the two settings with defaults', async () => {
    await bumpUsage(db.client, 'PN1', { outbound: 1200, inbound: 400, llm: 7 });
    const u = await getUsage(db.client, 'M1');
    expect(u).toMatchObject({ outbound: 1200, inbound: 400, freeQuota: FREE_QUOTA, paidOutbound: 200, ratePaisa: 420, estimatedCostPaisa: 84000, afterQuota: 'continue', llmCallsToday: 7, llmDailyCap: 2000 });
    db.rows('merchants')[0]!.settings = { afterFreeQuota: 'handoff', llmDailyCap: 50 };
    expect(await getUsage(db.client, 'M1')).toMatchObject({ afterQuota: 'handoff', llmDailyCap: 50 });
  });

  it('is zero for a shop with no traffic', async () => {
    expect(await getUsage(db.client, 'M1')).toMatchObject({ outbound: 0, paidOutbound: 0, estimatedCostPaisa: 0 });
  });
});

describe('the AI budget', () => {
  it('counts calls inside a budget scope and refuses past the cap; no-op outside', async () => {
    await chargeLlmCall(); // no scope
    expect(db.rows('message_usage')).toHaveLength(0);
    await withLlmBudget({ db: db.client, phoneNumberId: 'PN1', cap: 2 }, async () => {
      await chargeLlmCall();
      await chargeLlmCall();
      await expect(chargeLlmCall()).rejects.toBeInstanceOf(LlmUnavailableError);
    });
    expect(db.rows('message_usage')[0]!.llm_calls).toBe(3);
  });
});
