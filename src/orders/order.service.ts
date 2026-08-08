import type { Order, ShipmentStatus as PrismaShipmentStatus } from '../generated/prisma';
import { Prisma } from '../generated/prisma';
import { prisma } from '../db/prisma';
import { courierRegistry } from '../couriers/courier.registry';
import { AppError } from '../common/errors/app-error';
import { logger } from '../common/logger';
import type { CreateOrderInput, ShipmentStatus } from '../common/types/order';

function toDomainStatus(status: PrismaShipmentStatus): ShipmentStatus {
  return status;
}

export type OrderResponse = {
  order_id: string;
  courier_partner: string;
  courier_shipment_id: string | null;
  awb: string | null;
  status: ShipmentStatus;
  created_at: string;
  updated_at: string;
  duplicate?: boolean;
};

function mapOrder(order: Order, duplicate = false): OrderResponse {
  return {
    order_id: order.orderId,
    courier_partner: order.courierPartner,
    courier_shipment_id: order.courierShipmentId,
    awb: order.awb,
    status: toDomainStatus(order.status),
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
    ...(duplicate ? { duplicate: true } : {}),
  };
}

export class OrderService {
  async createOrder(input: CreateOrderInput, requestId: string): Promise<OrderResponse> {
    const existing = await prisma.order.findUnique({ where: { orderId: input.order_id } });
    if (existing) {
      logger.info(
        {
          request_id: requestId,
          order_id: input.order_id,
          courier_partner: existing.courierPartner,
        },
        'Idempotent create — returning existing order',
      );
      return mapOrder(existing, true);
    }

    const adapter = courierRegistry.resolve(input.courier_partner);

    try {
      const result = await adapter.createShipment(input);

      const order = await prisma.order.create({
        data: {
          orderId: input.order_id,
          courierPartner: adapter.partnerId,
          courierShipmentId: result.courierShipmentId,
          awb: result.awb,
          status: result.status,
          requestPayload: result.requestPayload as Prisma.InputJsonValue,
          responsePayload: result.responsePayload as Prisma.InputJsonValue,
          trackingEvents: {
            create: {
              status: result.status,
              rawPayload: result.responsePayload as Prisma.InputJsonValue,
            },
          },
        },
      });

      return mapOrder(order);
    } catch (error) {
      logger.error(
        {
          request_id: requestId,
          order_id: input.order_id,
          courier_partner: input.courier_partner,
          error_type: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          err: error,
        },
        'Create order failed',
      );

      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await prisma.order.findUnique({ where: { orderId: input.order_id } });
        if (again) return mapOrder(again, true);
      }

      throw error;
    }
  }

  async trackOrder(orderId: string, requestId: string) {
    const order = await prisma.order.findUnique({
      where: { orderId },
      include: { trackingEvents: { orderBy: { recordedAt: 'asc' } } },
    });

    if (!order) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Order not found: ${orderId}`,
        statusCode: 404,
      });
    }

    if (!order.awb) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Order has no AWB to track; shipment was never successfully created',
        statusCode: 409,
      });
    }

    const adapter = courierRegistry.resolve(order.courierPartner);
    const tracking = await adapter.trackShipment({
      awb: order.awb,
      courierShipmentId: order.courierShipmentId,
      orderId: order.orderId,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const statusChanged = order.status !== tracking.status;

      const o = statusChanged
        ? await tx.order.update({
            where: { id: order.id },
            data: { status: tracking.status },
          })
        : order;

      if (statusChanged) {
        await tx.trackingEvent.create({
          data: {
            orderId: order.id,
            status: tracking.status,
            rawPayload: tracking.rawPayload as Prisma.InputJsonValue,
          },
        });
      }

      const events = await tx.trackingEvent.findMany({
        where: { orderId: order.id },
        orderBy: { recordedAt: 'asc' },
      });

      return { order: o, events };
    });

    logger.info(
      {
        request_id: requestId,
        order_id: orderId,
        courier_partner: order.courierPartner,
      },
      'Tracked order',
    );

    return {
      order_id: updated.order.orderId,
      courier_partner: updated.order.courierPartner,
      awb: updated.order.awb,
      status: toDomainStatus(updated.order.status),
      history: updated.events.map((e) => ({
        status: toDomainStatus(e.status),
        recorded_at: e.recordedAt.toISOString(),
      })),
    };
  }

  async cancelOrder(orderId: string, requestId: string) {
    const order = await prisma.order.findUnique({ where: { orderId } });
    if (!order) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Order not found: ${orderId}`,
        statusCode: 404,
      });
    }

    if (!order.awb) {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: 'Order has no AWB to cancel; shipment was never successfully created',
        statusCode: 409,
      });
    }

    if (order.status === 'CANCELLED') {
      return mapOrder(order);
    }

    const adapter = courierRegistry.resolve(order.courierPartner);
    const result = await adapter.cancelShipment({
      awb: order.awb,
      courierShipmentId: order.courierShipmentId,
      orderId: order.orderId,
    });

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: result.status,
        responsePayload: result.responsePayload as Prisma.InputJsonValue,
        trackingEvents: {
          create: {
            status: result.status,
            rawPayload: result.responsePayload as Prisma.InputJsonValue,
          },
        },
      },
    });

    logger.info(
      {
        request_id: requestId,
        order_id: orderId,
        courier_partner: order.courierPartner,
      },
      'Cancelled order',
    );

    return mapOrder(updated);
  }
}

export const orderService = new OrderService();
