// The signed-in user's history: every session (resume or open its report) and, per domain, how the
// score has moved across completed sessions — each point with its 95 % interval.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Layout } from '../components/Layout';
import { buttonCls, Card, Eyebrow, Notice, Pill, Spinner, Stat } from '../components/ui';

interface SessionRow { session_id: string; battery_id: string; mode: string; phase: string; session_index: number; started_at: string; completed_at: string | null; stop_reason: string | null; items: number; live_items: number; text_items: number }
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
      <figcaption className="mb-1 font-bold">{label}</figcaption>
      {n === 0 ? <p className="flex h-[170px] items-center justify-center rounded-md bg-sunken text-sm text-muted">No scored sessions yet</p> : (
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

export function History() {
  const { me } = useAuth();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([api<{ sessions: SessionRow[] }>('GET', '/me/sessions'), api<Progress>('GET', '/me/progress')])
      .then(([s, p]) => { setSessions(s.sessions); setProgress(p); })
      .catch((e) => setError(e.message));
  }, []);
  const totals = useMemo(() => {
    const done = (sessions ?? []).filter((s) => s.phase === 'done');
    const items = (sessions ?? []).reduce((a, s) => a + s.items, 0);
    const live = (sessions ?? []).reduce((a, s) => a + s.live_items, 0);
    return { done: done.length, items, live };
  }, [sessions]);

  return (
    <Layout wide>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <Eyebrow>your record</Eyebrow>
          <h1 className="text-3xl font-semibold">My history</h1>
          <p className="text-muted">{me?.user.username} · member since {me ? fmtDate(me.user.created_at) : ''}</p>
        </div>
        {error && <Notice tone="bad" title="Could not load your history">{error}</Notice>}
        {!sessions || !progress ? <Spinner /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Completed sessions" value={totals.done} />
              <Stat label="Questions answered" value={totals.items} />
              <Stat label="Written live for you" value={`${totals.items ? Math.round((100 * totals.live) / totals.items) : 0} %`} />
            </div>

            <Card>
              <h2 className="mb-1 text-xl font-semibold">Scores across sessions</h2>
              <p className="mb-5 text-sm text-muted">Each point is one completed session; the shaded band is its 95 % interval. {progress.note}</p>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {progress.domains.map((d) => <Trend key={d.plugin_id} label={d.label} points={d.points} />)}
              </div>
              <details className="mt-5">
                <summary className="cursor-pointer font-bold">Show as a table</summary>
                <table className="mt-2 w-full text-left text-sm">
                  <thead><tr className="font-mono text-xs uppercase tracking-wide text-muted"><th className="py-1 font-normal">Area</th><th className="font-normal">Session</th><th className="font-normal">Date</th><th className="font-normal">Score</th><th className="font-normal">95 % interval</th></tr></thead>
                  <tbody>{progress.domains.flatMap((d) => d.points.map((p) => (
                    <tr key={`${d.plugin_id}-${p.session_id}`} className="border-t border-line"><td className="py-1.5">{d.label}</td><td className="tabular">#{p.session_index}</td><td>{fmtDate(p.completed_at)}</td><td className="tabular">{p.theta.toFixed(2)}</td><td className="tabular">{p.ci95[0].toFixed(2)} to {p.ci95[1].toFixed(2)}</td></tr>
                  )))}</tbody>
                </table>
              </details>
            </Card>

            <Card>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Sessions</h2>
                <Link to="/start" className={buttonCls()}>Start a new session</Link>
              </div>
              {!sessions.length ? <p className="text-muted">No sessions yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead><tr className="font-mono text-xs uppercase tracking-wide text-muted"><th className="py-1 font-normal">#</th><th className="font-normal">Started</th><th className="font-normal">Type</th><th className="font-normal">Questions</th><th className="font-normal">Live / text</th><th className="font-normal">Status</th><th className="font-normal" /></tr></thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.session_id} className="border-t border-line">
                          <td className="py-2 tabular">{s.session_index}</td>
                          <td>{fmtDate(s.started_at)}</td>
                          <td>{s.battery_id.split('_')[0]} {s.mode === 'live' ? <Pill tone="accent">live</Pill> : null}</td>
                          <td className="tabular">{s.items}</td>
                          <td className="tabular">{s.items ? `${Math.round((100 * s.live_items) / s.items)} % / ${Math.round((100 * s.text_items) / s.items)} %` : '—'}</td>
                          <td>{s.phase === 'done' ? (s.stop_reason === 'abandoned' ? 'Abandoned' : 'Complete') : 'In progress'}</td>
                          <td className="text-right">{s.phase === 'done' ? <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/session/${s.session_id}/report`}>Report</Link> : <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/session/${s.session_id}`}>Resume</Link>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
