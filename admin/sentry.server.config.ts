// P6: Sentry, Node runtime. No DSN → never initialised. Request bodies (addresses, phones) are never sent.
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) { delete event.request.data; delete event.request.cookies; }
      return event;
    },
  });
}
