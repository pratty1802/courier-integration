import type { ShipmentStatus } from '../../common/types/order';
import type { DelhiveryTrackResponse } from './delhivery.types';

/**
 * Delhivery tracking uses StatusType codes + Status text, not UB's free-text blob.
 *
 *   StatusType  UD = undelivered / in network
 *               DL = delivered
 *               RT = returned / RTO
 *               CN = cancelled
 *
 * Never default to IN_TRANSIT when the payload is empty or an error.
 */
export function mapDelhiveryStatus(payload: DelhiveryTrackResponse): ShipmentStatus | null {
  const shipment = payload.ShipmentData?.[0]?.Shipment;
  if (!shipment) return null;

  const type = (shipment.Status?.StatusType ?? '').toUpperCase();
  const text = (shipment.Status?.Status ?? '').toLowerCase();

  if (type === 'CN' || text.includes('cancel')) return 'CANCELLED';
  if (type === 'RT' || text.includes('rto') || text.includes('return')) return 'CANCELLED';
  if (type === 'DL' || text.includes('deliver')) return 'DELIVERED';
  if (text.includes('undeliver') || text.includes('fail')) return 'FAILED';
  if (text.includes('pick')) return 'PICKED_UP';
  if (type === 'UD' || text.includes('transit') || text.includes('dispatched')) return 'IN_TRANSIT';
  if (text.includes('manifest') || text.includes('booked') || text.includes('uploaded')) {
    return 'CREATED';
  }

  return null;
}
