import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';
import { CircuitBreaker } from '../../common/circuit-breaker';
import { logger } from '../../common/logger';
import type { CourierAdapter } from '../courier.adapter';
import type {
  CancelRef,
  CancelResult,
  CreateShipmentResult,
  NormalizedOrder,
  TrackingRef,
  TrackingResult,
} from '../../common/types/order';
import { assertUrbaneBoltSuccess, getUrbaneBoltErrorMessages } from './urbanebolt.envelope';
import { mapToUrbaneBoltManifest } from './urbanebolt.mapper';
import { parseUrbaneBoltManifestResponse } from './urbanebolt.manifest-response';
import { mapUrbaneBoltStatus } from './urbanebolt.status';

type TokenCache = {
  token: string;
  expiresAt: number;
};

export class UrbaneBoltAdapter implements CourierAdapter {
  readonly partnerId = 'urbanebolt';
  private readonly http: AxiosInstance;
  private tokenCache: TokenCache | null = null;
  private readonly circuit: CircuitBreaker;

  constructor() {
    this.http = axios.create({
      baseURL: env.URBANEBOLT_BASE_URL,
      timeout: env.URBANEBOLT_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
    this.circuit = new CircuitBreaker({
      name: 'urbanebolt',
      failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
      openMs: env.CIRCUIT_OPEN_MS,
    });
  }

  getCircuitStatus() {
    return this.circuit.getStatus();
  }

  async createShipment(order: NormalizedOrder): Promise<CreateShipmentResult> {
    if (!env.URBANEBOLT_USERNAME || !env.URBANEBOLT_PASSWORD || !env.URBANEBOLT_CUSTOMER_CODE) {
      throw new AppError({
        code: 'COURIER_UNAVAILABLE',
        message: 'UrbaneBolt credentials are not configured',
        statusCode: 503,
      });
    }

    return this.circuit.exec(async () => {
      const requestPayload = mapToUrbaneBoltManifest(order, env.URBANEBOLT_CUSTOMER_CODE);
      const responsePayload = await this.withAuthRetry((token) =>
        this.requestWithRetry(() =>
          this.http.post('/api/v1/services/manifest/', [requestPayload], {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      );

      const data = responsePayload.data as unknown;
      const { awb, courierShipmentId } = parseUrbaneBoltManifestResponse(data, order.order_id);

      return {
        courierShipmentId,
        awb,
        status: 'CREATED' as const,
        requestPayload,
        responsePayload: data,
      };
    });
  }

  async trackShipment(ref: TrackingRef): Promise<TrackingResult> {
    return this.circuit.exec(async () => {
      const responsePayload = await this.withAuthRetry((token) =>
        this.requestWithRetry(() =>
          this.http.get('/api/v1/services/tracking-pub/', {
            params: { awb: ref.awb },
            headers: { Authorization: `Bearer ${token}` },
          }),
        ),
      );

      const data = responsePayload.data as unknown;
      assertUrbaneBoltSuccess(data, 'tracking request');
      const status = mapUrbaneBoltStatus(data);
      if (!status) {
        logger.warn({ data, awb: ref.awb }, 'Unrecognized UrbaneBolt tracking status');
        throw new AppError({
          code: 'COURIER_ERROR',
          message: 'Courier returned an unrecognized tracking status',
          statusCode: 502,
        });
      }
      return {
        status,
        events: [
          {
            status,
            rawPayload: data,
            recordedAt: new Date().toISOString(),
          },
        ],
        rawPayload: data,
      };
    });
  }

  async cancelShipment(ref: CancelRef): Promise<CancelResult> {
    return this.circuit.exec(async () => {
      const responsePayload = await this.withAuthRetry((token) =>
        this.requestWithRetry(() =>
          this.http.post(
            '/api/v1/services/cancel/',
            { awbs: ref.awb },
            { headers: { Authorization: `Bearer ${token}` } },
          ),
        ),
      );

      const data = responsePayload.data as unknown;
      assertUrbaneBoltSuccess(data, 'cancellation');

      return {
        status: 'CANCELLED' as const,
        responsePayload: data,
      };
    });
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    try {
      const res = await this.http.post('/api/v1/auth/getToken/', {
        username: env.URBANEBOLT_USERNAME,
        password: env.URBANEBOLT_PASSWORD,
      });

      const authBody = res.data as unknown;
      if (getUrbaneBoltErrorMessages(authBody).length > 0) {
        throw new AppError({
          code: 'COURIER_ERROR',
          message: 'Courier rejected authentication credentials',
          statusCode: 502,
        });
      }

      const token = this.extractToken(authBody);
      if (!token) {
        throw new AppError({
          code: 'COURIER_ERROR',
          message: 'Courier auth response did not include a token',
          statusCode: 502,
        });
      }

      this.tokenCache = {
        token,
        expiresAt: Date.now() + 50 * 60 * 1000,
      };
      return token;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.mapCourierError(error, 'auth');
    }
  }

  private async withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.getToken();
    try {
      return await fn(token);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const fresh = await this.getToken(true);
        return fn(fresh);
      }
      throw error;
    }
  }

  private async requestWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= env.URBANEBOLT_RETRY_COUNT) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status && status >= 400 && status < 500 && status !== 429) {
            this.mapCourierError(error, 'client');
          }
        }

        if (attempt === env.URBANEBOLT_RETRY_COUNT) {
          break;
        }

        const delay = env.URBANEBOLT_RETRY_BASE_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        attempt += 1;
      }
    }

    this.mapCourierError(lastError, 'unavailable');
  }

  private extractToken(data: unknown): string | null {
    if (!data || typeof data !== 'object') return null;
    const record = data as Record<string, unknown>;
    const candidates = [record.token, record.access_token, record.accessToken, record.data];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
      if (c && typeof c === 'object') {
        const nested = c as Record<string, unknown>;
        if (typeof nested.token === 'string') return nested.token;
        if (typeof nested.access_token === 'string') return nested.access_token;
      }
    }
    return null;
  }

  private mapCourierError(error: unknown, kind: 'auth' | 'client' | 'unavailable'): never {
    if (error instanceof AppError) throw error;

    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError;
      logger.error(
        {
          courier_partner: this.partnerId,
          error_type: kind,
          status: ax.response?.status,
          err: ax,
        },
        'UrbaneBolt API error',
      );

      if (kind === 'client' || (ax.response?.status && ax.response.status >= 400 && ax.response.status < 500)) {
        throw new AppError({
          code: 'COURIER_ERROR',
          message: 'Courier rejected the request',
          statusCode: 502,
        });
      }

      if (kind === 'auth') {
        throw new AppError({
          code: 'COURIER_UNAVAILABLE',
          message: 'UrbaneBolt UAT auth is unreachable (partner 5xx/timeout). Try again later or use courier_partner=mock.',
          statusCode: 503,
        });
      }
    }

    throw new AppError({
      code: 'COURIER_UNAVAILABLE',
      message: 'Courier partner is temporarily unavailable',
      statusCode: 503,
    });
  }
}
