// Password hashing with scrypt (N=2^15, r=8, p=1), a random 16-byte salt per password, and
// constant-time comparison. Format: scrypt$N$r$p$salt$hash (base64url).
import crypto from 'node:crypto';

const N = 1 << 15, R = 8, P = 1, LEN = 32;
const scrypt = (pw: string, salt: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((res, rej) => crypto.scrypt(pw.normalize('NFKC'), salt, LEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(pw, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  const want = Buffer.from(hash, 'base64url');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

/** NIST SP 800-63B-style rules: length 8–128, not a very common password, not the username. */
const COMMON = new Set(['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'abc12345', 'letmein1', 'welcome1', 'admin123', 'passw0rd', '11111111', '00000000', 'football', 'sunshine', 'princess', 'baseball', 'trustno1']);
export function passwordProblem(pw: string, username: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 128) return 'Use at most 128 characters.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose another.';
  if (pw.toLowerCase().includes(username.toLowerCase())) return 'The password must not contain the username.';
  return null;
}

/** A hash to verify against when the username does not exist, so timing does not reveal it. */
export const DUMMY_HASH = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
