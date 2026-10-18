import type { Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { signAccessToken } from '../services/tokenService';
import { createAuditMiddleware } from './audit';
import type { AuditRecord } from '../types';

const TEST_SECRET = 'unit-test-secret-value-123456';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const baseEnv = {
  NODE_ENV: 'test',
  JWT_SECRET: TEST_SECRET,
  BACKEND_RATE_LIMIT_WINDOW_MS: '60000',
  BACKEND_RATE_LIMIT_MAX: '1000',
};

function fakeRequest(): Request {
  return {
    method: 'GET',
    originalUrl: '/api/patients?token=SECRET_QUERY',
    url: '/api/patients?token=SECRET_QUERY',
    ip: '10.0.0.7',
    get: jest.fn().mockReturnValue('test-agent'),
  } as unknown as Request;
}

interface FakeResponse {
  res: Response;
  finish: () => Promise<void>;
}

function fakeResponse(statusCode = 200): FakeResponse {
  const listeners: Array<() => void> = [];
  const res = {
    statusCode,
    on: jest.fn((event: string, listener: () => void) => {
      if (event === 'finish') {
        listeners.push(listener);
      }
    }),
  } as unknown as Response;
  return {
    res,
    finish: async () => {
      listeners.forEach((listener) => listener());
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('audit middleware record content', () => {
  test('never records the bearer token or authorization header', async () => {
    const records: AuditRecord[] = [];
    const app = createApp({
      config: loadConfig(baseEnv),
      auditRecorder: (record) => {
        records.push(record);
      },
    });
    const token = signAccessToken({ userId: ADMIN_ID, role: 'admin' }, TEST_SECRET, 900);

    await request(app).get('/api/patients').set('Authorization', `Bearer ${token}`);

    expect(records).toHaveLength(1);
    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain(token);
    expect(serialized.toLowerCase()).not.toContain('bearer');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(records[0].actorUserId).toBe(ADMIN_ID);
    expect(records[0].actorRole).toBe('admin');
  });

  test('strips the query string from the recorded path', async () => {
    const records: AuditRecord[] = [];
    const { res, finish } = fakeResponse(501);
    const middleware = createAuditMiddleware((record) => {
      records.push(record);
    });

    middleware(fakeRequest(), res, jest.fn());
    await finish();

    expect(records).toHaveLength(1);
    expect(records[0].path).toBe('/api/patients');
    expect(records[0].path).not.toContain('SECRET_QUERY');
    expect(records[0].ip).toBe('10.0.0.7');
    expect(records[0].statusCode).toBe(501);
  });
});

describe('audit middleware recorder failures', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('catches a recorder that throws synchronously', async () => {
    const { res, finish } = fakeResponse();
    const middleware = createAuditMiddleware(() => {
      throw new Error('recorder offline');
    });
    const next = jest.fn();

    middleware(fakeRequest(), res, next);
    expect(next).toHaveBeenCalled();

    await finish();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[audit] audit record delivery failed: recorder offline'
    );
  });

  test('a synchronous recorder failure does not raise uncaughtException', async () => {
    const uncaught = jest.fn();
    process.on('uncaughtException', uncaught);
    try {
      const { res, finish } = fakeResponse();
      const middleware = createAuditMiddleware(() => {
        throw new Error('recorder offline');
      });

      middleware(fakeRequest(), res, jest.fn());
      await finish();

      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.removeListener('uncaughtException', uncaught);
    }
  });

  test('catches a recorder that returns a rejected promise', async () => {
    const { res, finish } = fakeResponse();
    const middleware = createAuditMiddleware(() =>
      Promise.reject(new Error('audit store unavailable'))
    );

    middleware(fakeRequest(), res, jest.fn());
    await finish();
    await drainMicrotasks();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[audit] audit record delivery failed: audit store unavailable'
    );
  });

  test('an async recorder failure does not raise unhandledRejection', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { res, finish } = fakeResponse();
      const middleware = createAuditMiddleware(() =>
        Promise.reject(new Error('audit store unavailable'))
      );

      middleware(fakeRequest(), res, jest.fn());
      await finish();
      await drainMicrotasks();

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandled);
    }
  });

  test('accepts a recorder that returns a resolved promise', async () => {
    const recorder = jest.fn(() => Promise.resolve());
    const { res, finish } = fakeResponse();

    createAuditMiddleware(recorder)(fakeRequest(), res, jest.fn());
    await finish();
    await drainMicrotasks();

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
