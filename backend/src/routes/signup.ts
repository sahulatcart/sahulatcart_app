// Self-service signup (SRS P1). Account creation itself happens in Supabase Auth from the
// portal; these routes gate it and turn a confirmed user into a shop.
import type { FastifyInstance } from 'fastify';
import { getServiceClient } from '../lib/supabase';
import { resolveAuthUser } from '../lib/auth';
import { bootstrapMerchant, signupAllowed, signupProfile } from '../lib/signup';

const closed = { error: { code: 'signup_closed', message: 'Sahulatcart is in private pilot; email us to join' } };

export async function signupRoutes(app: FastifyInstance): Promise<void> {
  const db = getServiceClient();

  // The page asks before calling signUp, so a refused email never gets a stray auth user.
  app.post('/api/v1/signup/check', async (req, reply) => {
    const email = (req.body as { email?: string } | undefined)?.email;
    return reply.send({ allowed: signupAllowed(email) });
  });

  // JWT required, no membership required. The profile comes from the auth user's metadata
  // (set by the signup form) and may be overridden by the body for the same fields.
  app.post('/api/v1/signup/bootstrap', async (req, reply) => {
    const user = await resolveAuthUser(req);
    if (!user) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'login required' } });
    if (!signupAllowed(user.email)) return reply.code(403).send(closed);
    const profile = signupProfile({ ...user.metadata, ...((req.body as Record<string, unknown> | undefined) ?? {}) });
    if ('error' in profile) return reply.code(400).send({ error: { code: 'BAD', message: profile.error } });
    const r = await bootstrapMerchant(db, user, profile);
    if ('error' in r) return reply.code(400).send({ error: { code: 'DB', message: r.error } });
    return reply.send(r);
  });
}
