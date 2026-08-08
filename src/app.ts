import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, corsOrigins } from './config/env';
import { courierRegistry } from './couriers/courier.registry';
import { getUrbaneBoltCircuitStatus } from './couriers/register';
import { requestIdMiddleware } from './middleware/request-id';
import { generalRateLimiter } from './middleware/rate-limit';
import { apiKeyAuth } from './middleware/api-key-auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { ordersRouter } from './orders/orders.routes';
import { batchesRouter, bulkOrdersRouter } from './batches/batches.routes';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(requestIdMiddleware);

  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      bulk_mode: env.BULK_MODE,
      supported_couriers: courierRegistry.supported(),
      circuits: {
        urbanebolt: getUrbaneBoltCircuitStatus(),
      },
    });
  });

  const api = express.Router();
  api.use(generalRateLimiter);
  api.use(apiKeyAuth);
  api.use('/orders', ordersRouter);
  api.use('/orders', bulkOrdersRouter);
  api.use('/batches', batchesRouter);

  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
