// Accounts and per-user tracking: the signed-in user's profile, session history, score trends and
// activity. Everything is scoped to the user's own pseudonymous subject.
import express from 'express';
import { CreateSubjectSchema } from '@cognimetric/core';
import { q, q1 } from '../db/pool';
import { registry } from '../plugins/registry';
import { HttpError } from '../util';
import { changePassword, login, logout, register, requireUser, type AuthUser } from '../auth/service';
import { rateLimit, send, wrap } from './http';

const me = (res: express.Response) => res.locals.user as AuthUser;

export function authRouter() {
  const r = express.Router();
  const limit = rateLimit(20, 60_000, (req) => `auth:${req.ip}`);
  r.post('/register', limit, wrap(async (req, res) => send(res, await register(req.body, res, req.headers['user-agent']), 201)));
  r.post('/login', limit, wrap(async (req, res) => login(req.body, res, req.headers['user-agent'])));
  r.post('/logout', wrap(async (req, res) => logout(req, res)));
  return r;
}

export function meRouter() {
  const r = express.Router();
  r.use(requireUser);

  r.get('/', wrap(async (_req, res) => {
    const u = me(res);
    const s = await q1<{ locale: string; profile: unknown; session_count: number }>('SELECT locale, profile, session_count FROM subjects WHERE subject_id=$1', [u.subject_id]);
    const created = await q1<{ created_at: Date }>('SELECT created_at FROM users WHERE user_id=$1', [u.user_id]);
    return { user: { user_id: u.user_id, username: u.username, role: u.role, created_at: created?.created_at }, locale: s?.locale, profile: s?.profile, session_count: s?.session_count ?? 0 };
  }));

  r.put('/profile', wrap(async (req, res) => {
    const parsed = CreateSubjectSchema.omit({ external_ref: true }).safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'invalid_profile', 'profile failed validation', parsed.error.issues);
    await q('UPDATE subjects SET locale=$2, profile=$3 WHERE subject_id=$1', [me(res).subject_id, parsed.data.locale, parsed.data.profile]);
    return { saved: true };
  }));

  r.post('/password', wrap(async (req, res) => changePassword(me(res), req.body ?? {})));

  r.get('/sessions', wrap(async (_req, res) => {
    const sessions = await q<Record<string, unknown>>(
      `SELECT s.session_id, s.battery_id, s.mode, s.phase, s.session_index, s.started_at, s.completed_at, s.stop_reason,
              (SELECT count(*)::int FROM administrations a WHERE a.session_id = s.session_id) AS items,
              (SELECT count(*)::int FROM administrations a WHERE a.session_id = s.session_id AND a.source = 'live') AS live_items,
              (SELECT count(*)::int FROM administrations a WHERE a.session_id = s.session_id AND a.modality = 'text') AS text_items,
              (SELECT json_agg(json_build_object('dimension', e.dimension, 'theta', e.theta, 'se', e.se, 'method', e.method, 'n', e.n_items)) FROM ability_estimates e WHERE e.session_id = s.session_id) AS abilities
       FROM sessions s WHERE s.subject_id=$1 ORDER BY s.started_at DESC LIMIT 100`, [me(res).subject_id]);
    return { sessions };
  }));

  r.get('/progress', wrap(async (_req, res) => {
    const rows = await q<{ dimension: string; session_id: string; session_index: number; completed_at: Date; theta: number; se: number }>(
      `SELECT e.dimension, s.session_id, s.session_index, s.completed_at, e.theta, e.se FROM ability_estimates e JOIN sessions s USING (session_id)
       WHERE s.subject_id=$1 AND s.phase='done' AND e.method='eap' ORDER BY s.completed_at`, [me(res).subject_id]);
    const domains = [...registry().plugins.values()].map((p) => {
      const dim = Object.entries(p.manifest.loading).sort((a, b) => b[1] - a[1])[0]![0];
      return { plugin_id: p.manifest.plugin_id, label: p.manifest.scoring.report_label, points: rows.filter((x) => x.dimension === dim).map(({ dimension: _d, ...rest }) => ({ ...rest, ci95: [rest.theta - 1.96 * rest.se, rest.theta + 1.96 * rest.se] })) };
    });
    return { domains, note: 'Only sessions with a model-based (EAP) estimate are plotted. Scores on speed and attention tasks tend to rise with practice; compare sessions with care.' };
  }));

  r.get('/events', wrap(async (req, res) => ({ events: await q('SELECT kind, detail, at FROM user_events WHERE user_id=$1 ORDER BY at DESC LIMIT $2', [me(res).user_id, Math.min(200, Number(req.query.limit ?? 50))]) })));
  r.get('/probes/due', wrap(async (_req, res) => ({
    probes: await q("SELECT probe_id, question, due_at FROM recall_probes WHERE subject_id=$1 AND state IN ('pending','due') AND due_at <= now() ORDER BY due_at", [me(res).subject_id]),
    upcoming: await q("SELECT due_at FROM recall_probes WHERE subject_id=$1 AND state IN ('pending','due') AND due_at > now() ORDER BY due_at", [me(res).subject_id]),
  })));
  return r;
}

export { send };
