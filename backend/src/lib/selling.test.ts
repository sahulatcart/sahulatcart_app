// The console's "selling / not selling, and why": billing and WhatsApp combined, worst first.
import { describe, it, expect } from 'vitest';
import { sellingStatus, type SellingInput } from './selling';

const ok: SellingInput = {
  merchant: { status: 'active', settings: { botEnabled: true } },
  subscription: { plan: 'basic', status: 'active' },
  conversationsThisMonth: 10,
  connection: { status: 'connected', flagReason: null },
};
const s = (patch: Partial<SellingInput>) => sellingStatus({ ...ok, ...patch });

describe('sellingStatus', () => {
  it('a healthy shop sells, with nothing to say', () => {
    expect(sellingStatus(ok)).toEqual({ selling: true, code: 'selling', reason: null });
  });

  it('a revoked token stops selling even though billing says sell (the case the console used to show as green)', () => {
    const r = s({ connection: { status: 'needs_attention', flagReason: 'token' } });
    expect(r).toMatchObject({ selling: false, code: 'token' });
    expect(r.reason).toMatch(/reconnect/);
  });

  it('every WhatsApp state maps to one code', () => {
    expect(s({ connection: { status: 'none' } }).code).toBe('no_whatsapp');
    expect(s({ connection: { status: 'connecting' } }).code).toBe('connecting');
    expect(s({ connection: { status: 'disconnected' } }).code).toBe('disconnected');
    expect(s({ connection: { status: 'needs_attention', flagReason: 'policy' } }).code).toBe('policy');
    expect(s({ connection: { status: 'needs_attention', flagReason: 'manual' } }).code).toBe('registration');
  });

  it('a quality flag still sells, but says so', () => {
    expect(s({ connection: { status: 'needs_attention', flagReason: 'quality' } })).toMatchObject({ selling: true, code: 'quality' });
  });

  it('suspension and the owner switch win over everything', () => {
    const broken = { status: 'needs_attention', flagReason: 'token' };
    expect(s({ merchant: { status: 'suspended', settings: { botEnabled: true } }, connection: broken }).code).toBe('suspended');
    expect(s({ merchant: { status: 'active', settings: { botEnabled: false } }, connection: broken }).code).toBe('bot_off');
  });

  it('a broken connection wins over billing: the bot cannot send at all', () => {
    expect(s({ subscription: { plan: 'basic', status: 'past_due' }, connection: { status: 'needs_attention', flagReason: 'token' } }).code).toBe('token');
  });

  it('billing hand-over: overdue invoice, then the monthly allowance', () => {
    expect(s({ subscription: { plan: 'basic', status: 'past_due' } })).toMatchObject({ selling: false, code: 'past_due' });
    expect(s({ subscription: { plan: 'pilot', status: 'trial' }, conversationsThisMonth: 300 })).toMatchObject({ selling: false, code: 'limit' });
    expect(s({ subscription: null }).code).toBe('selling'); // no subscription row sells, as botMode does
  });
});
