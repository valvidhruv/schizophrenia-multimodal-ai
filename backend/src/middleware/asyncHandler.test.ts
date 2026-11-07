import type { NextFunction, Request, Response } from 'express';
import { asyncHandler } from './asyncHandler';

const req = {} as Request;
const res = {} as Response;

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('asyncHandler', () => {
  test('forwards a rejected promise to next', async () => {
    const failure = new Error('boom');
    const handler = asyncHandler(async () => {
      throw failure;
    });
    const next = jest.fn();

    handler(req, res, next as NextFunction);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(failure);
  });

  test('forwards a synchronous throw to next', async () => {
    const failure = new Error('sync boom');
    const handler = asyncHandler(() => {
      throw failure;
    });
    const next = jest.fn();

    handler(req, res, next as NextFunction);
    await flush();

    expect(next).toHaveBeenCalledWith(failure);
  });

  test('does not call next when the handler succeeds', async () => {
    const handler = asyncHandler(async () => undefined);
    const next = jest.fn();

    handler(req, res, next as NextFunction);
    await flush();

    expect(next).not.toHaveBeenCalled();
  });
});
