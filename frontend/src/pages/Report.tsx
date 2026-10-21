// Session report (Doc 05 §8, Doc 10 §6). Every score is shown with its interval; there is no
// composite score; measurement shortfalls are stated, not hidden.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Layout } from '../components/Layout';
import { Button, Card, Notice, Pill, Spinner } from '../components/ui';

type Domain = {
  plugin_id: string; label: string; blurb: string; caveat: string | null; status: 'scored' | 'insufficient_data' | 'unmeasured'; status_note: string | null;
  theta: number | null; se: number | null; ci95: [number, number] | null; band: { key: string; label: string } | null; reached_target_se: boolean; target_se: number;
  items: number; unmeasured_blocks: number; method: string | null; eap_mle_divergence: number | null;
  per_task_type: { task_type: string; description: string; component: string | null; items: number; accuracy: number | null; mean_rt_ms: number | null; blocks: { metric: string; value: number; derived: Record<string, unknown>; provisional_norm: boolean }[] }[];
  components: { component: string; task_types: { task_type: string }[] }[];
  substitutions: { from: string; to: string; reason: string }[];
};
type ReportT = Record<string, any> & { domains?: Domain[]; suppressed: boolean };

const human = (s: string) => s.replace(/_/g, ' ');
const fmt = (x: unknown, dp = 2) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(dp) : '—');

function IntervalScale({ d }: { d: Domain }) {
  const W = 560, H = 76, pad = 24;
  const x = (t: number) => pad + ((Math.max(-3, Math.min(3, t)) + 3) / 6) * (W - 2 * pad);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={d.theta === null ? 'No score' : `Score ${d.theta.toFixed(2)}, 95 percent interval ${d.ci95![0].toFixed(2)} to ${d.ci95![1].toFixed(2)}, on a scale from minus 3 to plus 3`}>
      <rect x={x(-3)} y={18} width={x(-0.67) - x(-3)} height={26} fill="var(--sunken)" />
      <rect x={x(-0.67)} y={18} width={x(0.67) - x(-0.67)} height={26} fill="var(--line)" opacity={0.45} />
      <rect x={x(0.67)} y={18} width={x(3) - x(0.67)} height={26} fill="var(--sunken)" />
      {[-3, -2, -1, 0, 1, 2, 3].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={44} y2={50} stroke="var(--muted)" strokeWidth={1.5} />
          <text x={x(t)} y={66} textAnchor="middle" fontSize={13} fill="var(--muted)">{t > 0 ? `+${t}` : t}</text>
        </g>
      ))}
      {d.ci95 && d.theta !== null && (
        <g>
          <line x1={x(d.ci95[0])} x2={x(d.ci95[1])} y1={31} y2={31} stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" />
          <circle cx={x(d.theta)} cy={31} r={9} fill="var(--surface)" stroke="var(--accent)" strokeWidth={4} />
        </g>
      )}
    </svg>
  );
}

export function Report() {
  const { id } = useParams();
  const [r, setR] = useState<ReportT | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void api<ReportT>('GET', `/sessions/${id}/report`).then(setR).catch((e) => setError(e.message)); }, [id]);

  if (error) return <Layout><Notice tone="bad" title="Report unavailable">{error} <Link className="underline" to={`/session/${id}`}>Return to the session</Link></Notice></Layout>;
  if (!r) return <Layout><Spinner label="Building your report" /></Layout>;
  if (r.suppressed) return (
    <Layout>
      <h1 className="mb-4 text-3xl font-semibold">{r.heading}</h1>
      <Notice tone="warn" title="No scores are shown for this session">{r.suppression_reason}</Notice>
    </Layout>
  );

  const q = r.quality;
  const c = r.context;
  return (
    <Layout wide>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{r.heading}</h1>
            <p className="text-muted">Session {c.session_index} · {new Date(r.generated_at).toLocaleString()} · ended because: {human(r.stop_reason ?? 'complete')}</p>
          </div>
          <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
        </div>
        <Notice title="How to read this">{r.disclaimer}</Notice>
        {q.dev_time_scale_note && <Notice tone="warn" title="Development mode">{q.dev_time_scale_note}</Notice>}

        <div className="grid gap-5 lg:grid-cols-2">
          {r.domains!.map((d) => (
            <Card key={d.plugin_id}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">{d.label}</h2>
                {d.status === 'scored' ? <Pill tone={d.reached_target_se ? 'good' : 'warn'}>{d.reached_target_se ? 'Measured to target precision' : 'Less precise than target'}</Pill> : <Pill tone="neutral">{d.status === 'unmeasured' ? 'Not measured' : 'Not enough data'}</Pill>}
              </div>
              <p className="mb-4 text-muted">{d.blurb}</p>
              {d.status === 'scored' ? (
                <>
                  <IntervalScale d={d} />
                  <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-muted">Score</dt><dd className="text-lg font-bold tabular">{fmt(d.theta)}</dd></div>
                    <div><dt className="text-muted">95 % interval</dt><dd className="text-lg font-bold tabular">{fmt(d.ci95![0])} to {fmt(d.ci95![1])}</dd></div>
                    <div><dt className="text-muted">Items</dt><dd className="text-lg font-bold tabular">{d.items}</dd></div>
                  </dl>
                  <p className="mt-3 text-sm"><span className="font-bold">{d.band?.label}.</span> The interval shows the range the score is likely to fall in; overlapping intervals mean results cannot be told apart.</p>
                </>
              ) : <p className="rounded-md bg-sunken p-3 text-sm">{d.status_note}</p>}
              {d.caveat && <p className="mt-3 text-sm text-muted">{d.caveat}</p>}
              {d.substitutions.length > 0 && <p className="mt-2 text-sm">Measured by a different route: {d.substitutions.map((s) => `${human(s.to)} instead of ${human(s.from)} (${s.reason})`).join('; ')}.</p>}
              {d.per_task_type.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer font-bold">Task detail</summary>
                  <table className="mt-2 w-full text-left text-sm">
                    <thead><tr className="text-muted"><th className="py-1 pr-2 font-normal">Task</th><th className="py-1 pr-2 font-normal">Part</th><th className="py-1 pr-2 font-normal">Items</th><th className="py-1 font-normal">Result</th></tr></thead>
                    <tbody>
                      {d.per_task_type.map((t) => (
                        <tr key={t.task_type} className="border-t border-line align-top">
                          <td className="py-1.5 pr-2">{human(t.task_type)}</td>
                          <td className="py-1.5 pr-2">{t.component ? human(t.component) : '—'}</td>
                          <td className="py-1.5 pr-2 tabular">{t.items}</td>
                          <td className="py-1.5 tabular">
                            {t.blocks.length ? t.blocks.map((b, i) => <div key={i}>{human(b.metric)}: {fmt(b.value, 1)}{b.provisional_norm ? ' (provisional norm)' : ''}</div>) : <>accuracy {t.accuracy === null ? '—' : `${Math.round(t.accuracy * 100)} %`}{t.mean_rt_ms ? ` · ${Math.round(t.mean_rt_ms)} ms` : ''}</>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {d.components.length > 0 && <p className="mt-2 text-xs text-muted">Sub-scores ({d.components.map((x) => human(x.component)).join(', ')}) are reported separately and never averaged.</p>}
                </details>
              )}
            </Card>
          ))}
        </div>

        <Card>
          <h2 className="mb-2 text-xl font-semibold">Comparing areas</h2>
          <p>{r.profile.reliable_difference ? `${r.profile.reliable_difference.higher} was reliably higher than ${r.profile.reliable_difference.lower} in this session (their 95 % intervals do not overlap).` : r.profile.note}</p>
          <p className="mt-2 text-sm text-muted">{r.no_composite_score}</p>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-xl font-semibold">How well this session measured</h2>
            <ul className="space-y-1.5 text-sm">
              <li>Items given: <b className="tabular">{q.items_administered}</b></li>
              <li>Timed blocks that could not be measured: <b className="tabular">{q.unmeasured_blocks}</b></li>
              <li>Trials with degraded timing: <b className="tabular">{q.degraded_timing_trials}</b></li>
              <li>Areas short of target precision: <b>{q.domains_short_of_target_se.length ? q.domains_short_of_target_se.join(', ') : 'none'}</b></li>
              <li>Items served from the prepared bank: <b className="tabular">{Math.round((q.tier_share.A + q.tier_share.B) * 100)} %</b></li>
            </ul>
            <p className="mt-3 text-sm text-muted">{q.provisional_parameters}</p>
          </Card>
          <Card>
            <h2 className="mb-3 text-xl font-semibold">Context</h2>
            <ul className="space-y-1.5 text-sm">
              <li>Device: <b>{c.device_class}</b>{c.refresh_hz ? `, ${c.refresh_hz} Hz display` : ''} · input: <b>{c.input_method}</b></li>
              <li>Test language: <b>{c.locale}</b> · first language: <b>{c.first_language}</b></li>
              <li>Education: <b>{c.education_years ?? 'not given'}</b>{c.education_years !== null ? ' years' : ''}{c.age_band ? <> · age group <b>{c.age_band}</b></> : null}</li>
              <li>{c.demographic_adjustment}</li>
            </ul>
            {c.practice_effect_note && <p className="mt-3 text-sm">{c.practice_effect_note}</p>}
          </Card>
        </div>

        {r.generation && (
          <Card>
            <h2 className="mb-2 text-xl font-semibold">How the questions were made</h2>
            <p>{r.generation.live_items} question{r.generation.live_items === 1 ? ' was' : 's were'} written live for this session; {r.generation.bank_fallback_items} came from the pre-checked bank because live generation was slow or unavailable.{r.generation.text_share !== null ? ` Text-based share: ${Math.round(r.generation.text_share * 100)} % (target ${Math.round(r.generation.target_text_share * 100)} %).` : ''}</p>
            <p className="mt-2 text-sm text-muted">{r.generation.note}</p>
          </Card>
        )}

        <Card>
          <h2 className="mb-2 text-xl font-semibold">Delayed recall</h2>
          {r.delayed_recall.pending.length ? <p>{r.delayed_recall.pending.length} follow-up question{r.delayed_recall.pending.length > 1 ? 's are' : ' is'} scheduled. Come back to <Link className="font-bold underline" to="/probes">Follow-up</Link> after {new Date(r.delayed_recall.pending[0].due_at).toLocaleDateString()}.</p> : <p>No follow-up questions are pending.</p>}
          <p className="mt-2 text-sm text-muted">{r.delayed_recall.note}</p>
        </Card>
      </div>
    </Layout>
  );
}
