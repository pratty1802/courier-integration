import { createHash } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { apiKeys } from '../config/env';
import { AppError } from '../common/errors/app-error';

function extractApiKey(req: Request): string | undefined {
  const headerKey = req.header('x-api-key');
  if (headerKey && headerKey.trim().length > 0) {
    return headerKey.trim();
  }

  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return undefined;
}

function fingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

export function apiKeyAuth(req: Request, _res: Response, next: NextFunction): void {
  const key = extractApiKey(req);
  if (!key || !apiKeys.includes(key)) {
    next(
      new AppError({
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid API key',
        statusCode: 401,
      }),
    );
    return;
  }

  req.apiKeyId = fingerprint(key);
  next();
}
