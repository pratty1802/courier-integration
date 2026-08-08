import { AppError } from '../../common/errors/app-error';

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function collectObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectObjects);
  }
  const rec = asRecord(value);
  return rec ? [rec] : [];
}

/** UrbaneBolt often returns HTTP 200 with errors in the body. */
export function getUrbaneBoltErrorMessages(data: unknown): string[] {
  const root = asRecord(data);
  if (!root) return [];

  const messages: string[] = [];
  const buckets = [root.errorResponse, root.errors, root.error];
  for (const bucket of buckets) {
    for (const item of collectObjects(bucket)) {
      if (typeof item.message === 'string' && item.message.trim()) {
        messages.push(item.message.trim());
      }
    }
    if (typeof bucket === 'string' && bucket.trim()) messages.push(bucket.trim());
  }

  if (typeof root.message === 'string' && root.message.trim()) {
    const status = typeof root.status === 'string' ? root.status.toLowerCase() : '';
    if (status.includes('fail') || status.includes('error') || root.success === false) {
      messages.push(root.message.trim());
    }
  } else if (typeof root.status === 'string' && /^(fail|error)/i.test(root.status)) {
    messages.push('Request failed');
  } else if (root.success === false && messages.length === 0) {
    messages.push('Request failed');
  }

  return [...new Set(messages)];
}

export function assertUrbaneBoltSuccess(data: unknown, operation: string): void {
  const messages = getUrbaneBoltErrorMessages(data);
  if (messages.length === 0) return;

  throw new AppError({
    code: 'COURIER_ERROR',
    message: `Courier rejected the ${operation}`,
    statusCode: 502,
  });
}
