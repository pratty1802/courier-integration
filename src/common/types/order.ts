import { z } from 'zod';

export const shipmentStatusSchema = z.enum([
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
]);

export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

export const addressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  email: z
    .union([z.string().email(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : v)),
  address_line1: z.string().min(1),
  address_line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.union([z.string(), z.number()]).transform(String),
  country: z.string().default('INDIA'),
  address_type: z.string().optional(),
});

export type Address = z.infer<typeof addressSchema>;

export const parcelSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().int().positive().default(1),
  weight_kg: z.coerce.number().positive(),
  length_cm: z.coerce.number().positive().optional(),
  breadth_cm: z.coerce.number().positive().optional(),
  height_cm: z.coerce.number().positive().optional(),
  pieces: z.coerce.number().int().positive().default(1),
});

export const paymentSchema = z.object({
  mode: z.enum(['COD', 'PREPAID', 'PPD']).default('PREPAID'),
  collectable_value: z.coerce.number().nonnegative().default(0),
  declared_value: z.coerce.number().nonnegative(),
  invoice_number: z.string().optional(),
  invoice_date: z.string().optional(),
  invoice_value: z.coerce.number().nonnegative().optional(),
});

export const createOrderSchema = z.object({
  order_id: z.string().min(1).max(100),
  courier_partner: z.string().min(1),
  service_type: z.string().default('NDD'),
  shipper: addressSchema,
  consignee: addressSchema,
  return_address: addressSchema.optional(),
  parcel: parcelSchema,
  payment: paymentSchema,
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const bulkCreateSchema = z.object({
  orders: z.array(createOrderSchema).min(1).max(100),
});

export type BulkCreateInput = z.infer<typeof bulkCreateSchema>;

export type NormalizedOrder = CreateOrderInput;

export type CreateShipmentResult = {
  readonly courierShipmentId: string;
  readonly awb: string;
  readonly status: ShipmentStatus;
  readonly requestPayload: unknown;
  readonly responsePayload: unknown;
};

export type TrackingRef = {
  readonly awb: string;
  readonly courierShipmentId?: string | null;
  readonly orderId: string;
};

export type TrackingResult = {
  readonly status: ShipmentStatus;
  readonly events: readonly {
    readonly status: ShipmentStatus;
    readonly rawPayload: unknown;
    readonly recordedAt?: string;
  }[];
  readonly rawPayload: unknown;
};

export type CancelRef = {
  readonly awb: string;
  readonly courierShipmentId?: string | null;
  readonly orderId: string;
};

export type CancelResult = {
  readonly status: ShipmentStatus;
  readonly responsePayload: unknown;
};
