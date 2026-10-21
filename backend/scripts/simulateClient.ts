// Synthetic test-taker that drives a full session through the HTTP API. It peeks at answer keys in
// the database (a test harness privilege — the API never exposes them) and answers with 2PL
// probability given a known θ, and synthesises plausible trial-level data for timed blocks.
// Usage: tsx scripts/simulateClient.ts [baseUrl] [battery] [theta]
import crypto from 'node:crypto';
import { createRng, p2pl } from './simHelpers';
import { pool, q1 } from '../src/db/pool';

const BASE = process.argv[2] ?? 'http://localhost:4000/v2';
const BATTERY = process.argv[3] ?? 'standard_5domain_v1';
const THETA = Number(process.argv[4] ?? 0.5);
const rng = createRng(Number(process.env.SIM_SEED ?? 7));

let cookie = '';
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

await api('POST', '/auth/register', { username: `sim_${crypto.randomUUID().slice(0, 8)}`, password: crypto.randomUUID() });
await api('PUT', '/me/profile', { locale: 'en', profile: { device_class: 'desktop', input_device: 'keyboard', education_years: 16, first_language: 'english' } });
const session = await api('POST', '/sessions', { battery_id: BATTERY });
console.log(`session ${session.session_id} (${BATTERY}, mode ${session.mode}), θ=${THETA}`);
let steps = 0;
for (;;) {
  if (++steps > 80) throw new Error('session did not terminate');
  const n = await api('GET', `/sessions/${session.session_id}/next`);
  if (n.done) { console.log(`done: ${n.stop_reason} after ${steps - 1} units`); break; }
  const u = n.unit as Record<string, any>;
  if (u.kind === 'probe_capture') {
    await api('POST', `/sessions/${session.session_id}/probes`, { answers: u.questions.map((x: any) => ({ probe_id: x.probe_id, answer: 'a blue cotton shirt' })) });
    console.log('  probe capture: answered', u.questions.length);
    continue;
  }
  const admin = await q1<{ answer_key: { kind: string; value: any }; difficulty_b: number; option_order: number[][] }>(
    'SELECT i.answer_key, i.difficulty_b, a.option_order FROM administrations a JOIN items i USING (item_id) WHERE a.administration_id=$1', [u.administration_id]);
  const pCorrect = p2pl(THETA, 1.2, admin!.difficulty_b);
  if (u.protocol === 'timed_block') {
    const b = u.block;
    let clock = 0;
    const timed = b.trials.map((t: any) => {
      const correct = rng() < 0.9 + 0.05 * Math.tanh(THETA);
      const resp = correct ? t.correct : t.correct === null ? b.responses[0].id : (b.responses.find((r: any) => r.id !== t.correct)?.id ?? null);
      const rt = resp === null ? null : Math.round(Math.max(160, 420 - 60 * THETA + (rng() - 0.5) * 160 + (t.condition === 'incongruent' ? 50 : 0)));
      clock += t.foreperiod_ms;
      const onset = clock;
      const rtc = rt === null ? null : Math.min(rt, t.response_window_ms - 1);
      // Trials whose stimulus stays up until a response end at the response; fixed-exposure paced trials run their full window.
      clock += t.stimulus_duration_ms === null ? (rtc ?? t.response_window_ms) + (b.mode === 'self_paced' ? 120 : 0) : Math.max(t.response_window_ms, rtc ?? 0);
      return { index: t.index, onset_ms: onset, response: resp, rt_ms: rtc, timing_quality: 'high' as const, focus_lost_ms: 0 };
    });
    const trials = b.duration_s ? timed.filter((t: any) => t.onset_ms <= b.duration_s * 1000) : timed;
    const r = await api('POST', `/sessions/${session.session_id}/blocks/${u.administration_id}/complete`, {
      sequence_hash: b.sequence_hash, attempt: b.attempt, status: 'completed', wall_ms: clock + 500, input_device: 'keyboard',
      device_profile: { frame_period_ms: 16.7, frame_jitter_ms: 0.8, input_latency_ms: 12, render_cost_ms: 2, refresh_hz: 60, device_class: 'desktop', presentation_api: false }, trials,
    });
    console.log(`  ${String(u.position).padStart(2)} ${u.plugin.id.padEnd(17)} ${u.task_type.padEnd(32)} ${String(u.source).padEnd(13)} ${String(u.modality).padEnd(6)} block → ${r.verdict}`);
    continue;
  }
  const keys: number[] = admin!.answer_key.kind === 'index' ? [admin!.answer_key.value] : admin!.answer_key.value;
  for (const [pi, key] of keys.entries()) {
    const perm = admin!.option_order[pi]!;
    const displayedKey = perm.indexOf(key);
    const choice = rng() < pCorrect ? displayedKey : (displayedKey + 1 + Math.floor(rng() * (perm.length - 1))) % perm.length;
    await api('POST', `/sessions/${session.session_id}/responses`, {
      response_uuid: crypto.randomUUID(), administration_id: u.administration_id, phase: u.protocol === 'single' ? 'present' : 'retrieve', probe_index: pi,
      raw_input: { choice }, rt_ms: Math.round(2500 + rng() * 4000), rt_source: 'event_timestamp', timing_quality: 'high', input_device: 'keyboard',
    });
  }
  console.log(`  ${String(u.position).padStart(2)} ${u.plugin.id.padEnd(17)} ${u.task_type.padEnd(32)} ${String(u.source).padEnd(13)} ${String(u.modality).padEnd(6)} b=${admin!.difficulty_b.toFixed(2)} p=${pCorrect.toFixed(2)}`);
}
const state = await api('GET', `/sessions/${session.session_id}/state`);
console.log('abilities', JSON.stringify(state.abilities));
const report = await api('GET', `/sessions/${session.session_id}/report`);
for (const d of report.domains as any[]) console.log(`  ${d.label.padEnd(20)} ${d.status.padEnd(18)} θ=${d.theta} se=${d.se} ci=${JSON.stringify(d.ci95)} items=${d.items}`);
console.log('generation', JSON.stringify(report.generation));
await pool.end();
