// The signed-in user's dashboard: what to do next (resume or start), the latest finished test's
// scores, how each area has moved across tests, and every session with its type and status.
// Only finished full tests count as results; practice and quick checks are never scored, and a
// session closed automatically after being left is "abandoned", not complete.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BarChart3, CheckCircle2, CircleDashed, Clock, FlaskConical, GraduationCap, Play, XCircle, type LucideIcon } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Layout } from '../components/Layout';
import { buttonCls, Notice, Spinner } from '../components/ui';
import { DOMAINS, DomainIcon } from '../components/domains';

interface SessionRow { session_id: string; battery_id: string; mode: string; phase: string; session_index: number; started_at: string; completed_at: string | null; stop_reason: string | null; items: number; live_items: number; text_items: number; abilities: { dimension: string; theta: number; se: number; method: string; n: number }[] | null }
interface Meta { batteries: { battery_id: string; name: string; max_items: number }[] }
interface Point { session_id: string; session_index: number; completed_at: string; theta: number; se: number; ci95: [number, number] }
interface Progress { domains: { plugin_id: string; label: string; points: Point[] }[]; note: string }

const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One small multiple: a single series (θ over sessions) with a 95 % interval band; fixed −3…+3 axis. */
function Trend({ label, points }: { label: string; points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 170, L = 30, R = 12, T = 12, B = 26;
  const n = points.length;
  const x = (i: number) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (t: number) => T + ((3 - Math.max(-3, Math.min(3, t))) / 6) * (H - T - B);
  const band = n > 1 ? `M${points.map((p, i) => `${x(i)},${y(p.ci95[1])}`).join('L')}L${points.map((p, i) => `${x(n - 1 - i)},${y(points[n - 1 - i]!.ci95[0])}`).join('L')}Z` : '';
  const h = hover !== null ? points[hover] : null;
  return (
    <figure className="relative">
      <figcaption className="mb-1 font-semibold">{label}</figcaption>
      {n === 0 ? <p className="flex h-[170px] items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">No finished tests yet</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}: ${points.map((p) => `session ${p.session_index} score ${p.theta.toFixed(2)}`).join('; ')}`} onMouseLeave={() => setHover(null)}>
          {[-3, -1.5, 0, 1.5, 3].map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">{t > 0 ? `+${t}` : t}</text>
            </g>
          ))}
          {n > 1 && <path d={band} fill="var(--series-1)" opacity={0.16} />}
          {n > 1 && <polyline points={points.map((p, i) => `${x(i)},${y(p.theta)}`).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />}
          {n === 1 && <line x1={x(0)} x2={x(0)} y1={y(points[0]!.ci95[1])} y2={y(points[0]!.ci95[0])} stroke="var(--series-1)" strokeWidth={4} strokeLinecap="round" opacity={0.35} />}
          {points.map((p, i) => (
            <g key={p.session_id}>
              <circle cx={x(i)} cy={y(p.theta)} r={hover === i ? 6 : 4.5} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">#{p.session_index}</text>
              <rect x={x(i) - 16} y={T} width={32} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Session ${p.session_index}: ${p.theta.toFixed(2)}`} />
            </g>
          ))}
          {h && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />}
        </svg>
      )}
      {h && hover !== null && (
        <div className="pointer-events-none absolute z-10 rounded border border-line bg-surface px-3 py-2 text-xs shadow-sm" style={{ left: `${(x(hover) / W) * 100}%`, top: 24, transform: 'translateX(-50%)' }}>
          <p className="font-bold">Session {h.session_index} · {fmtDate(h.completed_at)}</p>
          <p className="tabular">Score {h.theta.toFixed(2)} (95 % {h.ci95[0].toFixed(2)} to {h.ci95[1].toFixed(2)})</p>
        </div>
      )}
    </figure>
  );
}

/** What a battery is for: only the full test produces scores. */
const KIND: Record<string, { label: string; icon: LucideIcon; tone: string; scored: boolean }> = {
  standard_5domain_v1: { label: 'Full test', icon: GraduationCap, tone: 'border-accent/30 bg-accent/10 text-accent', scored: true },
  screening_5domain_v1: { label: 'Quick check', icon: FlaskConical, tone: 'border-warn/30 bg-warn/10 text-warn', scored: false },
  practice_feedback_v1: { label: 'Practice', icon: Play, tone: 'border-line bg-sunken text-muted', scored: false },
};
const kindOf = (b: string) => KIND[b] ?? { label: b.split('_')[0]!, icon: GraduationCap, tone: 'border-line bg-sunken text-muted', scored: false };

type Status = 'complete' | 'abandoned' | 'in_progress';
const statusOf = (s: SessionRow): Status => (s.phase !== 'done' ? 'in_progress' : s.stop_reason === 'abandoned' ? 'abandoned' : 'complete');
const STATUS: Record<Status, { label: string; icon: LucideIcon; cls: string }> = {
  complete: { label: 'Complete', icon: CheckCircle2, cls: 'text-good' },
  in_progress: { label: 'In progress', icon: CircleDashed, cls: 'text-accent' },
  abandoned: { label: 'Not finished', icon: XCircle, cls: 'text-muted' },
};

function Kpi({ label, value, sub, icon: Icon }: { label: string; value: React.ReactNode; sub?: string; icon: LucideIcon }) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between text-muted"><span className="text-sm font-medium">{label}</span><Icon size={16} className="text-faint" /></div>
      <p className="mt-3 font-display text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** One area's score on the fixed −3…+3 scale, with its 95 % interval as a band. */
function ScoreRow({ id, label, theta, se }: { id: string; label: string; theta: number; se: number }) {
  const pos = (t: number) => `${((Math.max(-3, Math.min(3, t)) + 3) / 6) * 100}%`;
  const lo = theta - 1.96 * se, hi = theta + 1.96 * se;
  return (
    <div className="flex items-center gap-4 py-3">
      <DomainIcon id={id} size={16} />
      <div className="w-36 shrink-0">
        <p className="font-medium">{label}</p>
        <p className="text-xs tabular-nums text-muted">{theta >= 0 ? '+' : ''}{theta.toFixed(2)} · ±{(1.96 * se).toFixed(2)}</p>
      </div>
      <div className="relative h-8 flex-1" role="img" aria-label={`${label}: score ${theta.toFixed(2)}, 95 % interval ${lo.toFixed(2)} to ${hi.toFixed(2)}`}>
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-strong" style={{ left: '50%' }} />
        <div className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})`, background: 'var(--series-1)', opacity: 0.22 }} />
        <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]" style={{ left: pos(theta), background: 'var(--series-1)' }} />
      </div>
    </div>
  );
}

export function History() {
  const { me } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    void Promise.all([api<{ sessions: SessionRow[] }>('GET', '/me/sessions'), api<Progress>('GET', '/me/progress'), api<Meta>('GET', '/meta')])
      .then(([s, p, m]) => { setSessions(s.sessions); setProgress(p); setMeta(m); })
      .catch((e) => setError(e.message));
  }, []);

  const d = useMemo(() => {
    const all = sessions ?? [];
    const finishedTests = all.filter((s) => statusOf(s) === 'complete' && kindOf(s.battery_id).scored);
    const open = all.filter((s) => statusOf(s) === 'in_progress');
    const items = all.reduce((a, s) => a + s.items, 0);
    const live = all.reduce((a, s) => a + s.live_items, 0);
    const latest = finishedTests[0] ?? null;
    return { finishedTests, open, items, live, latest, resume: open[0] ?? null };
  }, [sessions]);
  const maxItems = (b: string) => meta?.batteries.find((x) => x.battery_id === b)?.max_items ?? 36;
  const anyTrend = (progress?.domains ?? []).some((x) => x.points.length > 0);
  const shown = showAll ? sessions ?? [] : (sessions ?? []).slice(0, 6);

  return (
    <Layout wide>
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header with the next step */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-1.5">Dashboard</p>
            <h1 className="text-3xl font-semibold sm:text-4xl">Welcome back{me ? `, ${me.user.username}` : ''}</h1>
            <p className="mt-1 text-muted">Member since {me ? fmtDate(me.user.created_at) : ''}</p>
          </div>
          <Link to="/start" className={buttonCls('primary', 'lg')}>Start a new test <ArrowRight size={16} /></Link>
        </div>

        {error && <Notice tone="bad" title="Could not load your dashboard">{error}</Notice>}
        {!sessions || !progress ? <Spinner /> : (
          <>
            {d.resume && (
              <div className="panel flex flex-wrap items-center gap-5 p-5" style={{ background: 'linear-gradient(120deg, rgb(var(--c-accent) / 0.10), rgb(var(--c-surface)) 55%)' }}>
                <span className="icon-tile !h-12 !w-12"><Play size={20} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Continue your {kindOf(d.resume.battery_id).label.toLowerCase()}</p>
                  <p className="text-sm text-muted">Started {fmtDate(d.resume.started_at)} · {d.resume.items} of up to {maxItems(d.resume.battery_id)} questions answered. Unfinished sessions close 24 hours after they were last used.</p>
                  <div className="progress-track mt-3 max-w-md"><div className="progress-fill" style={{ width: `${Math.min(100, (100 * d.resume.items) / maxItems(d.resume.battery_id))}%` }} /></div>
                </div>
                <Link to={`/session/${d.resume.session_id}`} className={buttonCls('primary')}>Resume <ArrowRight size={15} /></Link>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Finished tests" value={d.finishedTests.length} sub="Full tests that produced scores" icon={GraduationCap} />
              <Kpi label="In progress" value={d.open.length} sub="Can be resumed" icon={Clock} />
              <Kpi label="Questions answered" value={d.items} sub="Across all sessions" icon={BarChart3} />
              <Kpi label="Written live for you" value={`${d.items ? Math.round((100 * d.live) / d.items) : 0} %`} sub="The rest came from checked, stored questions" icon={CheckCircle2} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              {/* Latest result */}
              <section className="panel p-6">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold">Latest result</h2>
                  {d.latest && <Link to={`/session/${d.latest.session_id}/report`} className="text-sm font-medium text-accent hover:underline">Full report →</Link>}
                </div>
                {d.latest ? (
                  <>
                    <p className="mb-2 text-sm text-muted">Full test #{d.latest.session_index} · {fmtDate(d.latest.completed_at ?? d.latest.started_at)}. 0 is the middle of the scale; the band is the 95 % range.</p>
                    <div className="divide-y divide-line/70">
                      {DOMAINS.map((dm) => {
                        const a = d.latest!.abilities?.find((x) => x.dimension === dm.id);
                        return a ? <ScoreRow key={dm.id} id={dm.id} label={dm.name} theta={a.theta} se={a.se} />
                          : <div key={dm.id} className="flex items-center gap-4 py-3"><DomainIcon id={dm.id} size={16} /><p className="w-36 font-medium">{dm.name}</p><p className="text-sm text-muted">Not measured</p></div>;
                      })}
                    </div>
                  </>
                ) : (
                  <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
                    <span className="icon-tile"><GraduationCap size={19} /></span>
                    <p className="mt-4 font-semibold">No finished test yet</p>
                    <p className="mt-1 max-w-sm text-sm text-muted">Finish a full test (about 25 minutes) to see a score for each area here. Practice runs and quick checks are not scored.</p>
                    <Link to={d.resume ? `/session/${d.resume.session_id}` : '/start'} className={`${buttonCls('primary')} mt-5`}>{d.resume ? 'Resume your test' : 'Start a full test'}</Link>
                  </div>
                )}
              </section>

              {/* Session types, explained */}
              <section className="panel p-6">
                <h2 className="mb-4 text-xl font-semibold">Session types</h2>
                <ul className="space-y-3">
                  {[
                    ['standard_5domain_v1', 'Adaptive, about 25 minutes. The only type that gives you scores.'],
                    ['screening_5domain_v1', 'Two questions per area, about 10 minutes. A rough check; not reported as scores.'],
                    ['practice_feedback_v1', 'Five questions that show whether you were right. For getting used to the tasks; never scored.'],
                  ].map(([b, text]) => {
                    const k = kindOf(b!);
                    return (
                      <li key={b} className="flex items-start gap-3 rounded-xl border border-line/80 p-3.5">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${k.tone}`}><k.icon size={16} /></span>
                        <span><span className="block font-medium">{k.label}</span><span className="text-sm text-muted">{text}</span></span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>

            {/* Trends: only when there is something to draw */}
            <section className="panel p-6">
              <h2 className="text-xl font-semibold">Scores across tests</h2>
              {anyTrend ? (
                <>
                  <p className="mb-5 mt-1 text-sm text-muted">Each point is one finished full test; the shaded band is its 95 % interval. {progress.note}</p>
                  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {progress.domains.map((x) => <Trend key={x.plugin_id} label={x.label} points={x.points} />)}
                  </div>
                  <details className="mt-5">
                    <summary className="cursor-pointer text-sm font-medium">Show as a table</summary>
                    <table className="mt-2 w-full text-left text-sm">
                      <thead><tr className="text-xs uppercase tracking-wide text-muted"><th className="py-1 font-medium">Area</th><th className="font-medium">Test</th><th className="font-medium">Date</th><th className="font-medium">Score</th><th className="font-medium">95 % interval</th></tr></thead>
                      <tbody>{progress.domains.flatMap((x) => x.points.map((pt) => (
                        <tr key={`${x.plugin_id}-${pt.session_id}`} className="border-t border-line"><td className="py-1.5">{x.label}</td><td className="tabular">#{pt.session_index}</td><td>{fmtDate(pt.completed_at)}</td><td className="tabular">{pt.theta.toFixed(2)}</td><td className="tabular">{pt.ci95[0].toFixed(2)} to {pt.ci95[1].toFixed(2)}</td></tr>
                      )))}</tbody>
                    </table>
                  </details>
                </>
              ) : (
                <p className="mt-1 text-sm text-muted">Your trend for each area appears here after your first finished full test, and becomes a line from the second one on.</p>
              )}
            </section>

            {/* Sessions */}
            <section className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
                <h2 className="text-xl font-semibold">All sessions</h2>
                <span className="text-sm text-muted">{sessions.length} total</span>
              </div>
              {!sessions.length ? <p className="px-6 pb-6 text-muted">No sessions yet.</p> : (
                <ul className="divide-y divide-line/70 border-t border-line/70">
                  {shown.map((s) => {
                    const k = kindOf(s.battery_id);
                    const st = STATUS[statusOf(s)];
                    const pct = Math.min(100, (100 * s.items) / maxItems(s.battery_id));
                    return (
                      <li key={s.session_id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-6 py-4">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${k.tone}`}><k.icon size={17} /></span>
                        <div className="min-w-[160px] flex-1">
                          <p className="font-medium">{k.label} <span className="font-normal text-muted">#{s.session_index}</span></p>
                          <p className="text-sm text-muted">{fmtDate(s.started_at)} · {s.items} question{s.items === 1 ? '' : 's'}{s.items ? ` · ${Math.round((100 * s.live_items) / s.items)} % written live` : ''}</p>
                        </div>
                        <div className="hidden w-40 sm:block" aria-hidden="true">
                          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%`, opacity: statusOf(s) === 'abandoned' ? 0.35 : 1 }} /></div>
                        </div>
                        <span className={`flex w-28 items-center gap-1.5 text-sm font-medium ${st.cls}`}><st.icon size={15} /> {st.label}</span>
                        <span className="w-20 text-right">
                          {statusOf(s) === 'in_progress' ? <Link className="text-sm font-medium text-accent hover:underline" to={`/session/${s.session_id}`}>Resume</Link>
                            : statusOf(s) === 'complete' ? <Link className="text-sm font-medium text-accent hover:underline" to={`/session/${s.session_id}/report`}>Report</Link>
                            : <span className="text-sm text-faint">—</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {sessions.length > 6 && (
                <div className="border-t border-line/70 px-6 py-3 text-center">
                  <button type="button" onClick={() => setShowAll(!showAll)} className="text-sm font-medium text-accent hover:underline">{showAll ? 'Show fewer' : `Show all ${sessions.length}`}</button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Layout>
  );
}
