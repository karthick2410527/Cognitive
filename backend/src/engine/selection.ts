// Item and domain selection (Doc 05 §6): max_information_balanced across domains; within a domain,
// information × exposure control × content balance × provisional penalty × freshness, with
// randomesque choice among the top 5. Accessibility is applied first, by the substitution
// principle (Doc 10 §3.1): an inaccessible task type is replaced by its declared substitute and the
// substitution is recorded; a domain with no accessible route is reported unmeasured.
import type { LoadedPlugin, Rng, SubjectProfile, TaskTypeDef } from '@cognimetric/core';
import { info2pl } from './irt';
import type { Candidate } from '../bank/bank';

export interface Access { allowed: string[]; substitutions: { from: string; to: string; reason: string }[]; unmeasured: string | null }

export function accessibleTaskTypes(plugin: LoadedPlugin, profile: SubjectProfile): Access {
  const blocked = (t: TaskTypeDef): string | null => {
    const a = t.accessibility;
    if (profile.vision === 'none' && a.vision_required) return 'vision';
    if (profile.literacy === 'low' && a.literacy_required) return 'literacy';
    if (profile.colour_vision === 'deficient' && a.colour_dependent) return 'colour vision';
    if (profile.hearing === 'impaired' && a.hearing_required) return 'hearing';
    if (profile.motor === 'limited' && a.motor_demand === 'high') return 'fine motor';
    return null;
  };
  const tts = plugin.manifest.task_types.filter((t) => t.protocol !== 'cross_session' && t.weight > 0);
  const allowed = new Set<string>();
  const substitutions: Access['substitutions'] = [];
  for (const t of tts) {
    const why = blocked(t);
    if (!why) { allowed.add(t.id); continue; }
    const sub = t.accessible_substitute ? tts.find((x) => x.id === t.accessible_substitute) : undefined;
    if (sub && !blocked(sub)) {
      allowed.add(sub.id);
      substitutions.push({ from: t.id, to: sub.id, reason: why });
    }
  }
  const reasons = [...new Set(tts.map((t) => blocked(t)).filter(Boolean))];
  return {
    allowed: [...allowed],
    substitutions,
    unmeasured: allowed.size ? null : `No task type in this build measures ${plugin.manifest.name.toLowerCase()} without ${reasons.join(' / ')}; an accessible substitute is not yet available.`,
  };
}

export interface DomainState { n: number; theta: number; se: number; target_se: number; taskTypeCounts: Record<string, number> }

export function itemInfo(c: Candidate, theta: number) {
  return info2pl(theta, c.discrimination_a, c.difficulty_b);
}

export function domainScore(bestInfo: number, d: DomainState, nMean: number, isPrev: boolean, epsilon = 0.08): number {
  const wSe = Math.min(2, d.se / d.target_se);
  const wBal = (1 + epsilon) ** (nMean - d.n);
  const wRec = isPrev ? 0.8 : 1;
  return bestInfo * wSe * wBal * wRec;
}

export interface UtilityInput {
  theta: number;
  cand: Candidate[];
  exposure: Map<string, number>;
  weights: Record<string, number>;
  counts: Record<string, number>;
  nDomain: number;
  maxPerDomain: number;
  rng: Rng;
  targetRate?: number;
}

/** Choose an item by utility, randomesque among the top 5 (Doc 05 §6.3). */
export function chooseItem(x: UtilityInput): { pick: Candidate; utility: number; info: number } | null {
  const target = x.targetRate ?? 0.25;
  const scored: { c: Candidate; u: number; i: number }[] = [];
  for (const c of x.cand) {
    const w = x.weights[c.task_type] ?? 0;
    const used = x.counts[c.task_type] ?? 0;
    const quota = Math.ceil(w * x.maxPerDomain) + 1;
    if (used >= quota) continue;
    const rate = x.exposure.get(c.item_id) ?? 0;
    // Sympson–Hetter: an item above the target conditional exposure rate is probabilistically skipped.
    if (rate > target && x.rng.next() > target / rate) continue;
    const expected = w * (x.nDomain + 1);
    const balance = used < expected ? 1.25 : 0.75;
    const provisional = c.param_source === 'lever_model' ? 0.15 : 0;
    const freshness = 1 / (1 + c.n_administered / 200);
    const i = itemInfo(c, x.theta);
    scored.push({ c, u: i * (1 - Math.min(0.9, rate)) * balance * (1 - provisional) * freshness, i });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.u - a.u);
  const top = scored.slice(0, 5);
  const p = top[Math.floor(x.rng.next() * top.length)]!;
  return { pick: p.c, utility: p.u, info: p.i };
}
