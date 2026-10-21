// Item parameters before data exists (Doc 05 §5): a from the plugin prior, b from the lever model.
// Initially the lever model is the designer's anchors (b = θ target). Once W3 has fitted a
// regression for the cell, b is its prediction.
import type { Levers } from '@cognimetric/core';
import { q1 } from '../db/pool';

export function leverScaled(levers: Levers): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(levers)) {
    if (typeof v === 'number') out[k] = v;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
  }
  return out;
}

export async function estimateB(pluginId: string, taskType: string, locale: string, levers: Levers, targetB: number): Promise<number> {
  const m = await q1<{ intercept: number; coefficients: Record<string, number> }>('SELECT intercept, coefficients FROM lever_models WHERE plugin_id=$1 AND task_type=$2 AND locale=$3', [pluginId, taskType, locale]);
  if (!m) return Math.round(targetB * 1000) / 1000;
  const x = leverScaled(levers);
  let b = m.intercept;
  for (const [k, beta] of Object.entries(m.coefficients)) b += beta * (x[k] ?? 0);
  return Math.max(-3, Math.min(3, Math.round(b * 1000) / 1000));
}
