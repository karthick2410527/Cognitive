// Sign in / create account. Usernames only — no email or real name is collected.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Check } from 'lucide-react';
import { Wordmark } from '../components/Layout';
import { Button, Field, Notice, inputCls } from '../components/ui';
import { DOMAINS, DomainIcon } from '../components/domains';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const register = mode === 'register';
  const next = params.get('next') ?? (register ? '/start' : '/history');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (register && password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await api('POST', register ? '/auth/register' : '/auth/login', { username, password });
      await refresh();
      nav(next.startsWith('/') ? next : '/history', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-semibold sm:text-4xl">{register ? 'Create your account' : 'Welcome back'}</h1>
          <p className="mt-2 text-muted">{register ? 'A username and password is all it takes. No email or real name.' : 'Sign in to continue a session or see your history.'}</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <Field id="username" label="Username" hint={register ? '3–32 letters, numbers, dot, dash or underscore.' : undefined}>
              <input id="username" className={inputCls} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={32} aria-describedby={register ? 'username-hint' : undefined} />
            </Field>
            <Field id="password" label="Password" hint={register ? 'At least 8 characters. A short phrase works well.' : undefined}>
              <input id="password" type="password" className={inputCls} autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} aria-describedby={register ? 'password-hint' : undefined} />
            </Field>
            {register && (
              <Field id="confirm" label="Repeat password">
                <input id="confirm" type="password" className={inputCls} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
            )}
            {error && <Notice tone="bad">{error}</Notice>}
            <Button type="submit" size="lg" className="w-full" disabled={busy || !username || !password}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted">
            {register ? <>Already have an account? <Link className="font-medium text-accent hover:underline" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></> : <>New here? <Link className="font-medium text-accent hover:underline" to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
          </p>
        </div>
        <p className="text-xs text-faint">Scores on tasks, not a diagnosis.</p>
      </main>

      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden border-l border-line/60 lg:block" style={{ background: 'radial-gradient(900px 500px at 70% 10%, rgb(var(--c-accent) / 0.22), transparent 65%), rgb(var(--c-surface))' }} aria-hidden="true">
        <div className="hero-grid absolute inset-0" />
        <div className="relative flex h-full flex-col justify-center px-14">
          <p className="eyebrow">Cognimetric</p>
          <p className="mt-4 max-w-md font-display text-4xl font-semibold leading-tight tracking-tight">Five areas of thinking. One adaptive session.</p>
          <ul className="mt-8 space-y-3 text-muted">
            {['Questions adapt after every answer', 'New questions written and checked live', 'About 25 minutes, breaks between tasks'].map((t) => (
              <li key={t} className="flex items-center gap-3"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent/15 text-accent"><Check size={14} /></span>{t}</li>
            ))}
          </ul>
          <div className="mt-12 flex gap-3">
            {DOMAINS.map((d) => <DomainIcon key={d.id} id={d.id} />)}
          </div>
        </div>
      </aside>
    </div>
  );
}
