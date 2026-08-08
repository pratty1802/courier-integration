import { FormEvent, useState } from 'react';
import { createOrder } from '../api/client';

const emptyAddress = {
  name: '',
  phone: '',
  email: '',
  address_line1: '',
  city: '',
  state: '',
  pincode: '',
  country: 'INDIA',
  address_type: '',
};

export function CreatePage() {
  const [orderId, setOrderId] = useState(`ORD-${Date.now()}`);
  const [partner, setPartner] = useState('mock');
  const [shipper, setShipper] = useState({
    ...emptyAddress,
    name: 'Shipper Co',
    phone: '9876543210',
    city: 'Delhi',
    state: 'DL',
    pincode: '110001',
    address_line1: 'Warehouse 1',
    address_type: 'Seller',
  });
  const [consignee, setConsignee] = useState({
    ...emptyAddress,
    name: 'Buyer',
    phone: '9123456780',
    city: 'Mumbai',
    state: 'MH',
    pincode: '400001',
    address_line1: 'Home 12, Andheri West',
    address_type: 'Home',
  });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    const body = {
      order_id: orderId,
      courier_partner: partner,
      service_type: 'NDD',
      shipper,
      consignee,
      parcel: {
        description: 'Demo parcel',
        quantity: 1,
        weight_kg: 0.5,
        length_cm: 10,
        breadth_cm: 10,
        height_cm: 10,
        pieces: 1,
      },
      payment: {
        mode: 'PREPAID',
        collectable_value: 0,
        declared_value: 100,
        invoice_number: `INV-${orderId}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        invoice_value: 100,
      },
    };
    const res = await createOrder(body);
    setLoading(false);
    if (!res.ok) {
      const detail =
        res.error.details?.map((d) => `${d.field}: ${d.message}`).join('\n') ?? '';
      setError(
        `${res.error.code}: ${res.error.message}${res.error.request_id ? ` [${res.error.request_id}]` : ''}${detail ? `\n${detail}` : ''}`,
      );
      return;
    }
    setResult(JSON.stringify(res.data, null, 2));
  }

  return (
    <section className="panel">
      <h1>Create order</h1>
      <p className="lead">POST /api/v1/orders with normalized payload.</p>
      <form onSubmit={onSubmit} className="grid">
        <div className="grid two">
          <label>
            Order ID
            <input value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
          </label>
          <label>
            Courier partner
            <select value={partner} onChange={(e) => setPartner(e.target.value)}>
              <option value="mock">mock</option>
              <option value="delhivery">delhivery (mock)</option>
              <option value="urbanebolt">urbanebolt</option>
            </select>
          </label>
        </div>
        <div className="grid two">
          <AddressFields title="Shipper" value={shipper} onChange={setShipper} />
          <AddressFields title="Consignee" value={consignee} onChange={setConsignee} />
        </div>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Creating…' : 'Create shipment'}
          </button>
        </div>
      </form>
      {result ? <div className="banner ok">{result}</div> : null}
      {error ? <div className="banner err">{error}</div> : null}
    </section>
  );
}

function AddressFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: typeof emptyAddress;
  onChange: (v: typeof emptyAddress) => void;
}) {
  return (
    <div className="grid">
      <strong>{title}</strong>
      {(['name', 'phone', 'address_line1', 'city', 'state', 'pincode'] as const).map((field) => (
        <label key={field}>
          {field}
          <input
            value={value[field]}
            onChange={(e) => onChange({ ...value, [field]: e.target.value })}
            required
          />
        </label>
      ))}
    </div>
  );
}
