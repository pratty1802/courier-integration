import { AppError, type FieldError } from '../../common/errors/app-error';
import type { NormalizedOrder } from '../../common/types/order';
import type { DelhiveryCreateRequest, DelhiveryPaymentMode } from './delhivery.types';

/**
 * Unified NormalizedOrder → Delhivery create payload.
 *
 * Field names are intentionally unlike UrbaneBolt:
 *   consignee.name      → shipments[0].name          (UB: consName)
 *   consignee.address*  → shipments[0].add           (UB: consAddress)
 *   consignee.pincode   → shipments[0].pin           (UB: consPincode number)
 *   payment.mode PREPAID→ "Prepaid"                  (UB: "PPD")
 *   parcel.weight_kg    → weight in GRAMS            (UB: kg)
 *   shipper             → seller_* + pickup_location (UB: shpr* on same object)
 *
 * pickup_location.name is a Delhivery warehouse alias (config), not an order field.
 */
export function mapToDelhiveryCreate(
  order: NormalizedOrder,
  pickupLocationName: string,
): DelhiveryCreateRequest {
  const errors: FieldError[] = [];

  if (!pickupLocationName) {
    errors.push({
      field: 'DELHIVERY_PICKUP_LOCATION',
      message: 'Delhivery pickup location name is not configured',
    });
  }

  // Delhivery pin is a string; still require digits (don't coerce garbage).
  if (!/^\d{6}$/.test(order.consignee.pincode.trim())) {
    errors.push({
      field: 'consignee.pincode',
      message: 'Must be a 6-digit pincode for Delhivery',
    });
  }

  if (order.payment.mode === 'COD' && order.payment.collectable_value <= 0) {
    errors.push({
      field: 'payment.collectable_value',
      message: 'Required and must be > 0 when payment.mode is COD',
    });
  }

  // Example of a partner-only field that is NOT on the unified schema today.
  // Until you extend createOrderSchema with optional extras.gstin, this stays unset.
  const extras = (order as NormalizedOrder & { extras?: { gstin?: string; hsn_code?: string } })
    .extras;

  if (errors.length > 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Order is missing or has invalid fields required by delhivery',
      statusCode: 400,
      details: errors,
    });
  }

  const paymentMode: DelhiveryPaymentMode = order.payment.mode === 'COD' ? 'COD' : 'Prepaid';

  return {
    pickup_location: { name: pickupLocationName },
    shipments: [
      {
        name: order.consignee.name,
        add: [order.consignee.address_line1, order.consignee.address_line2]
          .filter(Boolean)
          .join(', '),
        pin: order.consignee.pincode,
        city: order.consignee.city,
        state: order.consignee.state,
        country: order.consignee.country,
        phone: order.consignee.phone,
        email: order.consignee.email,
        order: order.order_id,
        payment_mode: paymentMode,
        cod_amount: paymentMode === 'COD' ? order.payment.collectable_value : 0,
        // Delhivery weight is grams; our unified model is kg.
        weight: Math.round(order.parcel.weight_kg * 1000),
        shipment_length: order.parcel.length_cm,
        shipment_width: order.parcel.breadth_cm,
        shipment_height: order.parcel.height_cm,
        quantity: order.parcel.quantity,
        products_desc: order.parcel.description,
        seller_name: order.shipper.name,
        seller_add: [order.shipper.address_line1, order.shipper.address_line2]
          .filter(Boolean)
          .join(', '),
        seller_inv: order.payment.invoice_number,
        seller_inv_date: order.payment.invoice_date,
        total_amount: order.payment.declared_value,
        gst_tin: extras?.gstin,
        hsn_code: extras?.hsn_code,
        shipping_mode: order.service_type === 'NDD' ? 'Express' : 'Surface',
      },
    ],
  };
}
