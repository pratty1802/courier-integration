import { Router } from 'express';
import { bulkCreateSchema } from '../common/types/order';
import { asyncHandler } from '../common/async-handler';
import { bulkRateLimiter } from '../middleware/rate-limit';
import { batchService } from './batch.service';

export const bulkOrdersRouter = Router();
export const batchesRouter = Router();

bulkOrdersRouter.post(
  '/bulk',
  bulkRateLimiter,
  asyncHandler(async (req, res) => {
    const input = bulkCreateSchema.parse(req.body);
    const result = await batchService.createBulk(input.orders, req.requestId);
    res.status(202).json({ data: result });
  }),
);

batchesRouter.get(
  '/:batchId',
  asyncHandler(async (req, res) => {
    const batchId = req.params.batchId;
    if (!batchId) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'batchId required' } });
      return;
    }
    const result = await batchService.getBatch(batchId, req.requestId);
    res.status(200).json({ data: result });
  }),
);
