import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../errors';
import { DISCLAIMER } from '../constants';

export const apiNotFoundHandler: RequestHandler = (_req, _res, next) => {
  next(ApiError.notFound());
};

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const apiError = err instanceof ApiError ? err : toApiError(err);
  if (apiError.code === 'INTERNAL_ERROR') {
    console.error('Server error:', err);
  }
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details && apiError.details.length > 0
        ? { details: apiError.details }
        : {}),
    },
    timestamp: new Date().toISOString(),
    disclaimer: DISCLAIMER,
  });
}

function toApiError(err: unknown): ApiError {
  const candidate = err as { type?: string } | null;
  if (candidate?.type === 'entity.parse.failed') {
    return ApiError.invalidInput([], 'Request body is not valid JSON.');
  }
  if (candidate?.type === 'entity.too.large') {
    return new ApiError(
      413,
      'PAYLOAD_TOO_LARGE',
      'Request body exceeds the configured size limit.'
    );
  }
  return new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
}
