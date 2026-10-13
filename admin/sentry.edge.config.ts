// P6: Sentry, edge runtime (nothing runs there today; kept so a future middleware is covered).
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
  });
}
