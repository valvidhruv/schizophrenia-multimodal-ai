import type { Request } from 'express';
import type { AuditRecord } from '../types';

export type AuditRecorder = (record: AuditRecord) => void;

export const consoleAuditRecorder: AuditRecorder = (record) => {
  console.log(`[audit] ${JSON.stringify(record)}`);
};

export function buildAuditRecord(req: Request, statusCode: number): AuditRecord {
  const rawUrl = req.originalUrl || req.url || '';
  const record: AuditRecord = {
    timestamp: new Date().toISOString(),
    action: req.method,
    path: rawUrl.split('?')[0].slice(0, 300),
    statusCode,
  };
  if (req.auth) {
    record.actorUserId = req.auth.userId;
    record.actorRole = req.auth.role;
  }
  const ip = req.ip;
  if (ip) {
    record.ip = ip;
  }
  const userAgent = req.get('user-agent');
  if (userAgent) {
    record.userAgent = userAgent.slice(0, 200);
  }
  return record;
}
