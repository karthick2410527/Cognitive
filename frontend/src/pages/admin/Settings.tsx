// Admin → Settings: edits backend/config/generation.json (live question generation). The server
// validates the whole file before writing it and re-reads it on the next decision, so changes apply
// to running sessions without a restart. Notes ($comment keys) in the file are kept.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { api } from '../../api';
import { Button, Notice, Spinner, inputCls } from '../../components/ui';
import { domainMeta } from '../../components/domains';

type Raw = Record<string, any>;

const get = (o: Raw, path: string): any => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setIn(o: Raw, path: string, v: unknown): Raw {
  const copy = structuredClone(o);
  const keys = path.split('.');
  let cur = copy;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  if (v === undefined) delete cur[keys.at(-1)!]; else cur[keys.at(-1)!] = v;
  return copy;
}

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-5 mt-1 text-sm text-muted">{sub}</p>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Num({ label, hint, value, onChange, min, max, step = 1, suffix }: { label: string; hint?: string; value: number | undefined; onChange: (v: number) => void; min: number; max: number; step?: number; suffix?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-2">
        <input type="number" className={`${inputCls} max-w-[140px]`} value={value ?? ''} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="text-sm text-muted">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line p-4 sm:col-span-1">
      <span><span className="block font-medium">{label}</span>{hint && <span className="text-xs text-muted">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${value ? 'bg-accent' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function Choice<T extends string>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="inline-flex rounded-xl border border-line bg-paper/60 p-1">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${value === v ? 'bg-surface text-ink shadow-sm ring-1 ring-line/80' : 'text-muted hover:text-ink'}`}>{l}</button>
        ))}
      </div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function Settings({ token }: { token: string }) {
  const [saved, setSaved] = useState<Raw | null>(null);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [plugins, setPlugins] = useState<{ plugin_id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ raw: Raw }>('GET', '/admin/config/generation', undefined, token).then((r) => { setSaved(r.raw); setRaw(r.raw); }).catch((e) => setError(e.message));
    void api<{ plugins: { plugin_id: string; name: string }[] }>('GET', '/meta').then((m) => setPlugins(m.plugins)).catch(() => {});
  }, [token]);

  const dirty = useMemo(() => JSON.stringify(raw) !== JSON.stringify(saved), [raw, saved]);
  if (error && !raw) return <Notice tone="bad" title="Could not load settings">{error}</Notice>;
  if (!raw) return <Spinner />;
  const T = 'policy.threshold';
  const v = (path: string) => get(raw, path);
  const set = (path: string) => (x: unknown) => { setRaw(setIn(raw, path, x)); setStatus(null); };
  const writtenDomains: string[] | null = v('written.domains') ?? null;

  async function save() {
    setBusy(true); setError(null); setStatus(null);
    try {
      const r = await api<{ raw: Raw }>('PUT', '/admin/config/generation', { raw }, token);
      setSaved(r.raw); setRaw(r.raw); setStatus('Saved. New decisions use these settings straight away.');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="max-w-3xl">
        <h2 className="text-2xl font-semibold">Question generation</h2>
        <p className="mt-1 text-muted">How many questions are written for a session, when more are written, and where questions come from when writing fails. Saved to <code className="font-mono text-sm">config/generation.json</code>; running sessions pick changes up on their next decision.</p>
      </div>

      <Section title="Mode and session start" sub="Live writes new questions for every session; bank serves only stored, checked questions.">
        <Choice label="Mode" value={v('mode')} options={[['live', 'Live (write new questions)'], ['bank', 'Bank only']]} onChange={set('mode')} />
        <Num label="Questions per area at start" hint="Written before the first question is shown (the preparing screen)." value={v('initial_per_domain')} min={0} max={10} onChange={set('initial_per_domain')} />
        <Num label="Attempts per start question" hint="A question that fails the checks is retried with another format." value={v('initial_max_attempts')} min={1} max={6} onChange={set('initial_max_attempts')} />
        <Num label="Time limit per start question" suffix="seconds" hint="Not written by then (slow, rate limited, failing)? A stored question the user has not seen fills in; the late one is kept for later." value={(v('initial_deadline_ms') ?? 30000) / 1000} min={0} max={180} onChange={(x) => set('initial_deadline_ms')(Math.round(x * 1000))} />
        <Num label="Most generations running at once" hint="Per session, across all areas." value={v(`${T}.max_in_flight_per_session`)} min={1} max={30} onChange={set(`${T}.max_in_flight_per_session`)} />
      </Section>

      <Section title="Thresholds" sub="Per area, after the start questions. An area's precision is its standard error (SE): the lower, the more certain the score.">
        <Num label="“More” when SE is above" hint="Uncertain areas get more questions kept ready." value={v(`${T}.more.se_above`)} min={0} max={5} step={0.05} onChange={set(`${T}.more.se_above`)} />
        <div />
        <Num label="“More”: keep ready" suffix="questions" value={v(`${T}.more.keep_ready`)} min={0} max={10} onChange={set(`${T}.more.keep_ready`)} />
        <Num label="“More”: write per refill" suffix="questions" value={v(`${T}.more.refill`)} min={1} max={8} onChange={set(`${T}.more.refill`)} />
        <Num label="“Normal”: keep ready" suffix="questions" value={v(`${T}.normal.keep_ready`)} min={0} max={10} onChange={set(`${T}.normal.keep_ready`)} />
        <Num label="“Normal”: write per refill" suffix="questions" value={v(`${T}.normal.refill`)} min={1} max={8} onChange={set(`${T}.normal.refill`)} />
        <Toggle label="Stop writing when an area reaches its target" hint="SE at or below the area's target precision → no new questions for it." value={!!v(`${T}.stop_when_target_se_met`)} onChange={set(`${T}.stop_when_target_se_met`)} />
      </Section>

      <section className="panel p-6">
        <h2 className="text-lg font-semibold">Per-area overrides</h2>
        <p className="mb-5 mt-1 text-sm text-muted">Leave blank to use the thresholds above. Turning an area off serves it from stored questions only.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase tracking-wider text-faint"><th className="pb-2 font-medium">Area</th><th className="pb-2 font-medium">Write live</th><th className="pb-2 font-medium">“More” keep ready</th><th className="pb-2 font-medium">“Normal” keep ready</th></tr></thead>
            <tbody>
              {plugins.map((pl) => {
                const base = `${T}.per_domain.${pl.plugin_id}`;
                const Icon = domainMeta(pl.plugin_id)?.icon;
                const opt = (path: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
                  let next = setIn(raw, path, e.target.value === '' ? undefined : Number(e.target.value));
                  for (const lv of ['more', 'normal']) if (get(next, `${base}.${lv}`) && !Object.keys(get(next, `${base}.${lv}`)).length) next = setIn(next, `${base}.${lv}`, undefined);
                  if (get(next, base) && !Object.keys(get(next, base)).length) next = setIn(next, base, undefined);
                  setRaw(next); setStatus(null);
                };
                const enabled = get(raw, `${base}.enabled`) !== false;
                return (
                  <tr key={pl.plugin_id} className="border-t border-line/70">
                    <td className="py-3 pr-4"><span className="flex items-center gap-2 font-medium">{Icon && <Icon size={15} className="text-accent" />}{pl.name}</span></td>
                    <td className="py-3 pr-4">
                      <button type="button" role="switch" aria-checked={enabled} aria-label={`Write live questions for ${pl.name}`} onClick={() => { let n = setIn(raw, `${base}.enabled`, enabled ? false : undefined); if (get(n, base) && !Object.keys(get(n, base)).length) n = setIn(n, base, undefined); setRaw(n); setStatus(null); }} className={`relative h-6 w-11 rounded-full transition-colors ${enabled ? 'bg-accent' : 'bg-line-strong'}`}>
                        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                    </td>
                    <td className="py-3 pr-4"><input type="number" min={0} max={10} placeholder={String(v(`${T}.more.keep_ready`) ?? '')} className={`${inputCls} !min-h-[38px] max-w-[110px]`} value={get(raw, `${base}.more.keep_ready`) ?? ''} onChange={opt(`${base}.more.keep_ready`)} /></td>
                    <td className="py-3"><input type="number" min={0} max={10} placeholder={String(v(`${T}.normal.keep_ready`) ?? '')} className={`${inputCls} !min-h-[38px] max-w-[110px]`} value={get(raw, `${base}.normal.keep_ready`) ?? ''} onChange={opt(`${base}.normal.keep_ready`)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Section title="Mix and waiting" sub="The written/visual balance, and how long a request waits for a question that is already being written before using a stored one.">
        <label className="block sm:col-span-2">
          <span className="label">Written questions: {Math.round((v('modality_ratio.text') ?? 0) * 100)} % · visual tasks: {Math.round((v('modality_ratio.visual') ?? 0) * 100)} %</span>
          <input type="range" min={0} max={100} step={5} value={Math.round((v('modality_ratio.text') ?? 0) * 100)} onChange={(e) => { const t = Number(e.target.value) / 100; setRaw(setIn(setIn(raw, 'modality_ratio.text', t), 'modality_ratio.visual', Math.round((1 - t) * 100) / 100)); setStatus(null); }} className="w-full accent-[var(--accent)]" />
        </label>
        <Num label="Wait for a start question" suffix="seconds" hint="Only when it is already being written." value={(v('wait_ms.initial') ?? 0) / 1000} min={0} max={120} onChange={(x) => set('wait_ms.initial')(Math.round(x * 1000))} />
        <Num label="Wait for a refill question" suffix="seconds" hint="Only when it is already being written." value={(v('wait_ms.refill') ?? 0) / 1000} min={0} max={60} onChange={(x) => set('wait_ms.refill')(Math.round(x * 1000))} />
        <Toggle label="Serve questions awaiting review" hint="Questions that passed every automatic check but no human review yet." value={!!v('serve_unreviewed_live_items')} onChange={set('serve_unreviewed_live_items')} />
      </Section>

      <Section title="Written questions" sub="Free-form written questions use your item-writer prompt; a second call checks every answer key.">
        <Choice label="Order" value={v('written.order') ?? 'generate_first'} options={[['generate_first', 'Write new first'], ['stored_first', 'Stored first']]} onChange={set('written.order')} hint="Write new first: a stored question the user has not seen is used only when writing fails." />
        <Num label="Questions per writer call" value={v('written.per_call')} min={1} max={8} onChange={set('written.per_call')} />
        <Num label="Highest reading level" suffix="US grade" value={v('written.max_reading_grade') ?? 12} min={3} max={16} onChange={set('written.max_reading_grade')} />
        <Toggle label="Check every answer key" hint="A second call answers without seeing the key; disagreements are rejected." value={v('written.verify') !== false} onChange={set('written.verify')} />
        <Toggle label="Reuse stored questions" hint="When writing fails, use a stored question this user has not seen." value={v('written.reuse_stored') !== false} onChange={set('written.reuse_stored')} />
        <div className="sm:col-span-2">
          <span className="label">Areas with free-form written questions</span>
          <div className="flex flex-wrap gap-2">
            {plugins.map((pl) => {
              const on = writtenDomains === null || writtenDomains.includes(pl.plugin_id);
              return (
                <button key={pl.plugin_id} type="button" aria-pressed={on} onClick={() => { const cur = writtenDomains ?? plugins.map((x) => x.plugin_id); set('written.domains')(on ? cur.filter((d) => d !== pl.plugin_id) : [...cur, pl.plugin_id]); }} className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line text-muted hover:text-ink'}`}>{pl.name}</button>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-paper/85 backdrop-blur-xl md:left-64">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <p className={`text-sm ${error ? 'text-bad' : 'text-muted'}`} role="status">{error ?? status ?? (dirty ? 'You have unsaved changes.' : 'All changes saved.')}</p>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => { setRaw(saved); setError(null); }}><RotateCcw size={15} /> Discard</Button>
            <Button disabled={!dirty || busy} onClick={save}><Save size={15} /> {busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
