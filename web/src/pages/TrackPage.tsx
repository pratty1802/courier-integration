import { FormEvent, useState } from 'react';
import { trackOrder } from '../api/client';

export function TrackPage() {
  const [orderId, setOrderId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await trackOrder(orderId.trim());
    setLoading(false);
    if (!res.ok) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setResult(JSON.stringify(res.data, null, 2));
  }

  return (
    <section className="panel">
      <h1>Track order</h1>
      <p className="lead">GET /api/v1/orders/:orderId/track</p>
      <form onSubmit={onSubmit} className="grid">
        <label>
          Order ID
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
        </label>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Tracking…' : 'Track'}
          </button>
        </div>
      </form>
      {result ? <div className="banner ok">{result}</div> : null}
      {error ? <div className="banner err">{error}</div> : null}
    </section>
  );
}
