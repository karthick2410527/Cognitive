import pg from 'pg';
import { config } from '../config';

pg.types.setTypeParser(1700, (v) => Number(v)); // numeric → number
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number (seeds, counts are within 2^53)

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 12 });

export type Db = Pick<pg.PoolClient, 'query'>;

export async function q<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query<T>(sql, params);
  return r.rows;
}

export async function q1<T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(sql, params, db))[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(actor: string, action: string, subjectKind: string | null, subjectRef: string | null, detail: unknown, db: Db = pool) {
  await db.query('INSERT INTO audit_log (actor, action, subject_kind, subject_ref, detail) VALUES ($1,$2,$3,$4,$5)', [actor, action, subjectKind, subjectRef, detail ?? null]);
}
