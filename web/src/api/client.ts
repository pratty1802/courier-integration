export type ApiError = {
  code: string;
  message: string;
  details?: { field: string; message: string }[];
  request_id?: string;
};

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

const API_KEY_STORAGE = 'courier_api_key';
const DEFAULT_LOCAL_KEY = 'dev-key-local';

export function getApiKey(): string {
  const existing = localStorage.getItem(API_KEY_STORAGE);
  if (existing && existing.trim().length > 0) {
    return existing.trim();
  }
  // Local default from .env.example — avoids UNAUTHORIZED on first visit
  localStorage.setItem(API_KEY_STORAGE, DEFAULT_LOCAL_KEY);
  return DEFAULT_LOCAL_KEY;
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}


function baseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv.replace(/\/$/, '');
  }
  return '';
}

async function request<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const key = getApiKey();
  if (key) {
    headers.set('X-API-Key', key);
  }

  try {
    const res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
    const json: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      const err =
        json && typeof json === 'object' && 'error' in json
          ? (json as { error: ApiError }).error
          : { code: 'INTERNAL_ERROR', message: `HTTP ${res.status}` };
      return { ok: false, error: err };
    }

    if (json && typeof json === 'object' && 'data' in json) {
      return { ok: true, data: (json as { data: T }).data };
    }

    return { ok: true, data: json as T };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : 'Network error',
      },
    };
  }
}

export type Health = {
  status: string;
  bulk_mode: string;
  supported_couriers: string[];
};

export async function fetchHealth(): Promise<Result<Health>> {
  try {
    const res = await fetch(`${baseUrl()}/health`);
    const data = (await res.json()) as Health;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: e instanceof Error ? e.message : 'Health check failed',
      },
    };
  }
}

export async function createOrder(body: unknown) {
  return request<Record<string, unknown>>('/api/v1/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function trackOrder(orderId: string) {
  return request<Record<string, unknown>>(`/api/v1/orders/${encodeURIComponent(orderId)}/track`);
}

export async function cancelOrder(orderId: string) {
  return request<Record<string, unknown>>(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  });
}

export async function createBulk(orders: unknown[]) {
  return request<{ batch_id: string; status: string; total: number; bulk_mode: string }>(
    '/api/v1/orders/bulk',
    { method: 'POST', body: JSON.stringify({ orders }) },
  );
}

export async function getBatch(batchId: string) {
  return request<{
    batch_id: string;
    status: string;
    total: number;
    success_count: number;
    failure_count: number;
    bulk_mode: string;
    items: { order_id: string; courier_partner: string; status: string; reason: string | null }[];
  }>(`/api/v1/batches/${encodeURIComponent(batchId)}`);
}
