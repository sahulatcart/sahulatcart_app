import { withSentryConfig } from '@sentry/nextjs/config'; // SDK v11: the build helper lives on its own subpath

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@app/shared'],
  // P6: loads admin/instrumentation.ts (Sentry) once per runtime. Still "experimental" in Next 14.
  experimental: { instrumentationHook: true },
  // API proxy is a runtime route handler (app/api/[...path]/route.ts), NOT a rewrite —
  // next.config rewrites bake at build time, which loses the runtime BACKEND_URL.
};

// P6: injects sentry.client.config.ts into the browser bundle. No auth token is set, so nothing is
// uploaded to Sentry at build time; source maps stay off and the build never talks to the network.
export default withSentryConfig(nextConfig, { silent: true, telemetry: false, sourcemaps: { disable: true } });
