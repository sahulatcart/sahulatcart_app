import { z } from 'zod';

/**
 * Environment config with FAIL-FAST validation (docs/spec/09 §1.2).
 * Required-at-boot vars are validated here; the process exits if any are missing.
 * Phase-gated secrets (Meta, Anthropic) are optional until their phase lands, but
 * are validated as a group when their feature is enabled.
 */
const schema = z.object({
  PRODUCT_NAME: z.string().min(1).default('Sahulatkaar'),
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Supabase — required at boot
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Meta WhatsApp — optional until Phase 2
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_SYSTEM_USER_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default('v21.0'),
  META_DEFAULT_PHONE_NUMBER_ID: z.string().optional(),

  // LLM provider (Phase 3) — provider-agnostic; Gemini by default.
  LLM_PROVIDER: z.enum(['gemini', 'anthropic']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),

  // Secrets
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SERVICE_HMAC_SECRET: z.string().optional(),
  // Temporary pilot merchant-action auth (until the Phase-5 portal + JWT). Gates verify/reject.
  ADMIN_API_TOKEN: z.string().optional(),

  // Storage buckets
  STORAGE_BUCKET_PRODUCT_IMAGES: z.string().default('product-images'),
  STORAGE_BUCKET_PAYMENT_SCREENSHOTS: z.string().default('payment-screenshots'),
  STORAGE_BUCKET_INBOUND_MEDIA: z.string().default('inbound-media'),
  STORAGE_BUCKET_ORDER_SLIPS: z.string().default('order-slips'),
  STORAGE_BUCKET_CATALOG_IMPORTS: z.string().default('catalog-imports'),

  WEBHOOK_MAX_BODY_BYTES: z.coerce.number().int().positive().default(131072),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Fail fast — do not boot with an invalid environment.
    console.error(`[config] Invalid environment:\n${issues}`);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

/** Assert a phase's secret group is present (call when enabling that feature). */
export function assertMetaSecrets(cfg: Config): void {
  const missing = (['META_APP_ID', 'META_APP_SECRET', 'META_WEBHOOK_VERIFY_TOKEN', 'META_SYSTEM_USER_TOKEN'] as const)
    .filter((k) => !cfg[k]);
  if (missing.length) throw new Error(`Meta WhatsApp secrets missing: ${missing.join(', ')}`);
}

export function assertAnthropicSecrets(cfg: Config): void {
  if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');
}
