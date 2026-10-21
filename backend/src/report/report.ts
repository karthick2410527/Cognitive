// Session report (Doc 05 §8, Doc 10 §6). Claim language is fixed to the project's actual validation
// stage — no normative sample — so the report says "your score on this task" and never "normal",
// "impaired" or any condition name. No composite score exists anywhere. Every score carries an
// interval, and every shortfall in measurement is stated.
import { SubjectProfileSchema } from '@cognimetric/core';
import { q, q1 } from '../db/pool';
import { registry } from '../plugins/registry';
import { HttpError } from '../util';
import { generationConfig } from '../live/config';

export const CLAIM_STAGE = 'no_normative_sample' as const;

const STAGE_TEXT = {
  heading: 'Your scores on these tasks',
  disclaimer: 'These are scores on the tasks you just completed, placed on a provisional scale. They are not a diagnosis and do not say whether anything is normal or impaired. No normative sample has been collected yet, so scores cannot be compared with people of your age or education.',
};

function band(theta: number): { key: string; label: string } {
  if (theta < -0.67) return { key: 'lower', label: 'Lower part of the provisional scale' };
  if (theta > 0.67) return { key: 'upper', label: 'Upper part of the provisional scale' };
  return { key: 'middle', label: 'Middle part of the provisional scale' };
}

export async function buildReport(sessionId: string) {
  const s = await q1<{ session_id: string; subject_id: string; phase: string; battery_id: string; session_index: number; engine_state: Record<string, unknown>; flags: Record<string, unknown>; device_profile: Record<string, unknown> | null; started_at: Date; completed_at: Date | null; stop_reason: string | null; locale: string; engine_ver: string; block_plan: { global: { target_se: number } } }>(
    'SELECT * FROM sessions WHERE session_id=$1', [sessionId]);
  if (!s) throw new HttpError(404, 'session_not_found', 'unknown session');
  if (s.phase !== 'done') throw new HttpError(409, 'session_not_done', 'the report is available once the session is complete');
  const profile = SubjectProfileSchema.parse(s.flags.profile_snapshot ?? {});
  const state = s.engine_state as { unmeasured: Record<string, string>; substitutions: { plugin: string; from: string; to: string; reason: string }[]; domains: string[]; stop_notes: string[]; tiers: Record<string, number> };
  const ab = await q<{ dimension: string; theta: number; se: number; theta_mle: number | null; n_items: number; method: string }>('SELECT * FROM ability_estimates WHERE session_id=$1', [sessionId]);
  const admins = await q<{ plugin_id: string; task_type: string; state: string; score: Record<string, unknown> | null; tier: string; substitution_distance: number }>(
    'SELECT plugin_id, task_type, state, score, tier, substitution_distance FROM administrations WHERE session_id=$1 ORDER BY position', [sessionId]);
  const timing = await q1<{ total: number; unusable: number; degraded: number }>(
    `SELECT coalesce(sum(jsonb_array_length(payload->'trials')),0)::int AS total,
            coalesce(sum((SELECT count(*) FROM jsonb_array_elements(payload->'trials') t WHERE t->>'timing_quality'='unusable')),0)::int AS unusable,
            coalesce(sum((SELECT count(*) FROM jsonb_array_elements(payload->'trials') t WHERE t->>'timing_quality'='degraded')),0)::int AS degraded
     FROM block_submissions b JOIN administrations a USING (administration_id) WHERE a.session_id=$1`, [sessionId]);
  const choiceUnusable = await q1<{ total: number; unusable: number }>(
    "SELECT count(*)::int AS total, count(*) FILTER (WHERE r.timing_quality='unusable')::int AS unusable FROM responses r JOIN administrations a USING (administration_id) WHERE a.session_id=$1 AND r.phase IN ('present','retrieve')", [sessionId]);
  const totalTimed = (timing?.total ?? 0) + (choiceUnusable?.total ?? 0);
  const unusableRate = totalTimed ? ((timing?.unusable ?? 0) + (choiceUnusable?.unusable ?? 0)) / totalTimed : 0;

  // Data-quality stopping rule (Doc 05 §7): > 25 % unusable timing ⇒ the report is suppressed.
  if (unusableRate > 0.25) {
    return {
      session_id: sessionId, suppressed: true, claim_stage: CLAIM_STAGE, ...STAGE_TEXT,
      suppression_reason: `${Math.round(unusableRate * 100)} % of responses had unusable timing (for example the window lost focus or the device dropped frames). A wrong number is worse than a missing one, so no scores are shown. Please try again on a device where the test can run in the foreground without interruption.`,
      quality: { unusable_timing_rate: unusableRate },
    };
  }

  const reg = registry();
  const domains = state.domains.map((pid) => {
    const p = reg.plugins.get(pid)!;
    const m = p.manifest;
    const primary = Object.entries(m.loading).sort((a, b) => b[1] - a[1])[0]![0];
    const est = ab.find((r) => r.dimension === primary);
    const mine = admins.filter((a) => a.plugin_id === pid);
    const answered = mine.filter((a) => a.state === 'answered');
    const target = m.target_se ?? s.block_plan.global.target_se;
    const byTask = new Map<string, typeof answered>();
    for (const a of answered) byTask.set(a.task_type, [...(byTask.get(a.task_type) ?? []), a]);
    const perTask = [...byTask.entries()].map(([tt, xs]) => {
      const def = m.task_types.find((t) => t.id === tt)!;
      const choice = xs.filter((x) => x.score?.kind === 'choice');
      const blocks = xs.filter((x) => x.score?.kind === 'block');
      const rts = choice.map((x) => Number(x.score!.rt_ms)).filter(Number.isFinite);
      return {
        task_type: tt,
        description: def.one_line,
        component: def.component,
        items: xs.length,
        accuracy: choice.length ? choice.reduce((s2, x) => s2 + Number(x.score!.u), 0) / choice.length : blocks.length ? blocks.reduce((s2, x) => s2 + Number(x.score!.accuracy), 0) / blocks.length : null,
        mean_rt_ms: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null,
        blocks: blocks.map((b) => ({ metric: b.score!.metric_name, value: b.score!.metric, derived: b.score!.derived, provisional_norm: b.score!.provisional_norm })),
      };
    });
    const unmeasured = state.unmeasured[pid] ?? null;
    const staircaseOnly = !est || est.method !== 'eap';
    const scored = !unmeasured && !staircaseOnly && answered.length > 0;
    const ci = est ? [est.theta - 1.96 * est.se, est.theta + 1.96 * est.se] : null;
    return {
      plugin_id: pid,
      label: m.scoring.report_label,
      blurb: m.scoring.report_blurb,
      caveat: m.scoring.report_caveat,
      status: unmeasured ? 'unmeasured' : !scored ? 'insufficient_data' : 'scored',
      status_note: unmeasured ?? (staircaseOnly ? 'Too few items were completed to estimate a score (the first two items in a domain only set a starting point).' : null),
      theta: scored ? round(est!.theta) : null,
      se: scored ? round(est!.se) : null,
      ci95: scored ? ci!.map(round) : null,
      band: scored ? band(est!.theta) : null,
      reached_target_se: scored ? est!.se <= target : false,
      target_se: target,
      method: est?.method ?? null,
      eap_mle_divergence: scored && est!.theta_mle !== null ? round(Math.abs(est!.theta - est!.theta_mle)) : null,
      items: answered.length,
      unmeasured_blocks: mine.filter((a) => a.state === 'unmeasured').length,
      per_task_type: perTask,
      components: m.scoring.report_components.map((comp) => ({ component: comp, task_types: perTask.filter((t) => t.component === comp) })),
      substitutions: state.substitutions.filter((x) => x.plugin === pid),
    };
  });

  // Profile: only differences whose 95 % intervals do not overlap are called reliable (Doc 05 §8.1).
  const scored = domains.filter((d) => d.status === 'scored');
  let largest: { higher: string; lower: string; difference: number } | null = null;
  for (const a of scored) for (const b of scored) {
    if (a === b || !a.ci95 || !b.ci95) continue;
    if (a.ci95[0]! > b.ci95[1]!) {
      const diff = a.theta! - b.theta!;
      if (!largest || diff > largest.difference) largest = { higher: a.label, lower: b.label, difference: round(diff) };
    }
  }

  const gen = await q1<{ live: number; fallback: number; text: number; total: number }>(
    `SELECT count(*) FILTER (WHERE source='live')::int AS live, count(*) FILTER (WHERE source='bank_fallback')::int AS fallback,
            count(*) FILTER (WHERE modality='text')::int AS text, count(*) FILTER (WHERE modality IS NOT NULL)::int AS total
     FROM administrations WHERE session_id=$1`, [sessionId]);
  const probes = await q<{ state: string; grade: string | null; retrieval_score: number | null; due_at: Date }>('SELECT state, grade, retrieval_score, due_at FROM recall_probes WHERE subject_id=$1 AND session_id=$2', [s.subject_id, sessionId]);
  const tiers = state.tiers ?? {};
  const totalServed = Object.values(tiers).reduce((a, b) => a + b, 0) || 1;
  return {
    session_id: sessionId,
    suppressed: false,
    claim_stage: CLAIM_STAGE,
    ...STAGE_TEXT,
    no_composite_score: 'Five domains with different scales and reliabilities are never averaged into one number.',
    generated_at: new Date().toISOString(),
    engine_version: s.engine_ver,
    battery_id: s.battery_id,
    stop_reason: s.stop_reason,
    domains,
    profile: { reliable_difference: largest, note: largest ? null : 'No two domains differ reliably: every pair of 95 % intervals overlaps.' },
    delayed_recall: {
      pending: probes.filter((p) => ['pending', 'due'].includes(p.state)).map((p) => ({ due_at: p.due_at })),
      scored: probes.filter((p) => p.state === 'scored').map((p) => ({ grade: p.grade, score: p.retrieval_score })),
      note: 'Delayed recall is reported on its own line and is never folded into the same-session memory score.',
    },
    generation: {
      mode: (s as { mode?: string }).mode ?? 'bank',
      live_items: gen?.live ?? 0,
      bank_fallback_items: gen?.fallback ?? 0,
      text_share: gen?.total ? round((gen.text ?? 0) / gen.total) : null,
      target_text_share: generationConfig().modality_ratio.text,
      note: 'Live questions were written for this session by the language model and passed the same five automated checks as bank questions. When live generation was slow or failed, a pre-checked bank question was used instead.',
    },
    context: {
      session_index: s.session_index,
      practice_effect_note: s.session_index > 1 ? `This is session ${s.session_index}. Scores on speed and attention tasks tend to improve with repetition; no calibrated practice adjustment exists yet, so do not compare this session with session 1 directly.` : null,
      locale: s.locale,
      device_class: profile.device_class,
      input_method: profile.input_device,
      refresh_hz: (s.device_profile as { refresh_hz?: number } | null)?.refresh_hz ?? null,
      education_years: profile.education_years,
      first_language: profile.first_language,
      age_band: profile.age_band,
      demographic_adjustment: 'None applied. Education, first language and test language are shown so scores can be read in context.',
    },
    quality: {
      items_administered: admins.length,
      unmeasured_blocks: admins.filter((a) => a.state === 'unmeasured').length,
      degraded_timing_trials: timing?.degraded ?? 0,
      unusable_timing_rate: round(unusableRate),
      domains_short_of_target_se: domains.filter((d) => d.status === 'scored' && !d.reached_target_se).map((d) => d.label),
      substitutions: state.substitutions,
      tier_share: { A: round((tiers.A ?? 0) / totalServed), B: round((tiers.B ?? 0) / totalServed), C: round((tiers.C ?? 0) / totalServed) },
      max_substitution_distance: round(Math.max(0, ...admins.map((a) => a.substitution_distance))),
      dev_time_scale: (s.flags as { dev_time_scale?: number | null }).dev_time_scale ?? null,
      dev_time_scale_note: (s.flags as { dev_time_scale?: number | null }).dev_time_scale ? 'Development time-scaling was active: timed blocks were shortened. These results are not a valid measurement.' : null,
      provisional_parameters: 'Item difficulties come from the lever model (designer anchors) and timed-block norms are provisional until calibration data exist.',
      notes: state.stop_notes,
    },
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
