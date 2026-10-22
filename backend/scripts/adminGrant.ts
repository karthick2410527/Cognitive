// Gives an existing account admin access (the /admin console, including Settings), or takes it away.
// The person first creates a normal account in the app; then, on the server:
//   npm run admin:grant -- <username>            make admin
//   npm run admin:grant -- <username> --revoke   back to a normal user
import { audit, pool, q1 } from '../src/db/pool';

const username = process.argv[2];
const revoke = process.argv.includes('--revoke');
if (!username || username.startsWith('--')) {
  console.error('usage: npm run admin:grant -- <username> [--revoke]');
  process.exit(1);
}
const role = revoke ? 'user' : 'admin';
const u = await q1<{ user_id: string; username: string }>('UPDATE users SET role=$2 WHERE username_lower=$1 RETURNING user_id, username', [username.toLowerCase(), role]);
if (!u) {
  console.error(`no account named "${username}": create it in the app first (Create account), then run this again`);
  await pool.end();
  process.exit(1);
}
await audit('cli', revoke ? 'admin_revoked' : 'admin_granted', 'user', u.user_id, { username: u.username });
console.log(revoke ? `${u.username} is now a normal user.` : `${u.username} is now an admin. Sign in at /admin with that account.`);
await pool.end();
