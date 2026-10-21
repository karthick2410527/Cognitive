// Helpers shared by this plugin's trial expanders.
import type { Levers } from '@cognimetric/core';

export const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : Number(v ?? d));
export const NO_DEADLINE_MS = 3000;

export function nudgeFor(levers: Levers) {
  const deadline = num(levers.response_deadline_ms, NO_DEADLINE_MS);
  return deadline < NO_DEADLINE_MS ? { max_mean_rt_ms: deadline - 100, message: 'Try to respond a little faster.' } : null;
}
