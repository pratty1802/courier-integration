import { AppError } from '../common/errors/app-error';
import type { CourierAdapter } from './courier.adapter';

export class CourierRegistry {
  private readonly adapters = new Map<string, CourierAdapter>();

  register(adapter: CourierAdapter): void {
    this.adapters.set(adapter.partnerId.toLowerCase(), adapter);
  }

  resolve(partnerId: string): CourierAdapter {
    const adapter = this.adapters.get(partnerId.toLowerCase());
    if (!adapter) {
      throw new AppError({
        code: 'UNKNOWN_COURIER',
        message: `Unknown courier_partner "${partnerId}". Supported: ${this.supported().join(', ')}`,
        statusCode: 400,
        details: [
          {
            field: 'courier_partner',
            message: `Must be one of: ${this.supported().join(', ')}`,
          },
        ],
      });
    }
    return adapter;
  }

  supported(): string[] {
    return [...this.adapters.keys()].sort();
  }
}

export const courierRegistry = new CourierRegistry();
