import type { Request, RequestHandler } from 'express';
import { ApiError } from '../errors';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  now?: () => number;
  keyFor?: (req: Request) => string;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 10000;

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max } = options;
  const now = options.now ?? Date.now;
  const keyFor = options.keyFor ?? ((req: Request) => req.ip ?? 'unknown');
  const windows = new Map<string, WindowEntry>();

  return (req, res, next) => {
    const timestamp = now();
    if (windows.size > MAX_TRACKED_KEYS) {
      for (const [key, entry] of windows) {
        if (entry.resetAt <= timestamp) {
          windows.delete(key);
        }
      }
    }

    const key = keyFor(req);
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= timestamp) {
      entry = { count: 0, resetAt: timestamp + windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader(
      'X-RateLimit-Remaining',
      String(Math.max(0, max - entry.count))
    );
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(
        ApiError.rateLimited(
          `Rate limit exceeded. Try again in ${retryAfter} second(s).`
        )
      );
      return;
    }
    next();
  };
}
