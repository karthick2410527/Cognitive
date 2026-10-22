import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ENGINE_VERSION } from '@cognimetric/core';
import { config } from '../config';

type Handler = (req: Request, res: Response) => Promise<unknown>;

export const wrap = (fn: Handler) => async (req: Request, res: Response, nextFn: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) send(res, out);
  } catch (e) {
    nextFn(e);
  }
};

export function send(res: Response, body: unknown, status = 200) {
  const envelope = Array.isArray(body) ? { data: body } : (body as Record<string, unknown>) ?? {};
  res.status(status).json({ ...envelope, engine_version: ENGINE_VERSION, trace_id: res.locals.trace_id });
}

/** Simple fixed-window rate limiter (per key). */
export function rateLimit(limit: number, windowMs: number, keyFn: (req: Request) => string) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, nextFn: NextFunction) => {
    const k = keyFn(req);
    const now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, { n: 1, reset: now + windowMs });
    else if (++h.n > limit) return send(res, { error: 'rate_limited', message: 'too many requests' }, 429);
    nextFn();
  };
}

/** Admin access: a signed-in user with role 'admin' (see scripts/adminGrant.ts), or the ADMIN_TOKEN bearer. */
export function requireAdmin(req: Request, res: Response, nextFn: NextFunction) {
  const user = res.locals.user as { username: string; role: string } | undefined;
  if (user?.role === 'admin') { res.locals.actor = `admin:${user.username}`; return nextFn(); }
  const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(config.ADMIN_TOKEN);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(res, { error: 'unauthorised', message: 'admin token required' }, 401);
  res.locals.actor = 'admin';
  nextFn();
}

