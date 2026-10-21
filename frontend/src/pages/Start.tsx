// Onboarding: a pseudonymous profile (accessibility, device, language context) and a battery choice.
// Every field is an enumeration validated server-side; nothing typed here reaches a prompt.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Layout } from '../components/Layout';
import { Button, Card, Field, Notice, inputCls } from '../components/ui';
import { load, save, THEMES, useDisplay } from '../store';
import { useAuth } from '../auth';

interface Meta { locales: string[]; first_languages: string[]; batteries: { battery_id: string; name: string; description: string; max_duration_min: number }[] }

const detectDevice = () => {
  const w = Math.min(window.screen.width, window.screen.height);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return { device_class: w < 600 ? 'phone' : coarse ? 'tablet' : 'desktop', input_device: coarse ? 'touch' : 'mouse' } as const;
};

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <label key={v} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border-2 px-3 ${value === v ? 'border-accent bg-sunken' : 'border-line bg-surface'}`}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="h-4 w-4 accent-[var(--accent)]" />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

export function Start() {
  const nav = useNavigate();
  const { me } = useAuth();
  const [meta, setMeta] = useState<Meta | null>(null);
  const det = detectDevice();
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

  return (
    <Layout>
      <h1 className="mb-2 text-3xl font-semibold">Before you begin</h1>
      <p className="mb-6 text-muted">These answers set up the tasks so they suit you. Nothing here identifies you.</p>
      <div className="space-y-6">
        <Card>
          <h2 className="mb-4 text-xl font-semibold">Which session?</h2>
          <div className="space-y-3">
            {(meta?.batteries ?? []).map((b) => (
              <label key={b.battery_id} className={`flex cursor-pointer gap-3 rounded-md border-2 p-4 ${battery === b.battery_id ? 'border-accent bg-sunken' : 'border-line'}`}>
                <input type="radio" name="battery" checked={battery === b.battery_id} onChange={() => setBattery(b.battery_id)} className="mt-1 h-4 w-4 accent-[var(--accent)]" />
                <span><span className="block font-bold">{b.name} <span className="font-normal text-muted">· up to {b.max_duration_min} min</span></span><span className="text-muted">{b.description}</span></span>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-xl font-semibold">Display</h2>
          <div className="space-y-3">
            <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={display.highContrast} onChange={(e) => setDisplay({ ...display, highContrast: e.target.checked })} /> High contrast (black on white)</label>
            <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={display.large} onChange={(e) => setDisplay({ ...display, large: e.target.checked })} /> Larger text, pictures and buttons</label>
            <Field id="theme" label="Colour theme">
              <Choice name="theme" value={display.theme} options={THEMES} onChange={(v) => setDisplay({ ...display, theme: v })} />
            </Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-xl font-semibold">Seeing, reading and moving</h2>
          <p className="mb-4 text-muted">If something makes a task hard for a reason unrelated to what it measures, the engine swaps in a different task or reports that the area could not be measured.</p>
          <div className="space-y-5">
            <Field id="vision" label="Eyesight (with glasses if you use them)"><Choice name="vision" value={p.vision} options={[['typical', 'I can see a screen clearly'], ['low', 'I have low vision'], ['none', 'I cannot see the screen']]} onChange={set('vision')} /></Field>
            <Field id="colour" label="Colour vision"><Choice name="colour" value={p.colour_vision} options={[['typical', 'Typical'], ['deficient', 'Some colours are hard to tell apart']]} onChange={set('colour_vision')} /></Field>
            <Field id="literacy" label="Reading"><Choice name="literacy" value={p.literacy} options={[['typical', 'I read comfortably'], ['low', 'Reading is hard for me']]} onChange={set('literacy')} /></Field>
            <Field id="motor" label="Hands"><Choice name="motor" value={p.motor} options={[['typical', 'No difficulty tapping or typing'], ['limited', 'Tapping quickly is hard for me']]} onChange={set('motor')} /></Field>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 text-xl font-semibold">Context</h2>
          <p className="mb-4 text-muted">Shown next to your results so they can be read fairly. Never used to change a score silently.</p>
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
            <Field id="edu" label="Years of formal education" hint="Optional">
              <input id="edu" type="number" min={0} max={30} inputMode="numeric" className={inputCls} value={p.education_years} onChange={(e) => set('education_years')(e.target.value)} />
            </Field>
            <Field id="age" label="Age group" hint="Optional">
              <select id="age" className={inputCls} value={p.age_band} onChange={(e) => set('age_band')(e.target.value)}>
                <option value="">Prefer not to say</option>
                {['18-29', '30-44', '45-59', '60-69', '70-79', '80+'].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field id="device" label="Device">
              <select id="device" className={inputCls} value={p.device_class} onChange={(e) => set('device_class')(e.target.value)}>
                <option value="desktop">Computer</option><option value="tablet">Tablet</option><option value="phone">Phone</option>
              </select>
            </Field>
            <Field id="input" label="How you will respond">
              <select id="input" className={inputCls} value={p.input_device} onChange={(e) => set('input_device')(e.target.value)}>
                <option value="mouse">Mouse or trackpad</option><option value="keyboard">Keyboard</option><option value="touch">Touch screen</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card>
          <label className="flex cursor-pointer gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I understand these are scores on tasks, not a diagnosis, and that my answers are stored without my name.</span>
          </label>
          {error && <div className="mt-4"><Notice tone="bad" title="Could not start">{error}</Notice></div>}
          <div className="mt-5"><Button size="lg" disabled={!consent || busy || !meta} onClick={begin}>{busy ? 'Starting…' : 'Start the session'}</Button></div>
        </Card>
      </div>
    </Layout>
  );
}
