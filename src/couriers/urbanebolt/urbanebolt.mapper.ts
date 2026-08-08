import { AppError, type FieldError } from '../../common/errors/app-error';
import type { Address, NormalizedOrder } from '../../common/types/order';

function requirePositive(
  value: number | undefined,
  field: string,
  errors: FieldError[],
): number | undefined {
  if (value === undefined) {
    errors.push({ field, message: 'Required for urbanebolt' });
    return undefined;
  }
  if (!(value > 0)) {
    errors.push({ field, message: 'Must be a positive number' });
    return undefined;
  }
  return value;
}

function requireNonEmpty(
  value: string | undefined,
  field: string,
  errors: FieldError[],
): string | undefined {
  if (!value || !value.trim()) {
    errors.push({ field, message: 'Required for urbanebolt' });
    return undefined;
  }
  return value.trim();
}

/** UrbaneBolt expects numeric phone/pincode — reject non-digit input instead of coercing to 0. */
function requireDigits(
  value: string,
  field: string,
  errors: FieldError[],
): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    errors.push({
      field,
      message: 'Must contain digits only (no dashes or letters) for urbanebolt',
    });
    return undefined;
  }
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) {
    errors.push({ field, message: 'Must be a positive integer for urbanebolt' });
    return undefined;
  }
  return n;
}

function joinAddress(line1: string, line2?: string): string {
  return [line1, line2].filter(Boolean).join(', ');
}

/** UrbaneBolt rejects addresses shorter than 10 characters. */
function requireJoinedAddress(
  address: Address,
  prefix: string,
  errors: FieldError[],
): string | undefined {
  const joined = joinAddress(address.address_line1, address.address_line2);
  if (joined.length < 10) {
    errors.push({
      field: `${prefix}.address_line1`,
      message: 'Address (line1 + line2) must be at least 10 characters for urbanebolt',
    });
    return undefined;
  }
  return joined;
}

function mapPayMode(mode: NormalizedOrder['payment']['mode']): 'COD' | 'PPD' {
  if (mode === 'PREPAID' || mode === 'PPD') return 'PPD';
  return 'COD';
}

function validateAddressDigits(
  address: Address,
  prefix: string,
  errors: FieldError[],
): { phone: number | undefined; pincode: number | undefined } {
  return {
    phone: requireDigits(address.phone, `${prefix}.phone`, errors),
    pincode: requireDigits(address.pincode, `${prefix}.pincode`, errors),
  };
}

/**
 * Maps unified order → UrbaneBolt manifest.
 * Does not invent business values; missing/invalid partner-required fields → VALIDATION_ERROR.
 * Safe transforms only: PREPAID→PPD, optional email→"", return_address defaults to shipper when omitted.
 */
export function mapToUrbaneBoltManifest(order: NormalizedOrder, customerCode: string) {
  const errors: FieldError[] = [];
  const rtn = order.return_address ?? order.shipper;

  const length = requirePositive(order.parcel.length_cm, 'parcel.length_cm', errors);
  const breadth = requirePositive(order.parcel.breadth_cm, 'parcel.breadth_cm', errors);
  const height = requirePositive(order.parcel.height_cm, 'parcel.height_cm', errors);

  const invoiceNumber = requireNonEmpty(
    order.payment.invoice_number,
    'payment.invoice_number',
    errors,
  );
  const invoiceDate = requireNonEmpty(
    order.payment.invoice_date,
    'payment.invoice_date',
    errors,
  );

  let invoiceValue = order.payment.invoice_value;
  if (invoiceValue === undefined) {
    errors.push({ field: 'payment.invoice_value', message: 'Required for urbanebolt' });
  } else if (invoiceValue < 0) {
    errors.push({ field: 'payment.invoice_value', message: 'Must be nonnegative' });
    invoiceValue = undefined;
  }

  const shipperType = requireNonEmpty(
    order.shipper.address_type,
    'shipper.address_type',
    errors,
  );
  const consigneeType = requireNonEmpty(
    order.consignee.address_type,
    'consignee.address_type',
    errors,
  );
  const rtnType = order.return_address
    ? requireNonEmpty(order.return_address.address_type, 'return_address.address_type', errors)
    : shipperType;

  const shipperDigits = validateAddressDigits(order.shipper, 'shipper', errors);
  const consigneeDigits = validateAddressDigits(order.consignee, 'consignee', errors);
  const rtnDigits = order.return_address
    ? validateAddressDigits(order.return_address, 'return_address', errors)
    : shipperDigits;

  const shprAddress = requireJoinedAddress(order.shipper, 'shipper', errors);
  const consAddress = requireJoinedAddress(order.consignee, 'consignee', errors);
  const rtnAddress = order.return_address
    ? requireJoinedAddress(order.return_address, 'return_address', errors)
    : shprAddress;

  if (errors.length > 0) {
    throw new AppError({
      code: 'VALIDATION_ERROR',
      message: 'Order is missing or has invalid fields required by urbanebolt',
      statusCode: 400,
      details: errors,
    });
  }

  return {
    customerCode,
    orderNumber: order.order_id,
    declaredValue: order.payment.declared_value,
    itemDescription: order.parcel.description,
    collectableValue: order.payment.collectable_value,
    height: height!,
    length: length!,
    pieces: order.parcel.pieces,
    weight: order.parcel.weight_kg,
    breadth: breadth!,
    serviceType: order.service_type,
    payMode: mapPayMode(order.payment.mode),
    rtnCity: rtn.city,
    rtnName: rtn.name,
    consCity: order.consignee.city,
    consName: order.consignee.name,
    rtnEmail: rtn.email ?? '',
    rtnState: rtn.state,
    shprCity: order.shipper.city,
    shprName: order.shipper.name,
    consEmail: order.consignee.email ?? '',
    consState: order.consignee.state,
    rtnMobile: rtnDigits.phone!,
    shprEmail: order.shipper.email ?? '',
    shprState: order.shipper.state,
    consMobile: consigneeDigits.phone!,
    rtnAddress: rtnAddress!,
    rtnAddressType: rtnType!,
    rtnCountry: rtn.country,
    rtnPincode: rtnDigits.pincode!,
    shprMobile: shipperDigits.phone!,
    consAddress: consAddress!,
    consAddressType: consigneeType!,
    consCountry: order.consignee.country,
    consPincode: consigneeDigits.pincode!,
    invoiceNumber: invoiceNumber!,
    invoiceDate: invoiceDate!,
    shprAddress: shprAddress!,
    shprAddressType: shipperType!,
    shprCountry: order.shipper.country,
    shprPincode: shipperDigits.pincode!,
    invoiceValue: invoiceValue!,
    itemQuantity: order.parcel.quantity,
  };
}
