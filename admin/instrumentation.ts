// P6 (FR-P6.1): Sentry for the server and edge runtimes. Next loads this once per runtime at boot.
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config');
  if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');
}

// Route-handler and server-component errors (the API proxy included).
export const onRequestError = Sentry.captureRequestError;
