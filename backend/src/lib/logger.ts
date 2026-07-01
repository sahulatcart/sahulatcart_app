import pino, { type LoggerOptions } from 'pino';
import { loadConfig } from '../config';

const cfg = loadConfig();

/** Shared pino options — used both by Fastify (request logs) and the standalone logger. */
export const loggerOptions: LoggerOptions = {
  level: cfg.LOG_LEVEL,
  base: { service: 'backend', product: cfg.PRODUCT_NAME },
  // PII redaction (docs/spec/09 §5.1) — extend as fields are added.
  redact: {
    paths: ['req.headers.authorization', 'req.headers["x-hub-signature-256"]', '*.access_token', '*.token'],
    censor: '[redacted]',
  },
};

/** Standalone logger for non-request contexts (startup, workers, jobs). */
export const logger = pino(loggerOptions);
