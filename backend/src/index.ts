import { loadConfig } from './config';
import { logger } from './lib/logger';
import { buildServer } from './server';

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

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      logger.info(`${sig} received, shutting down`);
      app.close().then(() => process.exit(0));
    });
  }
}

void main();
