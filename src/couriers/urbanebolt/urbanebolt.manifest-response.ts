import { AppError, type FieldError } from '../../common/errors/app-error';
import { logger } from '../../common/logger';
import { collectObjects, getUrbaneBoltErrorMessages } from './urbanebolt.envelope';

function asId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value);
  return null;
}

function extractAwb(record: Record<string, unknown>): string | null {
  return (
    asId(record.awb) ??
    asId(record.AWB) ??
    asId(record.awbNumber) ??
    asId(record.awb_number) ??
    asId(record.awbNo) ??
    asId(record.tracking_number) ??
    asId(record.waybill)
  );
}

function extractShipmentId(record: Record<string, unknown>, fallback: string): string {
  return (
    asId(record.shipment_id) ??
    asId(record.shipmentId) ??
    asId(record.order_id) ??
    asId(record.orderId) ??
    asId(record.orderNumber) ??
    fallback
  );
}

function mapPartnerFieldError(message: string): FieldError | null {
  const lower = message.toLowerCase();
  if (lower.includes('consaddress')) {
    return {
      field: 'consignee.address_line1',
      message: 'Must be at least 10 characters (address_line1 + address_line2)',
    };
  }
  if (lower.includes('shpraddress')) {
    return {
      field: 'shipper.address_line1',
      message: 'Must be at least 10 characters (address_line1 + address_line2)',
    };
  }
  if (lower.includes('rtnaddress')) {
    return {
      field: 'return_address.address_line1',
      message: 'Must be at least 10 characters (address_line1 + address_line2)',
    };
  }
  if (lower.includes('pincode') && lower.includes('serviceable')) {
    const field = lower.includes('consignee') || lower.includes('cons')
      ? 'consignee.pincode'
      : lower.includes('shipper') || lower.includes('shpr')
        ? 'shipper.pincode'
        : 'consignee.pincode';
    return {
      field,
      message: 'Pincode is not serviceable for urbanebolt',
    };
  }
  return null;
}

function findAwbInTree(
  value: unknown,
  orderId: string,
): { awb: string; courierShipmentId: string } | null {
  for (const rec of collectObjects(value)) {
    const awb = extractAwb(rec);
    if (awb) return { awb, courierShipmentId: extractShipmentId(rec, orderId) };

    for (const key of ['successResponse', 'data', 'result', 'payload']) {
      const nested = rec[key];
      if (nested === undefined) continue;
      const found = findAwbInTree(nested, orderId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Parse UrbaneBolt manifest HTTP 200 body.
 * Partner often returns 200 with errorResponse[] instead of HTTP 4xx.
 */
export function parseUrbaneBoltManifestResponse(
  data: unknown,
  orderId: string,
): { awb: string; courierShipmentId: string } {
  const messages = getUrbaneBoltErrorMessages(data);

  if (messages.length > 0) {
    logger.warn({ order_id: orderId, partner_errors: messages, data }, 'UrbaneBolt manifest rejected');

    const mapped = messages
      .map(mapPartnerFieldError)
      .filter((d): d is FieldError => d !== null);
    const details: FieldError[] =
      mapped.length > 0
        ? mapped
        : messages.map((message) => ({ field: 'courier', message }));

    throw new AppError({
      code: mapped.length > 0 ? 'VALIDATION_ERROR' : 'COURIER_ERROR',
      message:
        mapped.length > 0
          ? 'Order was rejected by urbanebolt due to invalid fields'
          : messages[0] ?? 'Courier rejected the shipment',
      statusCode: mapped.length > 0 ? 400 : 502,
      details,
    });
  }

  const found = findAwbInTree(data, orderId);
  if (found) return found;

  throw new AppError({
    code: 'COURIER_ERROR',
    message: 'Courier did not return a valid AWB for the shipment',
    statusCode: 502,
  });
}
