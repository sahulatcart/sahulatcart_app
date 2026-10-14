// P7 (FR-P7.4): the merchant's billing page. Own route file with its own auth hook (Part 0.3).
import type { FastifyInstance } from 'fastify';
import { PLANS } from '@app/shared';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { botMode, conversationsThisMonth, getSubscription, isPlan, planPricePaisa } from '../lib/billing';
import { getUsage } from '../lib/usage';
import { notifyPlatform } from '../lib/notify';

const MAX_REFERENCE = 80;

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();
  app.addHook('preHandler', requireMerchant);

  app.get('/api/v1/admin/billing', async (req, reply) => {
    const mid = req.merchantCtx!.merchantId;
    const [sub, m, convs, usage, invoices] = await Promise.all([
      getSubscription(db, mid),
      db.from('merchants').select('status, settings, plan').eq('id', mid).maybeSingle(),
      conversationsThisMonth(db, mid),
      getUsage(db, mid),
      db.from('invoices').select('id, plan, period_start, period_end, amount_paisa, status, reference, claimed_at, paid_at, created_at').eq('merchant_id', mid).order('period_start', { ascending: false }).limit(24),
    ]);
    const plan = sub?.plan ?? (m.data?.plan as 'pilot' | 'basic' | 'pro' | undefined) ?? 'pilot';
    return reply.send({
      plan,
      subscription: sub ? { status: sub.status, trialEndsAt: sub.trial_ends_at, currentPeriodStart: sub.current_period_start, currentPeriodEnd: sub.current_period_end, requestedPlan: sub.requested_plan } : null,
      limits: { conversations: PLANS[plan].conversations },
      usage: { month: usage.month, conversations: convs, outbound: usage.outbound, freeQuota: usage.freeQuota },
      ...botMode(m.data ?? {}, sub, convs),
      invoices: invoices.data ?? [],
      plans: (['pilot', 'basic', 'pro'] as const).map((p) => ({ id: p, label: PLANS[p].label, conversations: PLANS[p].conversations, pricePaisa: planPricePaisa(p) })),
      bankDetails: loadConfig().PLATFORM_BANK_DETAILS,
    });
  });

  /** "I've paid, reference …": the invoice stays due; the reference shows in the platform console. */
  app.post('/api/v1/admin/invoices/:id/claim', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const { id } = req.params as { id: string };
    const reference = String((req.body as { reference?: unknown } | undefined)?.reference ?? '').trim();
    if (!reference || reference.length > MAX_REFERENCE) return reply.code(400).send({ error: { code: 'BAD', message: `reference is required (max ${MAX_REFERENCE} characters)` } });
    const mid = req.merchantCtx!.merchantId;
    // Review follow-up: the founders hear about a claim once, and again only when the reference
    // changes. A repeat of the same reference (a double click, a retry, a resubmit) changes nothing
    // and alerts nobody. Each step is one conditional UPDATE, so two identical clicks cannot both
    // win the first step: Postgres re-checks `reference is null` after the first one commits.
    const now = new Date().toISOString();
    const due = { id, merchant_id: mid, status: 'due' };
    const first = await db.from('invoices').update({ reference, claimed_at: now }).match(due).is('reference', null).select('id').maybeSingle();
    const changed = first.data ? null : await db.from('invoices').update({ reference, claimed_at: now }).match(due).neq('reference', reference).select('id').maybeSingle();
    if (first.data || changed?.data) {
      await notifyPlatform(db, { kind: 'invoice_claimed', merchantId: mid, title: first.data ? 'Invoice claimed' : 'Invoice reference changed', body: `Reference ${reference}`, data: { invoiceId: id } }); // U2: the founders mark it paid
      return reply.send({ ok: true });
    }
    const same = await db.from('invoices').select('id').match(due).maybeSingle();
    if (!same.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no due invoice with that id' } });
    return reply.send({ ok: true, unchanged: true });
  });

  /** No self-service upgrade yet: the request is recorded and the platform console applies it. */
  app.post('/api/v1/admin/subscription/request', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const plan = (req.body as { plan?: unknown } | undefined)?.plan;
    if (!isPlan(plan) || plan === 'pilot') return reply.code(400).send({ error: { code: 'BAD', message: 'plan must be basic or pro' } });
    const mid = req.merchantCtx!.merchantId;
    // Review follow-up: asking again for the plan already requested changes nothing, so it writes no
    // audit row and alerts nobody. `requested_plan <> plan` is not true for null in SQL, hence the
    // two conditional UPDATEs (null first, then a different plan).
    const now = new Date().toISOString();
    const first = await db.from('subscriptions').update({ requested_plan: plan, updated_at: now }).eq('merchant_id', mid).is('requested_plan', null).select('id, plan').maybeSingle();
    const changed = first.data ? null : await db.from('subscriptions').update({ requested_plan: plan, updated_at: now }).eq('merchant_id', mid).neq('requested_plan', plan).select('id, plan').maybeSingle();
    const data = first.data ?? changed?.data;
    if (!data) {
      const sub = await db.from('subscriptions').select('id').eq('merchant_id', mid).maybeSingle();
      if (!sub.data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no subscription for this shop' } });
      return reply.send({ ok: true, requestedPlan: plan, unchanged: true });
    }
    await db.from('audit_log').insert({ merchant_id: mid, actor: 'merchant', user_id: req.merchantCtx!.memberId ?? null, action: 'plan_change_requested', entity: 'subscription', entity_id: data.id, diff: { plan } });
    await notifyPlatform(db, { kind: 'plan_requested', merchantId: mid, title: 'Plan change requested', body: `${data.plan} → ${plan}`, data: { plan, subscriptionId: data.id } }); // U2
    return reply.send({ ok: true, requestedPlan: plan });
  });
}
