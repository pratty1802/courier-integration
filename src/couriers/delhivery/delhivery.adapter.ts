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
import { mapToDelhiveryCreate } from './delhivery.mapper';
import { mapDelhiveryStatus } from './delhivery.status';
import type {
  DelhiveryCancelResponse,
  DelhiveryCreateResponse,
  DelhiveryTrackResponse,
} from './delhivery.types';

const MOCK_PICKUP_LOCATION = 'DEL-WH-MOCK';

const PROGRESSION: readonly ShipmentStatus[] = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
];

type StoredShipment = {
  orderId: string;
  waybill: string;
  sortCode: string;
  status: ShipmentStatus;
};

const store = new Map<string, StoredShipment>();

function nextStatus(current: ShipmentStatus): ShipmentStatus {
  if (current === 'CANCELLED' || current === 'FAILED' || current === 'DELIVERED') {
    return current;
  }
  const idx = PROGRESSION.indexOf(current);
  if (idx < 0 || idx >= PROGRESSION.length - 1) return current;
  return PROGRESSION[idx + 1] ?? current;
}

/** Build a Delhivery-shaped track body so mapDelhiveryStatus is exercised. */
function toDelhiveryTrackPayload(
  shipment: StoredShipment,
  scanText: string,
): DelhiveryTrackResponse {
  const typeByStatus: Record<ShipmentStatus, string> = {
    CREATED: '',
    PICKED_UP: 'UD',
    IN_TRANSIT: 'UD',
    DELIVERED: 'DL',
    CANCELLED: 'CN',
    FAILED: 'UD',
  };
  const textByStatus: Record<ShipmentStatus, string> = {
    CREATED: 'Manifested',
    PICKED_UP: 'Picked Up',
    IN_TRANSIT: 'In Transit',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
    FAILED: 'Undelivered',
  };

  return {
    ShipmentData: [
      {
        Shipment: {
          AWB: shipment.waybill,
          ReferenceNo: shipment.orderId,
          Status: {
            StatusType: typeByStatus[shipment.status],
            Status: textByStatus[shipment.status],
            StatusDateTime: new Date().toISOString(),
            StatusLocation: 'Mumbai Hub',
          },
          Scans: [
            {
              ScanDateTime: new Date().toISOString(),
              ScanType: typeByStatus[shipment.status] || 'UD',
              Scan: scanText,
              ScannedLocation: 'Mumbai Hub',
            },
          ],
        },
      },
    ],
  };
}

function parseCreateResponse(data: DelhiveryCreateResponse, orderId: string) {
  const pkg = data.packages?.[0];
  if (data.success === false || (pkg && pkg.status && pkg.status.toLowerCase() !== 'success')) {
    throw new AppError({
      code: 'COURIER_ERROR',
      message: 'Courier rejected the shipment',
      statusCode: 502,
    });
  }

  const waybill = pkg?.waybill != null ? String(pkg.waybill) : '';
  if (!waybill) {
    throw new AppError({
      code: 'COURIER_ERROR',
      message: 'Courier did not return a valid AWB for the shipment',
      statusCode: 502,
    });
  }

  return {
    awb: waybill,
    courierShipmentId: pkg?.sort_code ? String(pkg.sort_code) : waybill,
    orderId: pkg?.refnum || orderId,
  };
}

/**
 * In-memory Delhivery mock: same partner field names / response envelopes as real DL,
 * no HTTP. Swap this class for a live adapter later without touching order.service.
 */
export class DelhiveryAdapter implements CourierAdapter {
  readonly partnerId = 'delhivery';

  async createShipment(order: NormalizedOrder): Promise<CreateShipmentResult> {
    const requestPayload = mapToDelhiveryCreate(order, MOCK_PICKUP_LOCATION);

    const waybill = `${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`;
    const sortCode = `MH/${randomUUID().slice(0, 4).toUpperCase()}`;

    const responsePayload: DelhiveryCreateResponse = {
      success: true,
      packages: [
        {
          status: 'Success',
          waybill,
          refnum: order.order_id,
          sort_code: sortCode,
          remarks: '',
        },
      ],
    };

    const parsed = parseCreateResponse(responsePayload, order.order_id);
    store.set(parsed.awb, {
      orderId: order.order_id,
      waybill: parsed.awb,
      sortCode: parsed.courierShipmentId,
      status: 'CREATED',
    });

    return {
      courierShipmentId: parsed.courierShipmentId,
      awb: parsed.awb,
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
        message: 'Courier has no tracking data for this AWB',
        statusCode: 404,
      });
    }

    existing.status = nextStatus(existing.status);
    store.set(ref.awb, existing);

    const data = toDelhiveryTrackPayload(existing, existing.status);
    const status = mapDelhiveryStatus(data);
    if (!status) {
      throw new AppError({
        code: 'COURIER_ERROR',
        message: 'Courier returned an unrecognized tracking status',
        statusCode: 502,
      });
    }

    return {
      status,
      events: (data.ShipmentData?.[0]?.Shipment?.Scans ?? []).map((scan) => ({
        status,
        rawPayload: scan,
        recordedAt: scan.ScanDateTime,
      })),
      rawPayload: data,
    };
  }

  async cancelShipment(ref: CancelRef): Promise<CancelResult> {
    const existing = store.get(ref.awb);
    if (!existing) {
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'Courier has no shipment for this AWB',
        statusCode: 404,
      });
    }

    existing.status = 'CANCELLED';
    store.set(ref.awb, existing);

    const responsePayload: DelhiveryCancelResponse = {
      status: true,
      remark: 'Cancellation requested',
    };

    return {
      status: 'CANCELLED',
      responsePayload,
    };
  }
}
