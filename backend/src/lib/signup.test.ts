// U3: the sign-up gate read from platform_settings, with the env vars as the fallback.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeDb } from '../test-support/fake-db';
import { _resetSignupGateCache, signupAllowed, signupGate } from './signup';

const env = { SIGNUP_OPEN: false, SIGNUP_ALLOWLIST: 'Env@Shop.pk, second@shop.pk' };
let db: FakeDb;
beforeEach(() => { db = new FakeDb(); _resetSignupGateCache(); });

describe('signupGate', () => {
  it('with no rows: the env values, marked as such', async () => {
    const g = await signupGate(db.client, env);
    expect(g).toMatchObject({ SIGNUP_OPEN: false, allowlist: ['env@shop.pk', 'second@shop.pk'], source: { open: 'env', allowlist: 'env' } });
    expect(signupAllowed('ENV@shop.pk', g)).toBe(true);
    expect(signupAllowed('x@y.pk', g)).toBe(false);
  });
  it('a signup_open row overrides env; a malformed row falls back', async () => {
    db.add('platform_settings', { key: 'signup_open', value: true });
    db.add('platform_settings', { key: 'signup_allowlist', value: 'not-a-list' });
    const g = await signupGate(db.client, env);
    expect(g).toMatchObject({ SIGNUP_OPEN: true, source: { open: 'db', allowlist: 'env' } });
    expect(signupAllowed('anyone@x.pk', g)).toBe(true);
  });
  it('a stored list replaces the env list, and active platform admins are always allowed but never listed', async () => {
    db.add('platform_settings', { key: 'signup_allowlist', value: ['Listed@Shop.pk'] });
    db.add('platform_admins', { email: 'fazal@sahulatcart.com', is_active: true });
    db.add('platform_admins', { email: 'gone@sahulatcart.com', is_active: false });
    const g = await signupGate(db.client, env);
    expect(g.allowlist).toEqual(['listed@shop.pk']);
    expect(g.source.allowlist).toBe('db');
    expect(signupAllowed('listed@shop.pk', g)).toBe(true);
    expect(signupAllowed('fazal@sahulatcart.com', g)).toBe(true);
    expect(signupAllowed('gone@sahulatcart.com', g)).toBe(false);
    expect(signupAllowed('env@shop.pk', g)).toBe(false);
  });
  it('caches for a minute; the reset (and the PUT route) clears it', async () => {
    const a = await signupGate(db.client, env);
    db.add('platform_settings', { key: 'signup_open', value: true });
    expect((await signupGate(db.client, env)).SIGNUP_OPEN).toBe(false); // still the cached answer
    _resetSignupGateCache();
    expect((await signupGate(db.client, env)).SIGNUP_OPEN).toBe(true);
    vi.useFakeTimers();
    try {
      _resetSignupGateCache();
      await signupGate(db.client, env);
      db.rows('platform_settings')[0]!.value = false;
      vi.advanceTimersByTime(61_000);
      expect((await signupGate(db.client, env)).SIGNUP_OPEN).toBe(false);
    } finally { vi.useRealTimers(); }
    expect(a.source.open).toBe('env');
  });
});
