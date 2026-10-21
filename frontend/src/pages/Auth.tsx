// Sign in / create account. Usernames only — no email or real name is collected.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';
import { Layout } from '../components/Layout';
import { Button, Card, Field, Notice, inputCls } from '../components/ui';

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
    <Layout>
      <div className="mx-auto max-w-md">
        <h1 className="mb-2 text-3xl font-semibold">{register ? 'Create an account' : 'Sign in'}</h1>
        <p className="mb-6 text-muted">{register ? 'Choose a username and password. No email or real name is needed; your results are kept under this username only.' : 'Welcome back. Your past sessions and scores are on your history page.'}</p>
        <Card>
          <form onSubmit={submit} className="space-y-4" noValidate>
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
        </Card>
        <p className="mt-4 text-center text-muted">
          {register ? <>Already have an account? <Link className="font-bold text-ink underline" to={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></> : <>New here? <Link className="font-bold text-ink underline" to={`/register?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
        </p>
      </div>
    </Layout>
  );
}
