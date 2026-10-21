// Config precedence carried over from v1: env var > config file > default, with the loaded value
// and its source logged at boot (Doc 01 §12).
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// .env lives in the backend root.
if (process.env.NODE_ENV !== 'test') dotenv.config({ path: path.join(ROOT, '.env') });
const FILE = path.join(ROOT, 'cognimetric.config.json');
const fileCfg: Record<string, unknown> = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};

type Source = 'env' | 'file' | 'default';
const sources: Record<string, Source> = {};

function get<T extends string | number | boolean>(key: string, def: T): T {
  const env = process.env[key];
  if (env !== undefined && env !== '') {
    sources[key] = 'env';
    if (typeof def === 'number') return Number(env) as T;
    if (typeof def === 'boolean') return (env === 'true' || env === '1') as T;
    return env as T;
  }
  if (key in fileCfg) {
    sources[key] = 'file';
    return fileCfg[key] as T;
  }
  sources[key] = 'default';
  return def;
}

export const config = {
  NODE_ENV: get<string>('NODE_ENV', 'development'),
  PORT: get('PORT', 4000),
  DATABASE_URL: get('DATABASE_URL', 'postgres://localhost:5432/cognimetric'),
  LLM_PROVIDER: get('LLM_PROVIDER', 'local') as 'local' | 'gemini',
  GEMINI_API_KEY: get('GEMINI_API_KEY', ''),
  GEMINI_MODEL: get('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
  GEMINI_BASE_URL: get('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
  ADMIN_TOKEN: get('ADMIN_TOKEN', 'dev-admin-token'),
  PROBE_ENCRYPTION_KEY: get('PROBE_ENCRYPTION_KEY', 'dev-only-probe-key-change-me'),
  DAILY_SPEND_CAP_USD: get('DAILY_SPEND_CAP_USD', 5),
  TIER_C_BUDGET_MS: get('TIER_C_BUDGET_MS', 6000),
  DEV_TIME_SCALE: get('DEV_TIME_SCALE', 1),
  PLUGINS_DIR: get('PLUGINS_DIR', path.join(ROOT, 'plugins')),
  DATA_DIR: get('DATA_DIR', path.join(ROOT, 'data')),
  SEED_K: get('SEED_K', 6),
  WORKER_INTERVAL_MS: get('WORKER_INTERVAL_MS', 5000),
  CALIBRATOR_INTERVAL_MS: get('CALIBRATOR_INTERVAL_MS', 3_600_000),
  SCHEDULER_INTERVAL_MS: get('SCHEDULER_INTERVAL_MS', 60_000),
  WORKER_TOPUP: get('WORKER_TOPUP', true),
  PROBATION_ITEMS: get('PROBATION_ITEMS', 200),
  CORS_ORIGIN: get('CORS_ORIGIN', 'http://localhost:5173'),
  RENDERER_VERSION: 'svg-2.0.0',
};

export const isProd = () => config.NODE_ENV === 'production';

/** Development time-scaling shortens timed blocks for manual testing. Never honoured in production. */
export const devTimeScale = () => (isProd() ? 1 : Math.min(1, Math.max(0.05, Number(config.DEV_TIME_SCALE) || 1)));

export function logConfig(log: (s: string) => void) {
  const secret = /KEY|TOKEN|PASSWORD/;
  for (const [k, v] of Object.entries(config)) {
    const shown = secret.test(k) ? (v ? '••••' : '(unset)') : k === 'DATABASE_URL' ? String(v).replace(/:[^:@/]+@/, ':••••@') : String(v);
    log(`config ${k}=${shown} (${sources[k] ?? 'derived'})`);
  }
  if (!isProd() && sources.ADMIN_TOKEN === 'default') log('WARNING: ADMIN_TOKEN is the development default.');
  if (!isProd() && sources.PROBE_ENCRYPTION_KEY === 'default') log('WARNING: PROBE_ENCRYPTION_KEY is the development default.');
  if (isProd() && (sources.ADMIN_TOKEN === 'default' || sources.PROBE_ENCRYPTION_KEY === 'default')) throw new Error('Refusing to boot in production with default secrets.');
}
