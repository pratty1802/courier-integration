import { FormEvent, useEffect, useState } from 'react';
import { fetchHealth, getApiKey, setApiKey, type Health } from '../api/client';

export function SettingsPage() {
  const [key, setKey] = useState(getApiKey());
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchHealth().then((res) => {
      if (res.ok) setHealth(res.data);
    });
  }, []);

  function onSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) {
      setError('API key is required. Use dev-key-local for local development.');
      setMessage(null);
      return;
    }
    setApiKey(trimmed);
    setMessage(`API key saved. Requests will send X-API-Key: ${trimmed}`);
    setError(null);
  }

  return (
    <section className="panel">
      <h1>Settings</h1>
      <p className="lead">
        Store your API key locally. All /api/v1 calls send <code>X-API-Key</code>. Local default:{' '}
        <code>dev-key-local</code>
      </p>
      <form onSubmit={onSave} className="grid">
        <label>
          API key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="dev-key-local"
            autoComplete="off"
          />
        </label>
        <div className="actions">
          <button type="submit">Save key</button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setKey('dev-key-local');
              setApiKey('dev-key-local');
              setMessage('Reset to dev-key-local');
              setError(null);
            }}
          >
            Use local default
          </button>
        </div>
      </form>
      {message ? <div className="banner ok">{message}</div> : null}
      {error ? <div className="banner err">{error}</div> : null}
      {health ? (
        <p className="meta">
          API health: {health.status} · bulk_mode={health.bulk_mode} · couriers=
          {health.supported_couriers.join(', ')}
        </p>
      ) : (
        <p className="meta">Could not reach /health yet (start API or check VITE_API_BASE_URL).</p>
      )}
    </section>
  );
}
