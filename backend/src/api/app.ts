// HTTP API, versioned under /v2 (Doc 01 §8). Every response carries engine_version and trace_id.
// Request logs carry method, path, status and latency only — never payload bodies (Doc 01 §9).
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ENGINE_VERSION, FIRST_LANGUAGES, LOCALES } from '@cognimetric/core';
import { config } from '../config';
import { audit, pool, q, q1 } from '../db/pool';
import { BATTERIES } from '../engine/battery';
import { getProvider, providerDegraded } from '../llm';
import { registry } from '../plugins/registry';
import { buildReport } from '../report/report';
import { completeBlock, createSession, createSubject, dueProbes, next, respond, respondProbe, sessionState, submitProbeAnswers } from '../session/runtime';
import { HttpError, log, traceId } from '../util';
import { adminRouter } from './admin';
import { authRouter, meRouter } from './user';
import { assertOwnsProbe, assertOwnsSession, attachUser, jsonOnlyWrites, requireUser } from '../auth/service';
import { rateLimit, requireAdmin, send, wrap } from './http';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, nextFn) => {
    res.locals.trace_id = traceId();
    res.setHeader('x-trace-id', res.locals.trace_id);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cache-control', 'no-store');
    const t0 = Date.now();
    res.on('finish', () => { if (!req.path.endsWith('/health')) log('http', `${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`, { trace_id: res.locals.trace_id }); });
    nextFn();
  });
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(jsonOnlyWrites);
  app.use(express.json({ limit: '2mb' }));
  app.use(attachUser);
  app.use('/v2', rateLimit(600, 60_000, (req) => req.ip ?? 'ip'));

  const v2 = express.Router();
  v2.get('/health', wrap(async () => {
    const db = await q1<{ ok: number }>('SELECT 1 AS ok').catch(() => null);
    const depth = await q<{ plugin_id: string; live: number }>("SELECT plugin_id, count(*)::int AS live FROM items WHERE status='live' GROUP BY plugin_id").catch(() => []);
    const p = getProvider();
    return { status: db ? 'ok' : 'degraded', database: !!db, bank_depth: Object.fromEntries(depth.map((d) => [d.plugin_id, d.live])), model: { provider: p.id, model: p.model, degraded: providerDegraded() } };
  }));
  v2.get('/time', wrap(async () => ({ server_time_ms: Date.now() })));
  v2.get('/meta', wrap(async () => ({
    locales: LOCALES,
    first_languages: FIRST_LANGUAGES,
    batteries: Object.values(BATTERIES).map((b) => ({ battery_id: b.battery_id, name: b.name, description: b.description, max_items: b.global.max_items, max_duration_min: b.global.max_duration_min })),
    plugins: [...registry().plugins.values()].map((p) => ({ plugin_id: p.manifest.plugin_id, name: p.manifest.scoring.report_label, blurb: p.manifest.scoring.report_blurb })),
  })));

  v2.use('/auth', authRouter());
  v2.use('/me', meRouter());
  // Every session and probe belongs to the signed-in user's subject; others get 404, not 403.
  const own = (req: Request, res: Response, n: NextFunction) => { assertOwnsSession(res.locals.user, req.params.id!).then(() => n(), n); };
  const owned = (fn: (req: Request, res: Response) => Promise<unknown>) => [requireUser, own, wrap(fn)];
  v2.post('/sessions', requireUser, wrap(async (req, res) => { send(res, await createSession({ battery_id: req.body?.battery_id }, res.locals.user), 201); }));
  v2.get('/sessions/:id/next', ...owned(async (req) => next(req.params.id!)));
  v2.post('/sessions/:id/responses', ...owned(async (req) => respond(req.params.id!, req.body)));
  v2.post('/sessions/:id/blocks/:adminId/complete', ...owned(async (req) => completeBlock(req.params.id!, req.params.adminId!, req.body)));
  v2.post('/sessions/:id/probes', ...owned(async (req) => submitProbeAnswers(req.params.id!, req.body ?? {})));
  v2.get('/sessions/:id/state', ...owned(async (req) => sessionState(req.params.id!)));
  v2.get('/sessions/:id/report', ...owned(async (req, res) => {
    const r = await buildReport(req.params.id!);
    await audit(`user:${res.locals.user.user_id}`, 'report_read', 'session', req.params.id!, null);
    return r;
  }));
  v2.post('/probes/:id/respond', requireUser, wrap(async (req, res) => {
    await assertOwnsProbe(res.locals.user, req.params.id!);
    return respondProbe(req.params.id!, req.body ?? {});
  }));
  v2.use('/admin', requireAdmin, adminRouter());

  app.use('/v2', v2);
  app.use((req, res) => send(res, { error: 'not_found', message: `${req.method} ${req.path}` }, 404));
  app.use((err: unknown, _req: Request, res: Response, _n: NextFunction) => {
    if (err instanceof HttpError) return send(res, { error: err.code, message: err.message, detail: err.detail }, err.status);
    if ((err as { type?: string }).type === 'entity.parse.failed') return send(res, { error: 'bad_json', message: 'request body is not valid JSON' }, 400);
    log('http', `unhandled error: ${(err as Error).message}`, { trace_id: res.locals.trace_id, stack: (err as Error).stack?.split('\n').slice(0, 4).join(' | ') });
    send(res, { error: 'internal', message: 'internal error' }, 500);
  });
  return app;
}

export { pool };
