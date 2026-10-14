// M7 step 4: the Graph API version must be set explicitly in production and look like vNN.N.
// parseEnv() validates without exiting, so the boot-time rule can be tested directly.
import { describe, it, expect } from 'vitest';
import { DEV_GRAPH_API_VERSION, parseEnv } from './config';

const base = {
  SUPABASE_URL: 'https://supabase.test.invalid',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};
const prod = { ...base, NODE_ENV: 'production', TOKEN_ENCRYPTION_KEY: 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdC0=' };
const paths = (r: ReturnType<typeof parseEnv>) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.')));

describe('META_GRAPH_API_VERSION', () => {
  it('production without it does not boot, and says which variable', () => {
    const r = parseEnv(prod);
    expect(r.success).toBe(false);
    expect(paths(r)).toEqual(['META_GRAPH_API_VERSION']);
  });

  it('production with it boots and uses exactly that version', () => {
    const r = parseEnv({ ...prod, META_GRAPH_API_VERSION: 'v26.0' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.META_GRAPH_API_VERSION).toBe('v26.0');
  });

  it('a malformed version is refused anywhere, so a typo cannot reach a Graph URL', () => {
    for (const v of ['25.0', 'v25', 'V25.0', 'v25.0/', ' v25.0', '']) {
      expect(paths(parseEnv({ ...base, META_GRAPH_API_VERSION: v }))).toContain('META_GRAPH_API_VERSION');
    }
  });

  it('outside production a missing value falls back to the current version, never the old v21.0', () => {
    const r = parseEnv(base);
    expect(r.success).toBe(true);
    expect(r.success && r.data.META_GRAPH_API_VERSION).toBe(DEV_GRAPH_API_VERSION);
    expect(DEV_GRAPH_API_VERSION).not.toBe('v21.0');
  });

  it('the other production rule still holds alongside it', () => {
    const r = parseEnv({ ...base, NODE_ENV: 'production', META_GRAPH_API_VERSION: 'v25.0' });
    expect(paths(r)).toEqual(['TOKEN_ENCRYPTION_KEY']);
  });
});
