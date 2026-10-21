// memory.recognition.v1 — independent key derivation for recognition items (Doc 03 §4):
// the keyed option must be the only option present in the encode phase, and every foil's
// similarity class must match the requested foil_similarity lever.
import { glyphSimilarity, type SolverFn } from '@cognimetric/core';
import { spatialClass } from '../author/spatialLocation.v1';

type Probe = { options: (string | number)[]; target_asset?: string; stem?: string };

const solve: SolverFn = ({ item, levers, services }) => {
  const bp = item.blueprint as { material?: string; phases: { phase: string; stimuli?: unknown[]; probes?: unknown[]; duration_ms?: number; presentation?: Record<string, unknown> }[] };
  const material = bp.material;
  const encode = bp.phases.find((p) => p.phase === 'encode');
  const delay = bp.phases.find((p) => p.phase === 'delay');
  const retrieve = bp.phases.find((p) => p.phase === 'retrieve');
  if (!encode?.stimuli?.length || !retrieve?.probes?.length || !delay) return { verdict: 'no_solution', detail: 'missing encode, delay or retrieve phase' };

  const stim = encode.stimuli as { asset?: string; word?: string; cell?: number }[];
  if (typeof levers.set_size === 'number' && stim.length !== levers.set_size) return { verdict: 'lever_mismatch', detail: `set_size ${stim.length} ≠ ${levers.set_size}` };
  if (typeof levers.probe_count === 'number' && retrieve.probes.length !== Math.min(levers.probe_count, stim.length)) return { verdict: 'lever_mismatch', detail: 'probe_count' };
  if (typeof levers.delay_ms === 'number' && Math.abs((delay.duration_ms ?? 0) - levers.delay_ms) > levers.delay_ms * 0.15) return { verdict: 'lever_mismatch', detail: 'delay_ms' };

  const derived: number[] = [];
  for (const [pi, raw] of (retrieve.probes as Probe[]).entries()) {
    if (typeof levers.option_count === 'number' && raw.options.length !== levers.option_count) return { verdict: 'lever_mismatch', detail: `probe ${pi}: option_count` };
    let present: number[];
    let foilClass: (key: string | number, foil: string | number) => string;
    if (material === 'spatial') {
      const target = stim.find((s) => s.asset === raw.target_asset);
      if (!target || typeof target.cell !== 'number') return { verdict: 'no_solution', detail: `probe ${pi}: target was not encoded` };
      const cols = ((encode.presentation?.grid as number[]) ?? [3, 3])[0]!;
      present = raw.options.map((o, i) => (o === target.cell ? i : -1)).filter((i) => i >= 0);
      foilClass = (k, f) => spatialClass(Number(k), Number(f), cols);
    } else if (material === 'word') {
      const enc = new Set(stim.map((s) => s.word));
      present = raw.options.map((o, i) => (enc.has(String(o)) ? i : -1)).filter((i) => i >= 0);
      const lex = services.lexicon;
      if (!lex) return { verdict: 'not_solvable_by_rule', detail: 'lexical service unavailable' };
      for (const o of raw.options) if (!lex.lookup(String(o))) return { verdict: 'lever_mismatch', detail: `word "${o}" not in the ${lex.locale} lexicon` };
      foilClass = (k, f) => (['high', 'medium', 'low'] as const)[lex.semanticDistance(String(k), String(f))]!;
    } else {
      const enc = new Set(stim.map((s) => s.asset));
      present = raw.options.map((o, i) => (enc.has(String(o)) ? i : -1)).filter((i) => i >= 0);
      foilClass = (k, f) => glyphSimilarity(String(k), String(f));
    }
    if (present.length === 0) return { verdict: 'no_solution', detail: `probe ${pi}: no option was encoded` };
    if (present.length > 1) return { verdict: 'multiple_solutions', detail: `probe ${pi}: options ${present.join(',')} were all encoded` };
    const k = present[0]!;
    if (typeof levers.foil_similarity === 'string') {
      for (const [i, o] of raw.options.entries()) {
        if (i === k) continue;
        const cls = foilClass(raw.options[k]!, o);
        if (cls !== levers.foil_similarity) return { verdict: 'lever_mismatch', detail: `probe ${pi}: foil "${o}" is ${cls}-similarity, requested ${levers.foil_similarity}` };
      }
    }
    derived.push(k);
  }
  const key = item.answer_key.kind === 'index_per_probe' ? item.answer_key.value : [];
  if (key.length !== derived.length || key.some((v, i) => v !== derived[i])) return { verdict: 'key_mismatch', derived_key: derived, detail: `solver derives ${derived.join(',')}` };
  return { verdict: 'key_confirmed', derived_key: derived };
};

export default solve;
