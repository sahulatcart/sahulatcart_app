import { defineConfig } from 'vitest/config';

// config.ts validates the environment the moment any module that logs is imported, so without this
// a test can only touch pure modules. Every value here is a dummy: tests never reach real services.
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'development', // vitest sets 'test', which config.ts rejects
      LOG_LEVEL: 'fatal',
      SUPABASE_URL: 'https://supabase.test.invalid',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
  },
});
