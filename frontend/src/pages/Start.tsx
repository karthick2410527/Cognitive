// Onboarding wizard: session type → access needs → about you → display and confirm. Builds a
// pseudonymous profile (accessibility, device, language context); every field is an enumeration
// validated server-side, and nothing typed here reaches a prompt.
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Clock, Ear, Eye, Hand, BookOpen, Palette, Monitor, Smartphone, Tablet, ZoomIn, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { api, ApiError } from '../api';
import { Layout } from '../components/Layout';
import { Button, Field, Notice, inputCls } from '../components/ui';
import { THEMES, useDisplay } from '../store';
import { useAuth } from '../auth';

interface Meta { locales: string[]; first_languages: string[]; batteries: { battery_id: string; name: string; description: string; max_duration_min: number }[] }

const detectDevice = () => {
  const w = Math.min(window.screen.width, window.screen.height);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return { device_class: w < 600 ? 'phone' : coarse ? 'tablet' : 'desktop', input_device: coarse ? 'touch' : 'mouse' } as const;
};

/** Segmented choice: one card per option, the selected one ringed in the accent. */
function Segments<T extends string>({ name, value, options, onChange, cols = 3 }: { name: string; value: T; options: [T, string, string?][]; onChange: (v: T) => void; cols?: number }) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 3 ? 150 : 200}px, 1fr))` }}>
      {options.map(([v, label, hint]) => {
        const on = value === v;
        return (
          <label key={v} className={`relative flex min-h-[52px] cursor-pointer flex-col justify-center rounded-xl border px-4 py-3 transition-all ${on ? 'border-accent/60 bg-accent/5 ring-4 ring-accent/10' : 'border-line bg-surface hover:border-line-strong'}`}>
            <input type="radio" name={name} value={v} checked={on} onChange={() => onChange(v)} className="sr-only" />
            <span className="pr-6 font-medium">{label}</span>
            {hint && <span className="mt-0.5 text-sm text-muted">{hint}</span>}
            {on && <span className="absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink"><Check size={12} /></span>}
          </label>
        );
      })}
    </div>
  );
}

/** One question row: icon, title and a short reason, with its choices underneath. */
function Question({ icon: Icon, title, why, children }: { icon: LucideIcon; title: string; why?: string; children: ReactNode }) {
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="mb-3 flex items-start gap-3">
        <span className="icon-tile !h-9 !w-9 shrink-0"><Icon size={17} /></span>
        <div>
          <p className="font-semibold">{title}</p>
          {why && <p className="text-sm text-muted">{why}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

const STEPS = [
  { title: 'Session', sub: 'What kind of session' },
  { title: 'Access needs', sub: 'So every task is fair' },
  { title: 'About you', sub: 'Context for your results' },
  { title: 'Review', sub: 'Display and consent' },
];

export function Start() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const det = detectDevice();
  const [step, setStep] = useState(0);
  const [locale, setLocale] = useState('en');
  const [battery, setBattery] = useState('standard_5domain_v1');
  const [p, setP] = useState({
    device_class: det.device_class as string, input_device: det.input_device as string, vision: 'typical', literacy: 'typical', motor: 'typical', colour_vision: 'typical', hearing: 'typical',
    first_language: 'english', education_years: '' as string, age_band: '' as string,
  });
  const [display, setDisplay] = useDisplay();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void api<Meta>('GET', '/meta').then(setMeta).catch((e) => setError(e.message)); }, []);
  // Pre-fill from the account's saved profile.
  useEffect(() => {
    if (!me) return;
    const pr = me.profile as Record<string, unknown>;
    setLocale(me.locale ?? 'en');
    setP((cur) => ({ ...cur, ...Object.fromEntries(Object.entries(pr).filter(([k, v]) => k in cur && v !== null && v !== undefined).map(([k, v]) => [k, String(v)])) }));
  }, [me]);
  const set = (k: keyof typeof p) => (v: string) => setP({ ...p, [k]: v });

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const profile = {
        device_class: p.device_class, input_device: p.input_device, vision: p.vision, literacy: p.literacy, motor: p.motor, colour_vision: p.colour_vision, hearing: p.hearing,
        high_contrast: display.highContrast, large_targets: display.large, reduced_motion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        education_years: p.education_years === '' ? null : Number(p.education_years), first_language: p.first_language, age_band: p.age_band || null,
      };
      // The profile is saved on the signed-in account, so every session and the history page share it.
      await api('PUT', '/me/profile', { locale, profile });
      const s = await api<{ session_id: string }>('POST', '/sessions', { battery_id: battery });
      nav(`/session/${s.session_id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  const chosen = meta?.batteries.find((b) => b.battery_id === battery);
  const last = step === STEPS.length - 1;
  const go = (n: number) => { setStep(n); window.scrollTo({ top: 0 }); };

  return (
    <Layout wide>
      <div className="mx-auto max-w-5xl">
        <p className="eyebrow mb-2">New session</p>
        <h1 className="text-4xl font-semibold">Set up your session</h1>
        <p className="mt-2 text-lg text-muted">Four quick steps. Nothing here identifies you, and your answers are saved for next time.</p>

        <div className="mt-8 grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
          {/* Step rail */}
          <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1" aria-label="Steps">
            {STEPS.map((s, i) => {
              const state = i === step ? 'on' : i < step ? 'done' : 'todo';
              return (
                <li key={s.title} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => i <= step && go(i)}
                    disabled={i > step}
                    aria-current={i === step ? 'step' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${state === 'on' ? 'bg-surface shadow-sm ring-1 ring-line/80' : state === 'done' ? 'hover:bg-surface/60' : 'opacity-60'}`}
                  >
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold ${state === 'on' ? 'border-accent bg-accent text-accent-ink' : state === 'done' ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-muted'}`}>
                      {state === 'done' ? <Check size={14} /> : i + 1}
                    </span>
                    <span className="hidden sm:block">
                      <span className="block text-sm font-semibold">{s.title}</span>
                      <span className="block text-xs text-muted">{s.sub}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          {/* Step content */}
          <section className="panel p-6 sm:p-8" aria-labelledby="step-title">
            <h2 id="step-title" className="text-2xl font-semibold">{STEPS[step]!.title}</h2>
            <p className="mb-6 mt-1 text-muted">{STEPS[step]!.sub}</p>

            {step === 0 && (
              <div className="grid gap-3">
                {(meta?.batteries ?? []).map((b, i) => {
                  const on = battery === b.battery_id;
                  const Icon = [Sparkles, Clock, BookOpen][i] ?? Sparkles;
                  return (
                    <label key={b.battery_id} className={`relative flex cursor-pointer gap-4 rounded-2xl border p-5 transition-all ${on ? 'border-accent/60 bg-accent/5 ring-4 ring-accent/10' : 'border-line hover:border-line-strong'}`}>
                      <input type="radio" name="battery" checked={on} onChange={() => setBattery(b.battery_id)} className="sr-only" />
                      <span className="icon-tile shrink-0"><Icon size={18} /></span>
                      <span className="min-w-0 flex-1 pr-6">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{b.name}</span>
                          <span className="chip">up to {b.max_duration_min} min</span>
                          {i === 0 && <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Recommended</span>}
                        </span>
                        <span className="mt-1 block text-sm leading-relaxed text-muted">{b.description}</span>
                      </span>
                      {on && <span className="absolute right-4 top-4 grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-ink"><Check size={12} /></span>}
                    </label>
                  );
                })}
                {!meta && <p className="text-muted">Loading sessions…</p>}
              </div>
            )}

            {step === 1 && (
              <div className="divide-y divide-line/70">
                <p className="pb-5 text-sm text-muted">If something makes a task hard for a reason unrelated to what it measures, a different task is used, or the area is reported as not measured.</p>
                <Question icon={Eye} title="Eyesight" why="With glasses if you use them.">
                  <Segments name="vision" value={p.vision} options={[['typical', 'I see the screen clearly'], ['low', 'I have low vision'], ['none', 'I cannot see the screen']]} onChange={set('vision')} />
                </Question>
                <Question icon={Palette} title="Colour vision">
                  <Segments name="colour" value={p.colour_vision} cols={2} options={[['typical', 'Typical'], ['deficient', 'Some colours are hard to tell apart']]} onChange={set('colour_vision')} />
                </Question>
                <Question icon={Ear} title="Hearing" why="Some memory tasks play sounds.">
                  <Segments name="hearing" value={p.hearing} cols={2} options={[['typical', 'I can hear sounds clearly'], ['impaired', 'Hearing sounds is hard for me']]} onChange={set('hearing')} />
                </Question>
                <Question icon={BookOpen} title="Reading">
                  <Segments name="literacy" value={p.literacy} cols={2} options={[['typical', 'I read comfortably'], ['low', 'Reading is hard for me']]} onChange={set('literacy')} />
                </Question>
                <Question icon={Hand} title="Hands">
                  <Segments name="motor" value={p.motor} cols={2} options={[['typical', 'No difficulty tapping or typing'], ['limited', 'Tapping quickly is hard for me']]} onChange={set('motor')} />
                </Question>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <p className="text-sm text-muted">Shown next to your results so they can be read fairly. Never used to change a score silently.</p>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="locale" label="Test language">
                    <select id="locale" className={inputCls} value={locale} onChange={(e) => setLocale(e.target.value)}>
                      {(meta?.locales ?? ['en']).map((l) => <option key={l} value={l}>{l === 'en-IN' ? 'English (India)' : 'English'}</option>)}
                    </select>
                  </Field>
                  <Field id="first_language" label="First language">
                    <select id="first_language" className={inputCls} value={p.first_language} onChange={(e) => set('first_language')(e.target.value)}>
                      {(meta?.first_languages ?? ['english']).map((l) => <option key={l} value={l}>{l[0]!.toUpperCase() + l.slice(1)}</option>)}
                    </select>
                  </Field>
                  <Field id="age" label="Age group" hint="Optional">
                    <select id="age" className={inputCls} value={p.age_band} onChange={(e) => set('age_band')(e.target.value)}>
                      <option value="">Prefer not to say</option>
                      {['18-29', '30-44', '45-59', '60-69', '70-79', '80+'].map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </Field>
                  <Field id="edu" label="Years of formal education" hint="Optional">
                    <input id="edu" type="number" min={0} max={30} inputMode="numeric" className={inputCls} value={p.education_years} onChange={(e) => set('education_years')(e.target.value)} />
                  </Field>
                </div>
                <div className="divide-y divide-line/70 border-t border-line/70 pt-5">
                  <Question icon={p.device_class === 'phone' ? Smartphone : p.device_class === 'tablet' ? Tablet : Monitor} title="Device" why="Detected automatically; change it if it is wrong.">
                    <Segments name="device" value={p.device_class} options={[['desktop', 'Computer'], ['tablet', 'Tablet'], ['phone', 'Phone']]} onChange={set('device_class')} />
                  </Question>
                  <Question icon={Hand} title="How you will answer">
                    <Segments name="input" value={p.input_device} options={[['mouse', 'Mouse or trackpad'], ['keyboard', 'Keyboard'], ['touch', 'Touch screen']]} onChange={set('input_device')} />
                  </Question>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <Question icon={Palette} title="Colour theme" why="Dark text on a light background is the easiest to read and gives the most reliable results, so only light themes are offered.">
                  <Segments name="theme" value={display.theme} options={THEMES} onChange={(v) => setDisplay({ ...display, theme: v })} />
                </Question>
                <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${display.large ? 'border-accent/60 bg-accent/5' : 'border-line'}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={display.large} onChange={(e) => setDisplay({ ...display, large: e.target.checked })} />
                  <span><span className="flex items-center gap-2 font-medium"><ZoomIn size={15} /> Larger everything</span><span className="text-sm text-muted">Text, pictures and buttons</span></span>
                </label>

                <div className="rounded-2xl border border-line/80 bg-paper/50 p-5">
                  <p className="mb-3 text-sm font-semibold">Summary</p>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <div className="flex justify-between gap-3"><dt className="text-muted">Session</dt><dd className="font-medium">{chosen?.name ?? '…'}{chosen ? ` · up to ${chosen.max_duration_min} min` : ''}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Language</dt><dd className="font-medium">{locale === 'en-IN' ? 'English (India)' : 'English'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Device</dt><dd className="font-medium capitalize">{p.device_class} · {p.input_device}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted">Access needs</dt><dd className="font-medium">{[p.vision, p.colour_vision, p.hearing, p.literacy, p.motor].every((x) => x === 'typical') ? 'None' : 'Adjusted'}</dd></div>
                  </dl>
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--accent)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span className="text-sm"><span className="flex items-center gap-2 font-medium"><ShieldCheck size={15} className="text-accent" /> I understand</span><span className="text-muted">These are scores on tasks, not a diagnosis, and my answers are stored without my name.</span></span>
                </label>
                {error && <Notice tone="bad" title="Could not start">{error}</Notice>}
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-line/70 pt-6">
              {step > 0 ? <Button variant="ghost" onClick={() => go(step - 1)}><ArrowLeft size={16} /> Back</Button> : <span />}
              {last
                ? <Button size="lg" disabled={!consent || busy || !meta} onClick={begin}>{busy ? 'Starting…' : 'Start the session'} <ArrowRight size={16} /></Button>
                : <Button size="lg" disabled={!meta} onClick={() => go(step + 1)}>Continue <ArrowRight size={16} /></Button>}
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
}
