import { loadConfig } from './config';
import { logger } from './lib/logger';
import { buildServer } from './server';
import { drainWebhooks, startReplaySweeper } from './whatsapp/webhook';

async function main(): Promise<void> {
  const cfg = loadConfig(); // fail-fast env validation
  const app = await buildServer();

  try {
    await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
    logger.info(`${cfg.PRODUCT_NAME} backend listening on :${cfg.PORT} (${cfg.NODE_ENV})`);
  } catch (err) {
    logger.error(err, 'failed to start');
    process.exit(1);
  }

  // Only production replays stuck messages: a local backend shares the live database and
  // WhatsApp token through .env, and must never answer real customers.
  if (cfg.NODE_ENV === 'production') startReplaySweeper();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, async () => {
      logger.info(`${sig} received, shutting down`);
      await app.close(); // stop taking webhooks
      await drainWebhooks(25_000); // let queued messages finish; anything cut off is replayed after restart
      process.exit(0);
    });
  }
}

void main();
