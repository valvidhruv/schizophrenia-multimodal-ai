import type { Request, RequestHandler } from 'express';
import { buildAuditRecord, type AuditRecorder } from '../services/auditService';

function reportAuditFailure(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[audit] audit record delivery failed: ${message}`);
}

function deliverAuditRecord(recorder: AuditRecorder, req: Request, statusCode: number): void {
  try {
    const record = buildAuditRecord(req, statusCode);
    const result: unknown = recorder(record);
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).catch(reportAuditFailure);
    }
  } catch (err) {
    reportAuditFailure(err);
  }
}

export function createAuditMiddleware(recorder: AuditRecorder): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      deliverAuditRecord(recorder, req, res.statusCode);
    });
    next();
  };
}
