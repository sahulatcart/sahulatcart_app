// Self-service signup (SRS P1). Account creation itself happens in Supabase Auth from the
// portal; these routes gate it and turn a confirmed user into a shop.
import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { platformAdminFor, resolveAuthUser } from '../lib/auth';
import { bootstrapMerchant, signupAllowed, signupGate, signupProfile } from '../lib/signup';

const closed = { error: { code: 'signup_closed', message: 'Sahulatcart is in private pilot; email us to join' } };

export async function signupRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();

  // The page asks before calling signUp, so a refused email never gets a stray auth user.
  app.post('/api/v1/signup/check', async (req, reply) => {
    const email = (req.body as { email?: string } | undefined)?.email;
    return reply.send({ allowed: signupAllowed(email, await signupGate(db)) });
  });

  // JWT required, no membership required. The profile comes from the auth user's metadata
  // (set by the signup form) and may be overridden by the body for the same fields.
  app.post('/api/v1/signup/bootstrap', async (req, reply) => {
    const user = await resolveAuthUser(req);
    if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
    if (!signupAllowed(user.email, await signupGate(db))) return reply.code(403).send(closed);
    // IC-7 (M6): the platform owner logs in to the console, not into a shop of their own.
    if (await platformAdminFor(user.id, user.email, true)) return reply.code(409).send({ error: { code: 'PLATFORM_ADMIN', message: 'This login is a platform admin; open /platform instead' } });
    const profile = signupProfile({ ...user.metadata, ...((req.body as Record<string, unknown> | undefined) ?? {}) });
    if ('error' in profile) return reply.code(400).send({ error: { code: 'BAD', message: profile.error } });
    // Review P1-10: a returning owner goes to the dashboard, a new one to the wizard.
    const had = await db.from('merchant_users').select('id').eq('auth_user_id', user.id).eq('is_active', true).limit(1).maybeSingle();
    const r = await bootstrapMerchant(db, user, profile);
    if ('error' in r) {
      if (r.conflict) return reply.code(409).send({ error: { code: r.conflict, message: r.error } });
      return reply.code(500).send({ error: { code: 'DB', message: r.error } });
    }
    return reply.send({ ...r, existing: !!had.data });
  });
}
