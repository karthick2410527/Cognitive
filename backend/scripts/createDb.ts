// Creates the database named in DATABASE_URL if it does not exist.
import pg from 'pg';
import { config } from '../src/config';

const url = new URL(config.DATABASE_URL);
const name = url.pathname.replace(/^\//, '');
url.pathname = '/postgres';
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();
const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (!exists.rowCount) {
  await c.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  console.log(`created database ${name}`);
} else console.log(`database ${name} exists`);
await c.end();
