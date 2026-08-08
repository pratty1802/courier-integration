import { FormEvent, useEffect, useRef, useState } from 'react';
import { createBulk, getBatch } from '../api/client';

const sample = [
  {
    order_id: `BULK-${Date.now()}-1`,
    courier_partner: 'mock',
    service_type: 'NDD',
    shipper: {
      name: 'Shipper',
      phone: '9876543210',
      address_line1: 'A1',
      city: 'Delhi',
      state: 'DL',
      pincode: '110001',
      country: 'INDIA',
    },
    consignee: {
      name: 'Buyer 1',
      phone: '9123456780',
      address_line1: 'B1',
      city: 'Mumbai',
      state: 'MH',
      pincode: '400001',
      country: 'INDIA',
    },
    parcel: { description: 'Item', quantity: 1, weight_kg: 0.5, pieces: 1 },
    payment: { mode: 'PREPAID', collectable_value: 0, declared_value: 50 },
  },
  {
    order_id: `BULK-${Date.now()}-2`,
    courier_partner: 'delhivery',
    service_type: 'NDD',
    shipper: {
      name: 'Shipper',
      phone: '9876543210',
      address_line1: 'A1',
      city: 'Delhi',
      state: 'DL',
      pincode: '110001',
      country: 'INDIA',
    },
    consignee: {
      name: 'Buyer 2',
      phone: '9123456781',
      address_line1: 'B2',
      city: 'Pune',
      state: 'MH',
      pincode: '411001',
      country: 'INDIA',
    },
    parcel: { description: 'Item', quantity: 1, weight_kg: 0.4, pieces: 1 },
    payment: { mode: 'COD', collectable_value: 100, declared_value: 100 },
  },
];

export function BulkPage() {
  const [json, setJson] = useState(JSON.stringify(sample, null, 2));
  const [batchId, setBatchId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [items, setItems] = useState<
    { order_id: string; courier_partner: string; status: string; reason: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  async function poll(id: string) {
    const res = await getBatch(id);
    if (!res.ok) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setStatus(res.data.status);
    setItems(res.data.items);
    if (res.data.status === 'COMPLETED' && timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setBatchId(null);
    setItems([]);
    try {
      const orders = JSON.parse(json) as unknown[];
      const res = await createBulk(orders);
      setLoading(false);
      if (!res.ok) {
        setError(`${res.error.code}: ${res.error.message}`);
        return;
      }
      setBatchId(res.data.batch_id);
      setStatus(res.data.status);
      if (timer.current) window.clearInterval(timer.current);
      timer.current = window.setInterval(() => {
        void poll(res.data.batch_id);
      }, 1500);
      void poll(res.data.batch_id);
    } catch {
      setLoading(false);
      setError('Invalid JSON array of orders');
    }
  }

  return (
    <section className="panel">
      <h1>Bulk create</h1>
      <p className="lead">POST /api/v1/orders/bulk (max 100), then auto-poll batch status.</p>
      <form onSubmit={onSubmit} className="grid">
        <label>
          Orders JSON
          <textarea value={json} onChange={(e) => setJson(e.target.value)} />
        </label>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit bulk'}
          </button>
        </div>
      </form>
      {batchId ? (
        <p className="meta">
          batch_id={batchId} · status={status}
        </p>
      ) : null}
      {items.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>order_id</th>
              <th>partner</th>
              <th>status</th>
              <th>reason</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.order_id}>
                <td>{item.order_id}</td>
                <td>{item.courier_partner}</td>
                <td>{item.status}</td>
                <td>{item.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {error ? <div className="banner err">{error}</div> : null}
    </section>
  );
}
