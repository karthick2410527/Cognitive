// Accounts, login and per-user tracking. A user owns exactly one pseudonymous subject; sessions,
// responses, scores and delayed-recall probes hang off that subject, so a user's history is the
// subject's history.
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { SubjectProfileSchema } from '@cognimetric/core';
import { isProd } from '../config';
import { q, q1, tx } from '../db/pool';
import { HttpError, uuid } from '../util';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './passwords';

export const COOKIE = 'cm_session';
const TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 14);
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export interface AuthUser { user_id: string; username: string; subject_id: string; role: 'user' | 'admin' }

const Credentials = z.object({
  username: z.string().trim().min(3, 'Use at least 3 characters.').max(32).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, numbers, dot, dash or underscore.'),
  password: z.string().max(128),
}).strict();

export async function logEvent(userId: string, kind: string, detail: unknown = null) {
  await q('INSERT INTO user_events (user_id, kind, detail) VALUES ($1,$2,$3)', [userId, kind, detail]);
}

async function issue(res: Response, userId: string, ua: string | undefined) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q("INSERT INTO auth_sessions (token_hash, user_id, expires_at, user_agent) VALUES ($1,$2, now() + make_interval(days => $3), $4)", [sha(token), userId, TTL_DAYS, (ua ?? '').slice(0, 200)]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd() || process.env.COOKIE_SECURE === 'true', maxAge: TTL_DAYS * 86400_000, path: '/' });
}

export async function register(body: unknown, res: Response, ua?: string) {
  const parsed = Credentials.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'invalid_credentials', parsed.error.issues[0]?.message ?? 'invalid input');
  const { username, password } = parsed.data;
  const problem = passwordProblem(password, username);
  if (problem) throw new HttpError(400, 'weak_password', problem);
  const hash = await hashPassword(password);
  const userId = uuid();
  const subjectId = uuid();
  try {
    await tx(async (c) => {
      await c.query('INSERT INTO subjects (subject_id, locale, profile) VALUES ($1, $2, $3)', [subjectId, 'en', SubjectProfileSchema.parse({})]);
      await c.query('INSERT INTO users (user_id, username, username_lower, password_hash, subject_id) VALUES ($1,$2,$3,$4,$5)', [userId, username, username.toLowerCase(), hash, subjectId]);
    });
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'username_taken', 'That username is taken.');
    throw e;
  }
  await issue(res, userId, ua);
  await logEvent(userId, 'registered');
  return { user: { user_id: userId, username, role: 'user' } };
}

export async function login(body: unknown, res: Response, ua?: string) {
  const parsed = Credentials.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'invalid_credentials', 'Enter a username and password.');
  const u = await q1<{ user_id: string; username: string; password_hash: string; role: string; failed_logins: number; locked_until: Date | null }>('SELECT * FROM users WHERE username_lower=$1', [parsed.data.username.toLowerCase()]);
  if (u?.locked_until && new Date(u.locked_until).getTime() > Date.now()) throw new HttpError(429, 'locked', 'Too many failed attempts. Try again in a few minutes.');
  const ok = await verifyPassword(parsed.data.password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) {
    if (u) await q("UPDATE users SET failed_logins = failed_logins + 1, locked_until = CASE WHEN failed_logins + 1 >= 8 THEN now() + interval '15 minutes' ELSE locked_until END WHERE user_id=$1", [u.user_id]);
    throw new HttpError(401, 'bad_login', 'Username or password is incorrect.');
  }
  await q('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=now() WHERE user_id=$1', [u.user_id]);
  await issue(res, u.user_id, ua);
  await logEvent(u.user_id, 'login');
  return { user: { user_id: u.user_id, username: u.username, role: u.role } };
}

export async function logout(req: Request, res: Response) {
  const t = cookieOf(req);
  if (t) await q('DELETE FROM auth_sessions WHERE token_hash=$1', [sha(t)]);
  res.clearCookie(COOKIE, { path: '/' });
  return { logged_out: true };
}

export async function changePassword(user: AuthUser, body: { current?: string; next?: string }) {
  const u = await q1<{ password_hash: string }>('SELECT password_hash FROM users WHERE user_id=$1', [user.user_id]);
  if (!u || !(await verifyPassword(String(body.current ?? ''), u.password_hash))) throw new HttpError(401, 'bad_login', 'Current password is incorrect.');
  const problem = passwordProblem(String(body.next ?? ''), user.username);
  if (problem) throw new HttpError(400, 'weak_password', problem);
  await q('UPDATE users SET password_hash=$2 WHERE user_id=$1', [user.user_id, await hashPassword(String(body.next))]);
  await q('DELETE FROM auth_sessions WHERE user_id=$1', [user.user_id]);
  await logEvent(user.user_id, 'password_changed');
  return { changed: true, note: 'All sessions were signed out; sign in again.' };
}

function cookieOf(req: Request): string | null {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Attaches req.user when a valid session cookie is present. */
export async function attachUser(req: Request, res: Response, next: NextFunction) {
  try {
    const t = cookieOf(req);
    if (t) {
      const u = await q1<AuthUser>(
        `UPDATE auth_sessions s SET last_seen_at=now() FROM users u
         WHERE s.token_hash=$1 AND s.expires_at > now() AND u.user_id = s.user_id
         RETURNING u.user_id, u.username, u.subject_id, u.role`, [sha(t)]);
      if (u) res.locals.user = u;
    }
    next();
  } catch (e) { next(e); }
}

export function requireUser(_req: Request, res: Response, next: NextFunction) {
  if (!res.locals.user) return next(new HttpError(401, 'login_required', 'Please sign in.'));
  next();
}

/** Cookie-authenticated state changes must be JSON (a cross-site form cannot send it): a CSRF guard. */
export function jsonOnlyWrites(req: Request, _res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers.cookie && !String(req.headers['content-type'] ?? '').includes('application/json'))
    return next(new HttpError(415, 'json_required', 'Requests must be JSON.'));
  next();
}

export async function assertOwnsSession(user: AuthUser, sessionId: string) {
  const s = await q1<{ subject_id: string }>('SELECT subject_id FROM sessions WHERE session_id=$1', [sessionId]);
  if (!s || s.subject_id !== user.subject_id) throw new HttpError(404, 'session_not_found', 'unknown session');
}

export async function assertOwnsProbe(user: AuthUser, probeId: string) {
  const p = await q1<{ subject_id: string }>('SELECT subject_id FROM recall_probes WHERE probe_id=$1', [probeId]);
  if (!p || p.subject_id !== user.subject_id) throw new HttpError(404, 'probe_not_found', 'unknown probe');
}

