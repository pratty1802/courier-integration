import { Prisma } from '../generated/prisma';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { AppError } from '../common/errors/app-error';
import { logger } from '../common/logger';
import type { CreateOrderInput } from '../common/types/order';
import { orderService } from '../orders/order.service';
import { enqueueBulkItems } from './queue';

export class BatchService {
  async createBulk(orders: CreateOrderInput[], requestId: string) {
    const batch = await prisma.batch.create({
      data: {
        totalCount: orders.length,
        status: 'PENDING',
        items: {
          create: orders.map((o) => ({
            clientOrderId: o.order_id,
            courierPartner: o.courier_partner.toLowerCase(),
            requestPayload: o as unknown as Prisma.InputJsonValue,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });

    if (env.BULK_MODE === 'worker') {
      await enqueueBulkItems(
        batch.items.map((item) => ({
          batchId: batch.id,
          batchItemId: item.id,
        })),
      );
    } else {
      void this.processEntireBatch(batch.id, requestId).catch((err: unknown) => {
        logger.error(
          { err, request_id: requestId, batch_id: batch.id },
          'In-process bulk run failed',
        );
      });
    }

    logger.info(
      {
        request_id: requestId,
        batch_id: batch.id,
        bulk_mode: env.BULK_MODE,
        count: orders.length,
      },
      'Bulk batch created',
    );

    return {
      batch_id: batch.id,
      status: batch.status,
      total: batch.totalCount,
      bulk_mode: env.BULK_MODE,
    };
  }

  async getBatch(batchId: string, _requestId: string) {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });

    if (!batch) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Batch not found: ${batchId}`,
        statusCode: 404,
      });
    }

    return {
      batch_id: batch.id,
      status: batch.status,
      total: batch.totalCount,
      success_count: batch.successCount,
      failure_count: batch.failureCount,
      bulk_mode: env.BULK_MODE,
      items: batch.items.map((item) => ({
        order_id: item.clientOrderId,
        courier_partner: item.courierPartner,
        status: item.status,
        reason: item.reason,
      })),
    };
  }

  /** Drain all pending items in waves of BULK_CONCURRENCY. Used by poll mode after create. */
  private async processEntireBatch(batchId: string, requestId: string): Promise<void> {
    for (;;) {
      const pending = await prisma.batchItem.count({
        where: { batchId, status: 'PENDING' },
      });
      if (pending === 0) {
        await this.maybeCompleteBatch(batchId);
        return;
      }
      await this.processPendingItems(batchId, requestId);
    }
  }

  async processPendingItems(batchId: string, requestId: string): Promise<void> {
    const claimed = await prisma.$transaction(async (tx) => {
      const pending = await tx.batchItem.findMany({
        where: { batchId, status: 'PENDING' },
        take: env.BULK_CONCURRENCY,
        orderBy: { createdAt: 'asc' },
      });

      if (pending.length === 0) return [];

      await tx.batchItem.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { status: 'PROCESSING' },
      });

      await tx.batch.update({
        where: { id: batchId },
        data: { status: 'PROCESSING' },
      });

      return pending;
    });

    if (claimed.length === 0) {
      await this.maybeCompleteBatch(batchId);
      return;
    }

    await Promise.allSettled(claimed.map((item) => this.processItem(item.id, requestId)));
    await this.maybeCompleteBatch(batchId);
  }

  async processItem(batchItemId: string, requestId: string): Promise<void> {
    const item = await prisma.batchItem.findUnique({ where: { id: batchItemId } });
    if (!item) return;

    const payload = item.requestPayload as unknown as CreateOrderInput;

    try {
      const existing = await prisma.order.findUnique({ where: { orderId: item.clientOrderId } });
      if (existing) {
        await prisma.batchItem.update({
          where: { id: item.id },
          data: {
            status: 'DUPLICATE',
            reason: 'Order already existed (idempotent)',
            orderRefId: existing.id,
          },
        });
        await prisma.batch.update({
          where: { id: item.batchId },
          data: { successCount: { increment: 1 } },
        });
        return;
      }

      const created = await orderService.createOrder(payload, requestId);
      const order = await prisma.order.findUnique({ where: { orderId: created.order_id } });

      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: created.duplicate ? 'DUPLICATE' : 'SUCCESS',
          reason: created.duplicate ? 'Order already existed (idempotent)' : null,
          orderRefId: order?.id,
        },
      });
      await prisma.batch.update({
        where: { id: item.batchId },
        data: { successCount: { increment: 1 } },
      });
    } catch (error) {
      const reason =
        error instanceof AppError
          ? error.details.length > 0
            ? error.details.map((d) => `${d.field}: ${d.message}`).join('; ')
            : error.message
          : 'Failed to create shipment';

      logger.error(
        {
          request_id: requestId,
          order_id: item.clientOrderId,
          courier_partner: item.courierPartner,
          error_type: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          err: error,
        },
        'Bulk item failed',
      );

      await prisma.batchItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          reason,
        },
      });
      await prisma.batch.update({
        where: { id: item.batchId },
        data: { failureCount: { increment: 1 } },
      });
    }
  }

  private async maybeCompleteBatch(batchId: string): Promise<void> {
    const remaining = await prisma.batchItem.count({
      where: {
        batchId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (remaining === 0) {
      await prisma.batch.update({
        where: { id: batchId },
        data: { status: 'COMPLETED' },
      });
    }
  }
}

export const batchService = new BatchService();
