import type { RequestHandler } from 'express';
import type { ZodError, ZodType } from 'zod';
import { ApiError } from '../errors';
import type { ErrorDetail } from '../types';

export interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

function toDetails(error: ZodError, prefix: string | null): ErrorDetail[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    if (path.length > 0) {
      return { field: prefix ? `${prefix}.${path}` : path, message: issue.message };
    }
    return { field: prefix ?? '(root)', message: issue.message };
  });
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: ErrorDetail[] = [];
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body ?? {});
      if (result.success) {
        req.body = result.data;
      } else {
        details.push(...toDetails(result.error, null));
      }
    }
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        details.push(...toDetails(result.error, 'params'));
      }
    }
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        details.push(...toDetails(result.error, 'query'));
      }
    }
    if (details.length > 0) {
      next(ApiError.invalidInput(details));
      return;
    }
    next();
  };
}
