import { FormEvent, useState } from 'react';
import { getBatch } from '../api/client';

export function BatchPage() {
  const [batchId, setBatchId] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    const res = await getBatch(batchId.trim());
    setLoading(false);
    if (!res.ok) {
      setError(`${res.error.code}: ${res.error.message}`);
      return;
    }
    setResult(JSON.stringify(res.data, null, 2));
  }

  return (
    <section className="panel">
      <h1>Batch status</h1>
      <p className="lead">GET /api/v1/batches/:batchId</p>
      <form onSubmit={onSubmit} className="grid">
        <label>
          Batch ID
          <input value={batchId} onChange={(e) => setBatchId(e.target.value)} required />
        </label>
        <div className="actions">
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Fetch status'}
          </button>
        </div>
      </form>
      {result ? <div className="banner ok">{result}</div> : null}
      {error ? <div className="banner err">{error}</div> : null}
    </section>
  );
}
