// P6 (FR-P6.1): error reporting. Without SENTRY_DSN nothing is initialised and the hooks are no-ops.
// Request bodies carry addresses and phone numbers, so they are never sent: body, cookie, query
// and user collection are off (SDK v11's dataCollection replaces sendDefaultPii) and beforeSend
// drops request.data as a second guard.
import * as Sentry from '@sentry/node';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config';

export function initSentry(cfg: Config): boolean {
  if (!cfg.SENTRY_DSN) return false;
  Sentry.init({
    dsn: cfg.SENTRY_DSN,
    environment: cfg.NODE_ENV,
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) { delete event.request.data; delete event.request.cookies; }
      return event;
    },
  });
  return true;
}

/** Report 5xx route errors (Sentry's Fastify handler skips 4xx by default). Unhandled rejections are covered by init(). */
export function attachSentry(app: FastifyInstance): void {
  Sentry.setupFastifyErrorHandler(app);
}
