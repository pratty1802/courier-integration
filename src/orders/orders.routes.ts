import { Router } from 'express';
import { createOrderSchema } from '../common/types/order';
import { asyncHandler } from '../common/async-handler';
import { orderService } from './order.service';

export const ordersRouter = Router();

ordersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createOrderSchema.parse(req.body);
    const result = await orderService.createOrder(input, req.requestId);
    res.status(result.duplicate ? 200 : 201).json({ data: result });
  }),
);

ordersRouter.get(
  '/:orderId/track',
  asyncHandler(async (req, res) => {
    const orderId = req.params.orderId;
    if (!orderId) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'orderId required' } });
      return;
    }
    const result = await orderService.trackOrder(orderId, req.requestId);
    res.status(200).json({ data: result });
  }),
);

ordersRouter.post(
  '/:orderId/cancel',
  asyncHandler(async (req, res) => {
    const orderId = req.params.orderId;
    if (!orderId) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'orderId required' } });
      return;
    }
    const result = await orderService.cancelOrder(orderId, req.requestId);
    res.status(200).json({ data: result });
  }),
);
