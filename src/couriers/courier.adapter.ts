import type {
  CancelRef,
  CancelResult,
  CreateShipmentResult,
  NormalizedOrder,
  TrackingRef,
  TrackingResult,
} from '../common/types/order';

export interface CourierAdapter {
  readonly partnerId: string;
  createShipment(order: NormalizedOrder): Promise<CreateShipmentResult>;
  trackShipment(ref: TrackingRef): Promise<TrackingResult>;
  cancelShipment(ref: CancelRef): Promise<CancelResult>;
}
