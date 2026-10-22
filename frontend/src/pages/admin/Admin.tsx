// Admin / authoring console: bank health (coverage matrix, tiers, provider, spend), the human review
// queue with the six-question rubric (Doc 10 §2.1), generation jobs and the reject-reason histogram
// (Doc 10 §2.2 — "reject-reason telemetry is the product"), prompt versions, manual top-up.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { Layout, Wordmark } from '../../components/Layout';
import { Button, Card, Field, Notice, Pill, Spinner, Svg, inputCls } from '../../components/ui';
import { load, save } from '../../store';
import { PluginDocs } from './PluginDocs';
import { Settings } from './Settings';

const human = (s: string) => s.replace(/_/g, ' ');

function useAdmin<T>(path: string, token: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    void api<T>('GET', path, undefined, token).then(setData).catch((e) => setError(e.message));
  }, [path, token]);
  useEffect(reload, [reload, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}

function AdminLogin({ onToken }: { onToken: (t: string) => void }) {
  const { me, refresh, logout } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState('');
  const [useToken, setUseToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedInNotAdmin = me && me.user.role !== 'admin';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (me) await logout();
      const r = await api<{ user: { role: string } }>('POST', '/auth/login', { username, password });
      await refresh();
      if (r.user.role !== 'admin') setError('This account is not an admin. On the server run: npm run admin:grant -- ' + username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
    setBusy(false);
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between"><Wordmark /><Link to="/" className="text-sm text-muted hover:text-ink">← Back to site</Link></div>
        <div className="panel p-7">
          <span className="icon-tile"><ShieldCheck size={19} /></span>
          <h1 className="mt-5 text-2xl font-semibold">Admin sign in</h1>
          <p className="mt-1 text-sm text-muted">The authoring console: bank health, review, prompts and generation settings.</p>
          {signedInNotAdmin && <div className="mt-4"><Notice>You are signed in as <b>{me!.user.username}</b>, which is not an admin account. Sign in with an admin account below.</Notice></div>}
          {!useToken ? (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              <Field id="a-user" label="Username"><input id="a-user" className={inputCls} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
              <Field id="a-pass" label="Password"><input id="a-pass" type="password" className={inputCls} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {error && <Notice tone="bad">{error}</Notice>}
              <Button type="submit" size="lg" className="w-full" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</Button>
            </form>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); save('admin_token', draft, true); onToken(draft); }} className="mt-6 space-y-4">
              <Field id="a-token" label="Admin token" hint="ADMIN_TOKEN from the server's .env; kept for this browser tab only."><input id="a-token" type="password" className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="off" /></Field>
              <Button type="submit" size="lg" className="w-full" disabled={!draft}>Continue</Button>
            </form>
          )}
          <button type="button" onClick={() => { setUseToken(!useToken); setError(null); }} className="mt-5 w-full text-center text-sm text-muted hover:text-ink">{useToken ? 'Sign in with an admin account instead' : 'Use the admin token instead'}</button>
        </div>
        <p className="mt-4 text-center text-xs text-faint">Make an account an admin with <code className="font-mono">npm run admin:grant -- &lt;username&gt;</code></p>
      </div>
    </div>
  );
}

export function Admin() {
  const { me, loading, logout } = useAuth();
  const [token, setToken] = useState(load<string>('admin_token', '', true));
  const isAdmin = me?.user.role === 'admin';
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner /></div>;
  if (!token && !isAdmin) return <AdminLogin onToken={setToken} />;
  const signOut = async () => { save('admin_token', '', true); setToken(''); if (isAdmin) await logout(); };
  const tabs = [['', 'Bank health'], ['review', 'Review queue'], ['jobs', 'Jobs & rejections'], ['prompts', 'Prompts'], ['generate', 'Generate'], ['settings', 'Settings'], ['docs', 'Test designs']];
  return (
    <Layout wide>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Admin</p>
          <h1 className="text-3xl font-semibold">Authoring console</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="chip">{isAdmin ? me!.user.username : 'token'}</span>
          <Button variant="ghost" onClick={signOut}>Sign out</Button>
        </div>
      </div>
      <nav aria-label="Admin sections" className="mb-6 flex flex-wrap gap-1 border-b border-line">
        {tabs.map(([to, label]) => (
          <NavLink key={to} end to={`/admin/${to}`} className={({ isActive }) => `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${isActive ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{label}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<BankHealth token={token} />} />
        <Route path="review" element={<Review token={token} />} />
        <Route path="jobs" element={<Jobs token={token} />} />
        <Route path="prompts" element={<Prompts token={token} />} />
        <Route path="generate" element={<Generate token={token} />} />
        <Route path="settings" element={<Settings token={token} />} />
        <Route path="docs" element={<PluginDocs />} />
      </Routes>
    </Layout>
  );
}

type Cell = { plugin_id: string; task_type: string; locale: string; b_band: number; live: number; fresh: number; validated: number; quarantined: number; k_min: number; deficit: number; alarm: boolean; demand_7d: number };

function BankHealth({ token }: { token: string }) {
  const { data, error, reload } = useAdmin<any>('/admin/bank/health', token);
  const [locale, setLocale] = useState('en');
  const grouped = useMemo(() => {
    const m = new Map<string, Map<string, Cell[]>>();
    for (const c of (data?.cells ?? []) as Cell[]) {
      if (c.locale !== locale) continue;
      if (!m.has(c.plugin_id)) m.set(c.plugin_id, new Map());
      const t = m.get(c.plugin_id)!;
      t.set(c.task_type, [...(t.get(c.task_type) ?? []), c]);
    }
    return m;
  }, [data, locale]);
  if (error) return <Notice tone="bad" title="Could not load bank health">{error}</Notice>;
  if (!data) return <Spinner />;
  const bands = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3];
  const tiers = Object.fromEntries((data.tiers as { tier: string; n: number }[]).map((t) => [t.tier, t.n]));
  const servedTotal = Object.values(tiers).reduce((a: number, b) => a + (b as number), 0) || 1;
  const statuses = Object.fromEntries((data.status_counts as { status: string; n: number }[]).map((s) => [s.status, s.n]));
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="!p-5"><p className="text-sm text-muted">Live items</p><p className="text-3xl font-bold tabular">{statuses.live ?? 0}</p><p className="text-sm text-muted">{statuses.validated ?? 0} awaiting review · {statuses.quarantined ?? 0} quarantined</p></Card>
        <Card className="!p-5"><p className="text-sm text-muted">Served from bank (24 h)</p><p className="text-3xl font-bold tabular">{Math.round((((tiers.A ?? 0) + (tiers.B ?? 0)) / (servedTotal as number)) * 100)} %</p><p className="text-sm text-muted">Tier C live generation: {tiers.C ?? 0} {(tiers.C ?? 0) / (servedTotal as number) > 0.05 ? '— above the 5 % alarm' : ''}</p></Card>
        <Card className="!p-5"><p className="text-sm text-muted">Model provider</p><p className="text-xl font-bold">{data.provider.id} / {data.provider.model}</p><p className="text-sm">{data.provider.degraded ? <Pill tone="bad">Degraded: bank-only</Pill> : <Pill tone="good">Reachable</Pill>}</p></Card>
        <Card className="!p-5"><p className="text-sm text-muted">Spend today</p><p className="text-3xl font-bold tabular">${Number(data.spend_today_usd).toFixed(3)}</p><p className="text-sm text-muted">cap ${data.daily_cap_usd} — above it W1 degrades to bank-only</p></Card>
      </div>
      {data.breakers.length > 0 && <Notice tone="warn" title={`${data.breakers.length} cell circuit breaker(s) open`}>Generation is paused for cells that rejected over 60 % of items in three consecutive jobs. The reject histogram on the Jobs tab is the input to the next prompt revision.</Notice>}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Coverage matrix</h2>
            <p className="text-sm text-muted">Live items per (task type, difficulty band). Each cell shows live / K<sub>min</sub>; marked cells are below half of K<sub>min</sub>.</p>
          </div>
          <div className="flex gap-2">
            {['en', 'en-IN'].map((l) => <Button key={l} variant={locale === l ? 'primary' : 'secondary'} onClick={() => setLocale(l)}>{l}</Button>)}
            <Button variant="ghost" onClick={reload}>Refresh</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-1 text-sm">
            <thead><tr><th className="text-left font-normal text-muted">Task type</th>{bands.map((b) => <th key={b} className="w-14 font-normal text-muted tabular">{b > 0 ? `+${b}` : b}</th>)}</tr></thead>
            <tbody>
              {[...grouped.entries()].map(([plugin, tts]) => (
                [<tr key={plugin}><td colSpan={14} className="pt-3 font-bold">{human(plugin)}</td></tr>,
                ...[...tts.entries()].map(([tt, cells]) => (
                  <tr key={tt}>
                    <td className="pr-2 text-muted">{human(tt)}</td>
                    {bands.map((b) => {
                      const c = cells.find((x) => Math.abs(x.b_band - b) < 0.3 && Math.abs(x.b_band - b) === Math.min(...cells.map((y) => Math.abs(y.b_band - b))));
                      if (!c || Math.abs(c.b_band - b) > 0.25) return <td key={b} className="rounded bg-sunken/40" />;
                      const ratio = Math.min(1, c.live / c.k_min);
                      return (
                        <td key={b} title={`${human(tt)} b=${c.b_band}: ${c.live} live, ${c.fresh} fresh, ${c.validated} awaiting review, K_min ${c.k_min}`}
                          className={`rounded text-center tabular ${c.alarm ? 'border-2 border-bad font-bold' : 'border border-line'}`}
                          style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(ratio * 55)}%, var(--surface))` }}>
                          {c.live}<span className="text-muted">/{c.k_min}</span>{c.alarm ? ' !' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))]
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-xl font-semibold">Generation (7 days)</h2>
          <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th className="font-normal">Plugin</th><th className="font-normal">Jobs</th><th className="font-normal">Accepted</th><th className="font-normal">Reject rate</th><th className="font-normal">p95 latency</th></tr></thead>
            <tbody>{(data.generation as any[]).map((g) => {
              const rate = g.accepted + g.rejected ? g.rejected / (g.accepted + g.rejected) : 0;
              return <tr key={g.plugin_id} className="border-t border-line"><td className="py-1.5">{human(g.plugin_id)}</td><td className="tabular">{g.jobs}</td><td className="tabular">{g.accepted}</td><td className="tabular">{Math.round(rate * 100)} % {rate > 0.25 ? <Pill tone="warn">above 25 %</Pill> : null}</td><td className="tabular">{g.p95 ? `${Math.round(g.p95)} ms` : '—'}</td></tr>;
            })}</tbody></table>
        </Card>
        <Card>
          <h2 className="mb-3 text-xl font-semibold">Median SE at stop</h2>
          {data.se_at_stop.length ? <ul className="space-y-1 text-sm">{(data.se_at_stop as any[]).map((s) => <li key={s.dimension}>{human(s.dimension)}: <b className="tabular">{Number(s.median).toFixed(2)}</b> {s.median > 0.4 ? <Pill tone="warn">above 0.40</Pill> : null}</li>)}</ul> : <p className="text-muted">No completed sessions yet.</p>}
        </Card>
      </div>
    </div>
  );
}

const RUBRIC: [string, string][] = [
  ['construct', 'Construct: could a test-taker answer this without using the ability this domain measures? (Tick if they could NOT.)'],
  ['key', 'Key: exactly one option is defensibly correct and each distractor defensibly wrong.'],
  ['leakage', 'Leakage: looking only at the options, the key is not identifiable.'],
  ['levers', 'Levers: the item realises the lever values it claims.'],
  ['fairness', 'Fairness: it would not be harder for someone of equal ability with a different education, language, locale or sensory profile.'],
  ['dignity', 'Dignity: comfortable showing it to someone anxious about their cognition.'],
];

function ItemPreview({ item }: { item: any }) {
  const r = item.rendering;
  if (!r) return <pre className="max-h-60 overflow-auto rounded-md bg-sunken p-3 text-xs">{JSON.stringify(item.blueprint, null, 2)}</pre>;
  if (r.figure_svg) return (
    <div className="space-y-3">
      <p className="font-bold">{r.stem}</p>
      <div className="stage max-w-[280px]"><Svg svg={r.figure_svg} /></div>
      <div className="flex flex-wrap gap-2">{r.options.map((o: string, i: number) => <div key={i} className={`stage w-20 rounded border-2 p-1 ${item.answer_key.value === i ? 'border-accent' : 'border-line'}`}><Svg svg={o} /></div>)}</div>
    </div>
  );
  if (r.encode) return (
    <div className="space-y-3 text-sm">
      <p className="font-bold">Encode ({r.encode.length}):</p>
      <div className="flex flex-wrap gap-2">{r.encode.map((e: any, i: number) => e.svg ? <div key={i} className="stage w-16"><Svg svg={e.svg} /></div> : <Pill key={i}>{e.text}</Pill>)}</div>
      {r.probes.map((p: any, pi: number) => (
        <div key={pi}><p className="font-bold">{p.stem}</p><div className="flex flex-wrap gap-2">{p.options.map((o: string, i: number) => {
          const key = item.answer_key.value[pi] === i;
          return o.startsWith('<svg') ? <div key={i} className={`stage w-14 rounded border-2 ${key ? 'border-accent' : 'border-line'}`}><Svg svg={o} /></div> : <Pill key={i} tone={key ? 'accent' : 'neutral'}>{o}</Pill>;
        })}</div></div>
      ))}
    </div>
  );
  return (
    <div className="space-y-2">
      <p className="font-bold">{r.stem}</p>
      <div className="flex flex-wrap gap-2">{(r.options ?? []).map((o: string, i: number) => <Pill key={i} tone={item.answer_key.value === i ? 'accent' : 'neutral'}>{o}</Pill>)}</div>
    </div>
  );
}

function Review({ token }: { token: string }) {
  const [status, setStatus] = useState('validated');
  const { data, error, reload } = useAdmin<{ items: any[] }>(`/admin/items?status=${status}&limit=20`, token, [status]);
  const [reviewer, setReviewer] = useState(load('reviewer', ''));
  const [checks, setChecks] = useState<Record<string, Record<string, boolean>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const decide = async (id: string) => {
    const rubric = Object.fromEntries(RUBRIC.map(([k]) => [k, !!checks[id]?.[k]]));
    try {
      save('reviewer', reviewer);
      const r = await api<{ status: string }>('POST', `/admin/items/${id}/promote`, { rubric, reviewer: reviewer || 'reviewer', notes: '' }, token);
      setMsg(`Item ${id.slice(0, 8)} → ${r.status}`);
      reload();
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <div className="space-y-4">
      <Card className="!p-5">
        <div className="flex flex-wrap items-end gap-4">
          <Field id="rev" label="Reviewer name"><input id="rev" className={inputCls} value={reviewer} onChange={(e) => setReviewer(e.target.value)} /></Field>
          <Field id="st" label="Queue">
            <select id="st" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}><option value="validated">Validated (awaiting review)</option><option value="quarantined">Quarantined</option><option value="live">Live (sample)</option></select>
          </Field>
        </div>
        <p className="mt-3 text-sm text-muted">Items are shown without their difficulty band. Any unticked question rejects the item (it is retired); all six ticked promotes it to live with a human-review record.</p>
      </Card>
      {msg && <Notice>{msg}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {!data ? <Spinner /> : !data.items.length ? <Card><p>The queue is empty.</p></Card> : data.items.map((it) => (
        <Card key={it.item_id}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill tone="accent">{human(it.plugin_id)}</Pill><Pill>{human(it.task_type)}</Pill><Pill>{it.locale}</Pill>
            {(it.validations ?? []).map((v: any) => <Pill key={v.gate} tone={v.verdict === 'pass' ? 'good' : v.verdict === 'warn' ? 'warn' : 'bad'}>{v.gate}: {v.verdict}</Pill>)}
            <span className="text-sm text-muted">{it.review?.notes}</span>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div><ItemPreview item={it} /><p className="mt-3 text-sm"><b>Rationale:</b> {it.rationale}</p><p className="mt-1 text-xs text-muted">prompt {it.prompt_version}</p></div>
            {it.status !== 'live' && (
              <div className="space-y-2">
                {RUBRIC.map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer gap-3 text-sm">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={!!checks[it.item_id]?.[k]} onChange={(e) => setChecks({ ...checks, [it.item_id]: { ...checks[it.item_id], [k]: e.target.checked } })} />
                    <span>{label}</span>
                  </label>
                ))}
                <Button onClick={() => decide(it.item_id)}>Record review</Button>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Jobs({ token }: { token: string }) {
  const jobs = useAdmin<{ jobs: any[] }>('/admin/jobs?limit=40', token);
  const rej = useAdmin<{ histogram: any[]; recent: any[] }>('/admin/rejections?days=7', token);
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-1 text-xl font-semibold">Reject reasons (7 days)</h2>
        <p className="mb-3 text-sm text-muted">Every rejection is a row with gate, reason, plugin, task type and prompt version. This histogram is the input to prompt revision.</p>
        {!rej.data ? <Spinner /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead><tr className="text-left text-muted"><th className="font-normal">Gate</th><th className="font-normal">Reason</th><th className="font-normal">Task type</th><th className="font-normal">Prompt</th><th className="font-normal">Count</th></tr></thead>
            <tbody>{rej.data.histogram.map((h, i) => <tr key={i} className="border-t border-line"><td className="py-1.5">{h.gate}</td><td>{human(h.reason_code)}</td><td>{human(h.task_type)}</td><td className="font-mono text-xs">{h.prompt_version}</td><td className="tabular font-bold">{h.n}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Recent generation jobs</h2>
        {!jobs.data ? <Spinner /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead><tr className="text-left text-muted"><th className="font-normal">When</th><th className="font-normal">Kind</th><th className="font-normal">Cell</th><th className="font-normal">State</th><th className="font-normal">Req / acc / rej</th><th className="font-normal">Cost</th><th className="font-normal">Latency</th></tr></thead>
            <tbody>{jobs.data.jobs.map((j) => <tr key={j.job_id} className="border-t border-line"><td className="py-1.5">{new Date(j.created_at).toLocaleTimeString()}</td><td>{human(j.kind)}</td><td>{human(j.task_type)} · {j.locale} · b={j.b_band}</td><td>{j.state}{j.error ? ` (${j.error})` : ''}</td><td className="tabular">{j.requested} / {j.accepted} / {j.rejected}</td><td className="tabular">${Number(j.cost_usd ?? 0).toFixed(4)}</td><td className="tabular">{j.latency_ms ?? '—'} ms</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </div>
  );
}

function Prompts({ token }: { token: string }) {
  const { data, error, reload } = useAdmin<{ prompts: any[] }>('/admin/prompts', token);
  const [open, setOpen] = useState<string | null>(null);
  const activate = async (v: string) => { await api('POST', `/admin/prompts/${encodeURIComponent(v)}/activate`, {}, token).catch(() => {}); reload(); };
  if (error) return <Notice tone="bad">{error}</Notice>;
  if (!data) return <Spinner />;
  return (
    <Card>
      <h2 className="mb-1 text-xl font-semibold">Prompt versions</h2>
      <p className="mb-4 text-sm text-muted">Every layer body is a hashed row; nothing reaches a model that is not in this table. L1 is compiled from each plugin manifest at boot. Activating a version puts its first items on probation (human review).</p>
      <div className="space-y-2">
        {data.prompts.map((p) => (
          <div key={p.prompt_version} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold">{p.prompt_version}</span>
              <Pill>{p.layer}</Pill>
              {p.activated_at && !p.retired_at ? <Pill tone="good">active</Pill> : p.retired_at ? <Pill>retired</Pill> : null}
              <span className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(open === p.prompt_version ? null : p.prompt_version)}>{open === p.prompt_version ? 'Hide' : 'View'}</Button>
                {p.layer !== 'L3' && !(p.activated_at && !p.retired_at) && <Button variant="secondary" onClick={() => activate(p.prompt_version)}>Activate</Button>}
              </span>
            </div>
            {open === p.prompt_version && <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-sunken p-3 text-xs">{p.body}</pre>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Generate({ token }: { token: string }) {
  const meta = useAdmin<{ plugins: { plugin_id: string; name: string }[] }>('/meta', token);
  const health = useAdmin<{ cells: Cell[] }>('/admin/bank/health', token);
  const [f, setF] = useState({ plugin_id: '', task_type: '', locale: 'en', target_b: 0, count: 8, kind: 'reseed' });
  const [msg, setMsg] = useState<string | null>(null);
  const taskTypes = [...new Set((health.data?.cells ?? []).filter((c) => c.plugin_id === f.plugin_id).map((c) => c.task_type))];
  const submit = async () => {
    try {
      const r = await api<{ job_id: string | null; note: string }>('POST', '/admin/generate', f, token);
      setMsg(r.job_id ? `Queued job ${r.job_id.slice(0, 8)} — ${r.note}` : r.note);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <Card>
      <h2 className="mb-1 text-xl font-semibold">Manual top-up / reseed</h2>
      <p className="mb-4 text-sm text-muted">Queues a generation job. The worker builds the four-layer prompt, calls the provider, and runs every candidate through the five gates. A shadow run validates without banking anything.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="g-plugin" label="Plugin"><select id="g-plugin" className={inputCls} value={f.plugin_id} onChange={(e) => setF({ ...f, plugin_id: e.target.value, task_type: '' })}><option value="">Choose…</option>{(meta.data?.plugins ?? []).map((p) => <option key={p.plugin_id} value={p.plugin_id}>{p.name}</option>)}</select></Field>
        <Field id="g-tt" label="Task type"><select id="g-tt" className={inputCls} value={f.task_type} onChange={(e) => setF({ ...f, task_type: e.target.value })}><option value="">Choose…</option>{taskTypes.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></Field>
        <Field id="g-loc" label="Locale"><select id="g-loc" className={inputCls} value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}><option value="en">en</option><option value="en-IN">en-IN</option></select></Field>
        <Field id="g-b" label="Target difficulty b"><input id="g-b" type="number" step={0.5} min={-3} max={3} className={inputCls} value={f.target_b} onChange={(e) => setF({ ...f, target_b: Number(e.target.value) })} /></Field>
        <Field id="g-n" label="Items"><input id="g-n" type="number" min={1} max={16} className={inputCls} value={f.count} onChange={(e) => setF({ ...f, count: Number(e.target.value) })} /></Field>
        <Field id="g-k" label="Kind"><select id="g-k" className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="reseed">Reseed (bank)</option><option value="shadow">Shadow run (validate only)</option></select></Field>
      </div>
      <div className="mt-5 flex items-center gap-3"><Button disabled={!f.plugin_id || !f.task_type} onClick={submit}>Queue job</Button>{msg && <span className="text-sm">{msg}</span>}</div>
    </Card>
  );
}
