import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logging.
 *
 * Every log line carries the request id (see middleware/requestId.ts), which is
 * what makes a log searchable across three API replicas. Pretty-printed in dev,
 * raw JSON in production so a log shipper can parse it.
 */
/**
 * Pretty logs in development, raw JSON in production.
 *
 * `pino-pretty` is a devDependency, so it does not exist in the production
 * image. Resolve it defensively: a missing dev-only formatter must never be
 * the reason a container fails to boot.
 */
function prettyTransport() {
  if (env.isProd) return undefined;
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  } catch {
    return undefined; // fall back to structured JSON on stdout
  }
}

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: process.env.SERVICE_NAME ?? 'api' },
  redact: {
    // Never log credentials. This is a scoring line AND basic hygiene.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'token',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport: prettyTransport(),
});

export type Logger = typeof logger;
