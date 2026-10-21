import crypto from 'node:crypto';

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const uuid = () => crypto.randomUUID();
export const traceId = () => crypto.randomBytes(8).toString('hex');
export const seed32 = () => crypto.randomBytes(4).readUInt32BE(0);
export const log = (scope: string, msg: string, extra?: Record<string, unknown>) =>
  console.log(`${new Date().toISOString()} [${scope}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`);

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) {
    super(message);
  }
}
