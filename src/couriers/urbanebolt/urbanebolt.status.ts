import type { ShipmentStatus } from '../../common/types/order';

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value.toLowerCase());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
}

/** Returns null when the payload has no recognizable shipment status (do not invent one). */
export function mapUrbaneBoltStatus(payload: unknown): ShipmentStatus | null {
  const texts: string[] = [];
  collectStrings(payload, texts);
  const joined = texts.join(' ');
  if (!joined.trim()) return null;

  if (/(cancel|rto)/.test(joined)) return 'CANCELLED';
  if (/(deliver|delivered|pod)/.test(joined)) return 'DELIVERED';
  if (/(undeliver)/.test(joined)) return 'FAILED';
  if (/(transit|ofo|out for delivery|hub)/.test(joined)) return 'IN_TRANSIT';
  if (/(pick|picked|pickup)/.test(joined)) return 'PICKED_UP';
  if (/(creat|book|manifest)/.test(joined)) return 'CREATED';

  return null;
}
