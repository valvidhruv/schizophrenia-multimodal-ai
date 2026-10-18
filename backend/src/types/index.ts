export type Role = 'admin' | 'clinician' | 'researcher';

export interface AuthPrincipal {
  userId: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface AuditRecord {
  timestamp: string;
  action: string;
  path: string;
  statusCode: number;
  actorUserId?: string;
  actorRole?: Role;
  ip?: string;
  userAgent?: string;
}

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  timestamp: string;
  disclaimer: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPrincipal;
  }
}
