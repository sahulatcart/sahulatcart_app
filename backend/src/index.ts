import { loadConfig } from './config';
import { logger } from './lib/logger';
import { buildServer } from './server';
import { drainWebhooks, startReplaySweeper } from './whatsapp/webhook';
import { startRetentionJob } from './lib/retention';
import { flushPendingDigests } from './lib/notify';
import { startUnpaidExpiryJob } from './lib/jobs';
import { initSentry } from './lib/sentry';
import { startBillingJob } from './lib/billing';

async function main(): Promise<void> {
  const cfg = loadConfig(); // fail-fast env validation
  if (initSentry(cfg)) logger.info('Sentry enabled');
  // P6 (FR-P6.7): the per-buyer queue, the admin-token lockout and the rate-limit store are all
  // in-process, so this backend must run as ONE replica. Railway exposes the replica id but not
  // the count, so the most this can do is say so loudly on every boot.
  if (process.env.RAILWAY_REPLICA_ID) {
    logger.warn({ replicaId: process.env.RAILWAY_REPLICA_ID }, 'single-instance backend: if more than one replica is running, per-buyer ordering, the lockout and the rate limits are per process — see CLAUDE.md "Inbound message pipeline"');
  }
  const app = await buildServer();

  try {
    await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
    logger.info(`${cfg.PRODUCT_NAME} backend listening on :${cfg.PORT} (${cfg.NODE_ENV})`);
  } catch (err) {
    logger.error(err, 'failed to start');
    process.exit(1);
  }

  // Background jobs run only in production: a local backend shares the live database and WhatsApp
  // token through .env, and must never answer real customers or delete real data.
  if (cfg.NODE_ENV === 'production') {
    startReplaySweeper();
    startRetentionJob();
    startUnpaidExpiryJob(); // P4: bank orders with no screenshot are cancelled after the merchant's hours
    startBillingJob(); // P7: trial notices, monthly invoices, past-due enforcement
  }

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      logger.info(`${sig} received, shutting down`);
      await app.close(); // stop taking webhooks
      await drainWebhooks(25_000); // let queued messages finish; anything cut off is replayed after restart
      await flushPendingDigests().catch(() => {}); // queued alert emails go out now rather than dying with the process
      process.exit(0);
    });
  }
}

void main();
