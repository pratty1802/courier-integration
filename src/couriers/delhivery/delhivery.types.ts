/**
 * TEMPLATE — Delhivery partner DTOs (illustrative; not wired into the registry).
 *
 * Contrast with UrbaneBolt:
 *   UB create body: flat camelCase (consName, consPincode, payMode, …)
 *   UB create resp: { status, successResponse[], errorResponse[] }
 *
 *   Delhivery create body: nested shipments[] + pickup_location
 *   Delhivery create resp: { success, packages: [{ waybill, status, remarks }] }
 *   Delhivery track resp:  { ShipmentData: [{ Shipment: { Status, Scans } }] }
 */

export type DelhiveryPaymentMode = 'Prepaid' | 'COD';

export type DelhiveryCreateRequest = {
  pickup_location: {
    name: string;
  };
  shipments: Array<{
    name: string;
    add: string;
    pin: string;
    city: string;
    state: string;
    country: string;
    phone: string;
    email?: string;
    order: string;
    payment_mode: DelhiveryPaymentMode;
    cod_amount: number;
    weight: number;
    shipment_length?: number;
    shipment_width?: number;
    shipment_height?: number;
    quantity: number;
    products_desc: string;
    seller_name: string;
    seller_add: string;
    seller_inv?: string;
    seller_inv_date?: string;
    total_amount: number;
    /** Delhivery-only extras — not on UrbaneBolt manifest */
    gst_tin?: string;
    hsn_code?: string;
    shipping_mode?: 'Surface' | 'Express';
  }>;
};

export type DelhiveryCreateResponse = {
  success?: boolean;
  error?: string;
  packages?: Array<{
    status?: string;
    waybill?: string | number;
    refnum?: string;
    remarks?: string;
    sort_code?: string;
  }>;
};

export type DelhiveryScan = {
  ScanDateTime?: string;
  ScanType?: string;
  Scan?: string;
  ScannedLocation?: string;
};

export type DelhiveryTrackResponse = {
  Error?: string;
  ShipmentData?: Array<{
    Shipment?: {
      AWB?: string;
      ReferenceNo?: string;
      Status?: {
        Status?: string;
        StatusType?: string;
        StatusDateTime?: string;
        StatusLocation?: string;
      };
      Scans?: DelhiveryScan[];
    };
  }>;
};

export type DelhiveryCancelResponse = {
  status?: boolean;
  remark?: string;
  error?: string;
};
