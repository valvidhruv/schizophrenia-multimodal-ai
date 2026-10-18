import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../errors';
import { rateLimit } from '../middleware/rateLimit';

function fakeRequest(ip: string): Request {
  return { ip } as unknown as Request;
}

function makeResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as unknown as Response;
  return { res, headers };
}

describe('rateLimit middleware', () => {
  test('allows up to the maximum, then rejects with 429', () => {
    const clock = 1000000;
    const middleware = rateLimit({ windowMs: 1000, max: 2, now: () => clock });
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const { res, headers } = makeResponse();

    middleware(fakeRequest('10.0.0.1'), res, next);
    expect(next).toHaveBeenCalledWith();

    middleware(fakeRequest('10.0.0.1'), res, next);
    expect(next).toHaveBeenCalledWith();
    expect(headers['X-RateLimit-Limit']).toBe('2');
    expect(headers['X-RateLimit-Remaining']).toBe('0');

    middleware(fakeRequest('10.0.0.1'), res, next);
    const err = next.mock.calls[2][0] as ApiError;
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(headers['Retry-After']).toBe('1');
  });

  test('starts a fresh window after windowMs elapses', () => {
    let clock = 1000000;
    const middleware = rateLimit({ windowMs: 1000, max: 1, now: () => clock });
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const { res, headers } = makeResponse();

    middleware(fakeRequest('10.0.0.5'), res, next);
    middleware(fakeRequest('10.0.0.5'), res, next);
    expect((next.mock.calls[1][0] as ApiError).status).toBe(429);

    clock += 1001;
    middleware(fakeRequest('10.0.0.5'), res, next);
    expect(next).toHaveBeenLastCalledWith();
    expect(headers['X-RateLimit-Remaining']).toBe('0');
  });

  test('tracks keys independently', () => {
    const middleware = rateLimit({ windowMs: 60000, max: 1 });
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const { res } = makeResponse();

    middleware(fakeRequest('10.0.0.9'), res, next);
    middleware(fakeRequest('10.0.0.9'), res, next);
    expect((next.mock.calls[1][0] as ApiError).status).toBe(429);

    middleware(fakeRequest('10.0.0.10'), res, next);
    expect(next).toHaveBeenLastCalledWith();
  });
});
