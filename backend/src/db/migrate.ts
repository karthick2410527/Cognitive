// Forward-only migrations. Each file runs once inside a transaction and is recorded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(log: (s: string) => void = console.log) {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(DIR, f), 'utf8'));
      await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      log(`migrated ${f}`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
