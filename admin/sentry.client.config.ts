// P6: Sentry in the browser. The DSN is public by design (NEXT_PUBLIC_, baked at build time).
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_RELEASE || undefined,
    dataCollection: { userInfo: false, cookies: false, urlQueryParams: false },
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
