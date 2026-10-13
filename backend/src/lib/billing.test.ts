// Billing (P7) over FakeDb: the mode decision, the trial, the daily job and marking an invoice paid.
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { addMonths, botMode, ensureTrial, markInvoicePaid, runBillingJob } from './billing';

const T0 = new Date('2026-10-14T06:00:00Z');
const days = (n: number, from = T0) => new Date(from.getTime() + n * 86_400_000);
let db: FakeDb;
const sub = () => db.rows('subscriptions')[0]!;
const invoices = () => db.rows('invoices');
const titles = () => db.rows('notifications').map((n) => String(n.title));

beforeEach(() => {
  db = new FakeDb();
  db.add('merchants', { id: 'M', business_name: 'Shop', status: 'active', plan: 'pilot', settings: { botEnabled: true } });
});

describe('botMode (FR-P7.6)', () => {
  const active = { plan: 'basic' as const, status: 'active' as const };
  it('off beats everything; no subscription sells; past_due or a full allowance hands off', () => {
    expect(botMode({ status: 'suspended' }, active, 0)).toEqual({ mode: 'off', reason: 'suspended' });
    expect(botMode({ settings: { botEnabled: false } }, { ...active, status: 'past_due' }, 0)).toEqual({ mode: 'off', reason: 'bot_off' });
    expect(botMode({ status: 'active' }, null, 99_999)).toEqual({ mode: 'sell', reason: null });
    expect(botMode({ status: 'active' }, { ...active, status: 'past_due' }, 0)).toEqual({ mode: 'handoff', reason: 'past_due' });
    expect(botMode({ status: 'active' }, { ...active, status: 'expired' }, 0)).toEqual({ mode: 'handoff', reason: 'past_due' });
    expect(botMode({ status: 'active' }, active, 999)).toEqual({ mode: 'sell', reason: null });
    expect(botMode({ status: 'active' }, active, 1000)).toEqual({ mode: 'handoff', reason: 'limit' });
    expect(botMode({ status: 'active' }, { plan: 'pilot', status: 'trial' }, 300)).toEqual({ mode: 'handoff', reason: 'limit' });
  });
});

describe('ensureTrial (FR-P7.2)', () => {
  it('gives a new shop 30 free days once', async () => {
    await ensureTrial(db.client, 'M', T0);
    await ensureTrial(db.client, 'M', days(5));
    expect(db.rows('subscriptions')).toHaveLength(1);
    expect(sub()).toMatchObject({ merchant_id: 'M', plan: 'pilot', status: 'trial', trial_ends_at: days(30).toISOString() });
  });
});

describe('runBillingJob (FR-P7.3, P7.7)', () => {
  it('warns once seven days before the trial ends, then ends it: past_due and a Basic invoice due', async () => {
    await ensureTrial(db.client, 'M', T0);
    expect(await runBillingJob(db.client, days(10))).toMatchObject({ warned: [], pastDue: [], invoiced: [] });
    expect(await runBillingJob(db.client, days(23))).toMatchObject({ warned: [sub().id] });
    expect(await runBillingJob(db.client, days(24))).toMatchObject({ warned: [] }); // only once
    expect(titles().filter((t) => t.includes('free pilot ends'))).toHaveLength(1);
    expect(sub().status).toBe('trial');

    const r = await runBillingJob(db.client, days(31));
    expect(r.pastDue).toEqual([sub().id]);
    expect(sub().status).toBe('past_due');
    expect(invoices()).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({ merchant_id: 'M', plan: 'basic', status: 'due', amount_paisa: 299900, period_start: days(30).toISOString(), period_end: addMonths(days(30).toISOString(), 1) });
    expect(titles().some((t) => t.startsWith('Invoice due: Basic plan, Rs 2,999'))).toBe(true);
    expect(titles().some((t) => t === 'Your free pilot has ended')).toBe(true);
    expect(await runBillingJob(db.client, days(32))).toMatchObject({ pastDue: [], invoiced: [] }); // past_due rows are left alone
    expect(invoices()).toHaveLength(1);
  });

  it('an active plan is invoiced seven days before the period ends, once, and goes past_due seven days after if unpaid', async () => {
    const end = days(20).toISOString();
    db.add('subscriptions', { merchant_id: 'M', plan: 'pro', status: 'active', current_period_start: addMonths(end, -1), current_period_end: end });
    expect(await runBillingJob(db.client, days(12))).toMatchObject({ invoiced: [] });
    const r = await runBillingJob(db.client, days(13));
    expect(r.invoiced).toHaveLength(1);
    expect(invoices()[0]).toMatchObject({ plan: 'pro', amount_paisa: 799900, period_start: end, period_end: addMonths(end, 1), status: 'due' });
    expect(await runBillingJob(db.client, days(14))).toMatchObject({ invoiced: [] });
    expect(invoices()).toHaveLength(1);

    expect(await runBillingJob(db.client, days(26))).toMatchObject({ pastDue: [] }); // grace
    expect(await runBillingJob(db.client, days(27))).toMatchObject({ pastDue: [sub().id] });
    expect(sub().status).toBe('past_due');
    expect(titles().some((t) => t.startsWith('Invoice overdue'))).toBe(true);
  });

  it('a paid invoice never sends the plan past due', async () => {
    const end = days(-1).toISOString();
    db.add('subscriptions', { merchant_id: 'M', plan: 'basic', status: 'active', current_period_start: addMonths(end, -1), current_period_end: end });
    db.add('invoices', { merchant_id: 'M', subscription_id: sub().id, plan: 'basic', period_start: end, period_end: addMonths(end, 1), amount_paisa: 299900, status: 'paid' });
    expect(await runBillingJob(db.client, days(10))).toMatchObject({ pastDue: [], invoiced: [] });
    expect(sub().status).toBe('active');
  });
});

describe('markInvoicePaid (FR-P7.5)', () => {
  it('pays the invoice, activates the plan to the invoice period, tells the merchant; a second mark is 409', async () => {
    await ensureTrial(db.client, 'M', T0);
    await runBillingJob(db.client, days(31));
    const inv = invoices()[0]!;
    expect(await markInvoicePaid(db.client, inv.id, 'admin-1', days(32))).toEqual({ ok: true });
    expect(invoices()[0]).toMatchObject({ status: 'paid', marked_by_platform_admin: 'admin-1' });
    expect(sub()).toMatchObject({ status: 'active', plan: 'basic', current_period_start: inv.period_start, current_period_end: inv.period_end });
    expect(db.rows('merchants')[0]!.plan).toBe('basic');
    expect(botMode(db.rows('merchants')[0]!, sub() as never, 0).mode).toBe('sell');
    expect(titles().some((t) => t.startsWith('Payment received'))).toBe(true);
    expect(await markInvoicePaid(db.client, inv.id, 'admin-1')).toMatchObject({ ok: false, status: 409 });
    expect(await markInvoicePaid(db.client, 'nope', 'admin-1')).toMatchObject({ ok: false, status: 404 });
  });
});
