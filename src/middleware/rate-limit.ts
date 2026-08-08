import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../common/errors/app-error';

function keyGenerator(req: Request): string {
  const headerKey = req.header('x-api-key')?.trim();
  if (headerKey) {
    return `key:${headerKey}`;
  }
  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return `key:${auth.slice(7).trim()}`;
  }
  if (req.apiKeyId) {
    return `key:${req.apiKeyId}`;
  }
  return `ip:${req.ip ?? 'unknown'}`;
}

function createLimiter(max: number) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    // In-memory is correct for free-tier single instance.
    // Multi-instance production can swap to Redis-backed store later.
    validate: false,
    handler: (_req, _res, next) => {
      next(
        new AppError({
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
          statusCode: 429,
        }),
      );
    },
  });
}

export const generalRateLimiter = createLimiter(env.RATE_LIMIT_MAX);
export const bulkRateLimiter = createLimiter(env.RATE_LIMIT_BULK_MAX);
