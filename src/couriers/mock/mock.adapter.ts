import { randomUUID } from 'crypto';
import { AppError } from '../../common/errors/app-error';
import type { CourierAdapter } from '../courier.adapter';
import type {
  CancelRef,
  CancelResult,
  CreateShipmentResult,
  NormalizedOrder,
  ShipmentStatus,
  TrackingRef,
  TrackingResult,
} from '../../common/types/order';

const PROGRESSION: readonly ShipmentStatus[] = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
];

const store = new Map<
  string,
  {
    orderId: string;
    awb: string;
    status: ShipmentStatus;
    createdAt: string;
  }
>();

function nextStatus(current: ShipmentStatus): ShipmentStatus {
  if (current === 'CANCELLED' || current === 'FAILED' || current === 'DELIVERED') {
    return current;
  }
  const idx = PROGRESSION.indexOf(current);
  if (idx < 0 || idx >= PROGRESSION.length - 1) {
    return current;
  }
  return PROGRESSION[idx + 1] ?? current;
}

export class MockCourierAdapter implements CourierAdapter {
  readonly partnerId = 'mock';

  async createShipment(order: NormalizedOrder): Promise<CreateShipmentResult> {
    const awb = `MOCK${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
    const courierShipmentId = `mock-${randomUUID().slice(0, 8)}`;
    const requestPayload = { partner: 'mock', order };
    const responsePayload = { awb, courierShipmentId, status: 'CREATED' };

    store.set(awb, {
      orderId: order.order_id,
      awb,
      status: 'CREATED',
      createdAt: new Date().toISOString(),
    });

    return {
      courierShipmentId,
      awb,
      status: 'CREATED',
      requestPayload,
      responsePayload,
    };
  }

  async trackShipment(ref: TrackingRef): Promise<TrackingResult> {
    const existing = store.get(ref.awb);
    if (!existing) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Mock shipment not found for AWB ${ref.awb}`,
        statusCode: 404,
      });
    }
    const previous = existing.status;
    const status = nextStatus(previous);
    existing.status = status;
    store.set(ref.awb, existing);

    const rawPayload = {
      awb: ref.awb,
      status,
      previous_status: previous,
      mock: true,
      scanned_at: new Date().toISOString(),
    };

    return {
      status,
      events: [
        {
          status,
          rawPayload,
          recordedAt: new Date().toISOString(),
        },
      ],
      rawPayload,
    };
  }

  async cancelShipment(ref: CancelRef): Promise<CancelResult> {
    const existing = store.get(ref.awb);
    if (!existing) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: `Mock shipment not found for AWB ${ref.awb}`,
        statusCode: 404,
      });
    }
    existing.status = 'CANCELLED';
    store.set(ref.awb, existing);

    return {
      status: 'CANCELLED',
      responsePayload: { awb: ref.awb, cancelled: true, mock: true },
    };
  }
}
