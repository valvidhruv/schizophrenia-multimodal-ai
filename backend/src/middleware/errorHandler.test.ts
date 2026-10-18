import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { DISCLAIMER } from '../constants';
import { ApiError } from '../errors';
import { errorHandler } from './errorHandler';

interface FakeResponse {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
}

function fakeResponse(headersSent = false): FakeResponse {
  const json = jest.fn();
  const status = jest.fn().mockReturnThis();
  const res = { headersSent, status, json } as unknown as Response;
  return { res, status, json };
}

describe('errorHandler unit behavior', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('maps an unexpected error to a generic 500 body', () => {
    const { res, status, json } = fakeResponse();
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    errorHandler(new Error('db password=hunter2'), {} as Request, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
        disclaimer: DISCLAIMER,
      })
    );
    const body = json.mock.calls[0][0] as Record<string, unknown>;
    const errorBody = body.error as Record<string, unknown>;
    expect(Object.keys(errorBody)).toEqual(['code', 'message']);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('passes an ApiError through unchanged', () => {
    const { res, status, json } = fakeResponse();
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    errorHandler(
      ApiError.invalidInput([{ field: 'age', message: 'must be at most 120' }]),
      {} as Request,
      res,
      next
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input.',
          details: [{ field: 'age', message: 'must be at most 120' }],
        },
        disclaimer: DISCLAIMER,
      })
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('maps a JSON parse failure to 400', () => {
    const { res, status, json } = fakeResponse();
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    errorHandler({ type: 'entity.parse.failed' }, {} as Request, res, next);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('JSON');
  });

  test('maps a body too large error to 413', () => {
    const { res, status, json } = fakeResponse();
    const next = jest.fn() as jest.MockedFunction<NextFunction>;

    errorHandler({ type: 'entity.too.large' }, {} as Request, res, next);

    expect(status).toHaveBeenCalledWith(413);
    const body = json.mock.calls[0][0] as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('delegates to next when headers were already sent', () => {
    const { res, status, json } = fakeResponse(true);
    const next = jest.fn() as jest.MockedFunction<NextFunction>;
    const err = new Error('late failure');

    errorHandler(err, {} as Request, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe('errorHandler integration behavior', () => {
  test('returns a generic 500 without leaking the original error', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const app = express();
      app.get('/boom', () => {
        throw new Error('sql=SELECT * FROM users failed');
      });
      app.use(errorHandler);

      const res = await request(app).get('/boom');

      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
      expect(JSON.stringify(res.body)).not.toContain('SELECT');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.disclaimer).toBe(DISCLAIMER);
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('returns 413 for a body over the default size limit', async () => {
    const app = express();
    app.use(express.json());
    app.post('/echo', (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(errorHandler);

    const payload = JSON.stringify({ pad: 'a'.repeat(120 * 1024) });
    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.disclaimer).toBe(DISCLAIMER);
  });
});
