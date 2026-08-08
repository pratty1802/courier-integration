export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_COURIER'
  | 'COURIER_ERROR'
  | 'COURIER_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export type FieldError = {
  readonly field: string;
  readonly message: string;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: readonly FieldError[];
  readonly expose: boolean;

  constructor(params: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: readonly FieldError[];
    expose?: boolean;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details ?? [];
    this.expose = params.expose ?? true;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
