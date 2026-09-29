import { beforeEach, describe, expect, it } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { LOG_DAYS, purgeLogs, purgeScreenshots, SCREENSHOT_DAYS } from './retention';

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60_000).toISOString();
let db: FakeDb;
const claim = (id: string) => db.rows('payment_claims').find((c) => c.id === id)!;

describe('purgeScreenshots', () => {
  beforeEach(() => {
    db = new FakeDb();
    const old = daysAgo(SCREENSHOT_DAYS + 5);
    db.add('payment_claims', { id: 'verified-old', status: 'verified', decided_at: old, screenshot_url: 'm/o1/a.png' });
    db.add('payment_claims', { id: 'rejected-old', status: 'rejected', decided_at: old, screenshot_url: 'm/o2/b.png' });
    db.add('payment_claims', { id: 'meta-media-old', status: 'verified', decided_at: old, screenshot_url: 'media:12345' });
    // Still awaiting review — protected by its status alone, even with an old timestamp (e.g. a reopened claim).
    db.add('payment_claims', { id: 'awaiting-review', status: 'claimed', decided_at: old, screenshot_url: 'm/o3/c.png' });
    db.add('payment_claims', { id: 'verified-recent', status: 'verified', decided_at: daysAgo(10), screenshot_url: 'm/o4/d.png' });
    db.add('payments', { id: 'p1', screenshot_url: 'm/o1/a.png' });
    db.add('payments', { id: 'p3', screenshot_url: 'm/o3/c.png' });
  });

  it('deletes screenshots settled over 90 days ago and clears their references', async () => {
    expect(await purgeScreenshots(db.client)).toBe(3);
    expect(db.removed).toEqual(['m/o1/a.png', 'm/o2/b.png']); // "media:" ids were never in our bucket
    for (const id of ['verified-old', 'rejected-old', 'meta-media-old']) expect(claim(id).screenshot_url).toBeNull();
    expect(db.rows('payments').find((p) => p.id === 'p1')!.screenshot_url).toBeNull();
  });

  it('never touches a screenshot still awaiting review, or one settled recently', async () => {
    await purgeScreenshots(db.client);
    expect(claim('awaiting-review').screenshot_url).toBe('m/o3/c.png');
    expect(claim('verified-recent').screenshot_url).toBe('m/o4/d.png');
    expect(db.rows('payments').find((p) => p.id === 'p3')!.screenshot_url).toBe('m/o3/c.png');
  });

  it('records the purge in audit_log, and does nothing when nothing is due', async () => {
    await purgeScreenshots(db.client);
    expect(db.rows('audit_log').at(-1)).toMatchObject({ action: 'purge_payment_screenshots', diff: { screenshots: 3 } });
    expect(await purgeScreenshots(db.client)).toBe(0);
    expect(db.rows('audit_log')).toHaveLength(1);
  });
});

describe('purgeLogs', () => {
  it(`drops webhook events and clears raw payloads older than ${LOG_DAYS} days, keeping message text`, async () => {
    db = new FakeDb();
    db.add('webhook_events', { event_id: 'old', received_at: daysAgo(LOG_DAYS + 1) });
    db.add('webhook_events', { event_id: 'new', received_at: daysAgo(1) });
    db.add('messages', { id: 'm-old', body: 'kitne ka hai', raw: { id: 'wamid.1' }, created_at: daysAgo(LOG_DAYS + 1) });
    db.add('messages', { id: 'm-new', body: 'theek hai', raw: { id: 'wamid.2' }, created_at: daysAgo(1) });

    await purgeLogs(db.client);
    expect(db.rows('webhook_events').map((e) => e.event_id)).toEqual(['new']);
    expect(db.rows('messages').find((m) => m.id === 'm-old')).toMatchObject({ body: 'kitne ka hai', raw: null });
    expect(db.rows('messages').find((m) => m.id === 'm-new')!.raw).toEqual({ id: 'wamid.2' });
    expect(db.rows('audit_log').at(-1)).toMatchObject({ action: 'purge_logs', diff: { webhook_events: 1, messages_raw: 1 } });
  });
});
