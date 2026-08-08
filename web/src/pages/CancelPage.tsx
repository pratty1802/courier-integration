import { FormEvent, useState } from 'react';
import { cancelOrder } from '../api/client';

export function CancelPage() {
  const [orderId, setOrderId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await cancelOrder(orderId.trim());
    setLoading(false);
    if (!res.ok) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setResult(JSON.stringify(res.data, null, 2));
  }

  return (
    <section className="panel">
      <h1>Cancel order</h1>
      <p className="lead">POST /api/v1/orders/:orderId/cancel</p>
      <form onSubmit={onSubmit} className="grid">
        <label>
          Order ID
          <input value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
        </label>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </form>
      {result ? <div className="banner ok">{result}</div> : null}
      {error ? <div className="banner err">{error}</div> : null}
    </section>
  );
}
