import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ClipboardList, Contrast, History, Home, Shield, LogIn, LogOut, Plus, Sun, SunDim, UserPlus, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth';
import { useDisplay, type ThemeName } from '../store';

const THEME_ICONS: [ThemeName, string, LucideIcon][] = [
  ['light', 'Light (recommended)', Sun],
  ['soft', 'Low glare', SunDim],
  ['contrast', 'High contrast', Contrast],
];

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-[7px] text-accent-ink"
      style={{ width: size, height: size, background: 'linear-gradient(135deg, rgb(var(--c-accent)) 0%, rgb(var(--c-accent-hover)) 100%)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.3), 0 4px 12px -4px rgb(var(--c-accent) / 0.7)' }}
      aria-hidden="true"
    >
      <span className="rounded-full border-2 border-current" style={{ width: size * 0.42, height: size * 0.42 }} />
    </span>
  );
}

export function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <Logo />
      <span className="font-display text-[1.0625rem] font-semibold leading-none tracking-tight">Cognimetric</span>
    </Link>
  );
}

export function ThemeSwitcher() {
  const [display, setDisplay] = useDisplay();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex rounded-xl border border-line bg-paper/70 p-0.5">
      {THEME_ICONS.map(([t, label, Icon]) => {
        const on = display.theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            onClick={() => setDisplay({ ...display, theme: t })}
            className={`flex h-7 flex-1 items-center justify-center rounded-[10px] transition-colors ${on ? 'bg-surface text-accent shadow-panel' : 'text-faint hover:text-ink'}`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-surface text-ink shadow-sm ring-1 ring-line/80' : 'text-muted hover:bg-surface/60 hover:text-ink'}`;

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: LucideIcon; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={navCls}>
      {({ isActive }) => (
        <>
          <Icon size={16} className={isActive ? 'text-accent' : 'text-faint group-hover:text-ink'} />
          {label}
        </>
      )}
    </NavLink>
  );
}

export function Layout({ children, wide = false, chrome = true }: { children: ReactNode; wide?: boolean; chrome?: boolean }) {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const links: [string, string, LucideIcon, boolean?][] = me
    ? [['/', 'Home', Home, true], ['/history', 'Dashboard', History], ['/probes', 'Follow-up', ClipboardList], ...(me.user.role === 'admin' ? [['/admin', 'Admin', Shield] as [string, string, LucideIcon]] : [])]
    : [['/', 'Home', Home, true], ['/login', 'Sign in', LogIn], ['/register', 'Create account', UserPlus]];
  const signOut = async () => { await logout(); nav('/'); };
  const skip = <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:p-3">Skip to content</a>;
  const main = <main id="main" className={`mx-auto w-full px-4 py-8 sm:px-8 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>;

  if (!chrome) return <div className="min-h-screen">{skip}{main}</div>;

  return (
    <div className="min-h-screen md:flex">
      {skip}
      {/* Sidebar on wide screens */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line/70 bg-paper/60 backdrop-blur-xl md:flex">
        <div className="px-5 py-5"><Wordmark /></div>
        {me && (
          <div className="px-3 pt-4">
            <Link to="/start" className="btn-primary min-h-[40px] w-full px-3 text-sm"><Plus size={15} /> New session</Link>
          </div>
        )}
        <p className="mt-6 px-6 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-faint">Workspace</p>
        <nav className="mt-2 flex flex-col gap-1 px-3" aria-label="Main">
          {links.map(([to, label, icon, end]) => <NavItem key={to} to={to} label={label} icon={icon} end={end} />)}
        </nav>
        <div className="mt-auto flex flex-col gap-3 px-3 pb-4 pt-3">
          <ThemeSwitcher />
          {me && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-line/70 bg-surface/70 py-1.5 pl-2 pr-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold uppercase text-accent" aria-hidden="true">{me.user.username.slice(0, 1)}</span>
                <span className="truncate text-sm font-medium" aria-label="Signed in as">{me.user.username}</span>
              </span>
              <button type="button" onClick={signOut} className="btn-quiet h-8 px-2 text-xs"><LogOut size={13} /> Sign out</button>
            </div>
          )}
          <p className="px-1 text-[0.6875rem] text-faint">Scores on tasks, not a diagnosis.</p>
        </div>
      </aside>

      {/* Top bar on narrow screens */}
      <header className="sticky top-0 z-10 border-b border-line/70 bg-paper/80 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          {me && <Link to="/start" className="btn-primary min-h-[36px] px-3 text-sm"><Plus size={15} /> New</Link>}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {links.map(([to, label, , end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-surface text-ink shadow-sm ring-1 ring-line/80' : 'text-muted'}`}>{label}</NavLink>
          ))}
          {me && <button type="button" onClick={signOut} className="whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium text-muted">Sign out</button>}
        </nav>
      </header>

      <div className="min-w-0 flex-1">{main}</div>
    </div>
  );
}
