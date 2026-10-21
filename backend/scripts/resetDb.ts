// Development only: drops and recreates the database, then migrates. Refuses in production.
import pg from 'pg';
import { config, isProd } from '../src/config';

if (isProd()) throw new Error('refusing to reset a production database');
const url = new URL(config.DATABASE_URL);
const name = url.pathname.replace(/^\//, '');
url.pathname = '/postgres';
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
await c.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '')}" WITH (FORCE)`);
await c.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
await c.end();
console.log(`reset database ${name}`);
