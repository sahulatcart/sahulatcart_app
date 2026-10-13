// P7 (FR-P7.4): the merchant's billing page. Own route file with its own auth hook (Part 0.3).
import type { FastifyInstance } from 'fastify';
import { PLANS } from '@app/shared';
import { loadConfig } from '../config';
import { getServiceClient } from '../lib/supabase';
import { forbid, isManager, requireMerchant } from '../lib/auth';
import { botMode, conversationsThisMonth, getSubscription, isPlan, planPricePaisa } from '../lib/billing';
import { getUsage } from '../lib/usage';

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
    const { data } = await db.from('invoices').update({ reference, claimed_at: new Date().toISOString() }).match({ id, merchant_id: req.merchantCtx!.merchantId, status: 'due' }).select('id').maybeSingle();
    if (!data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no due invoice with that id' } });
    return reply.send({ ok: true });
  });

  /** No self-service upgrade yet: the request is recorded and the platform console applies it. */
  app.post('/api/v1/admin/subscription/request', async (req, reply) => {
    if (!isManager(req.merchantCtx!)) return forbid(reply);
    const plan = (req.body as { plan?: unknown } | undefined)?.plan;
    if (!isPlan(plan) || plan === 'pilot') return reply.code(400).send({ error: { code: 'BAD', message: 'plan must be basic or pro' } });
    const mid = req.merchantCtx!.merchantId;
    const { data } = await db.from('subscriptions').update({ requested_plan: plan, updated_at: new Date().toISOString() }).eq('merchant_id', mid).select('id').maybeSingle();
    if (!data) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'no subscription for this shop' } });
    await db.from('audit_log').insert({ merchant_id: mid, actor: 'merchant', user_id: req.merchantCtx!.memberId ?? null, action: 'plan_change_requested', entity: 'subscription', entity_id: data.id, diff: { plan } });
    return reply.send({ ok: true, requestedPlan: plan });
  });
}
