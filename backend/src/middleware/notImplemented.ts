import type { RequestHandler } from 'express';
import { ApiError } from '../errors';

export function notImplemented(feature: string): RequestHandler {
  return (_req, _res, next) => {
    next(
      ApiError.notImplemented(
        `${feature} is not implemented yet. Phase 1 registers the endpoint contract only.`
      )
    );
  };
}
