import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../common/errors/app-error';
import { logger } from '../common/logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? 'unknown';

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
        request_id: requestId,
      },
    });
    return;
  }

  if (isAppError(err)) {
    logger.warn(
      {
        request_id: requestId,
        order_id: (req.params as { orderId?: string }).orderId,
        courier_partner: undefined,
        error_type: err.code,
        api_key_id: req.apiKeyId,
        err,
      },
      err.message,
    );

    if (err.code === 'RATE_LIMITED') {
      res.setHeader('Retry-After', String(Math.ceil(60)));
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId,
      },
    });
    return;
  }

  logger.error(
    {
      request_id: requestId,
      api_key_id: req.apiKeyId,
      err,
    },
    'Unhandled error',
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: [],
      request_id: requestId,
    },
  });
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError({
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
      statusCode: 404,
    }),
  );
}
