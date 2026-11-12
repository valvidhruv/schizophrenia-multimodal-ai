import type { ErrorDetail } from './types';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'AUTH_NOT_CONFIGURED'
  | 'AUTH_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static invalidInput(details: ErrorDetail[], message = 'Invalid input.'): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static unauthorized(message = 'Authentication is required.'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message = 'Your role does not permit this operation.'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }

  static notFound(message = 'The requested endpoint does not exist.'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  static conflict(message = 'The resource already exists.'): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }

  static rateLimited(message: string): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static authUnavailable(): ApiError {
    return new ApiError(
      503,
      'AUTH_UNAVAILABLE',
      'Authentication is temporarily unavailable.'
    );
  }

  static notImplemented(message: string): ApiError {
    return new ApiError(501, 'NOT_IMPLEMENTED', message);
  }
}
