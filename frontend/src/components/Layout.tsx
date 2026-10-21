import type { ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { ClipboardList, History, Home, LogIn, LogOut, Monitor, Moon, Plus, Sun, SunDim, UserPlus, Circle, type LucideIcon } from 'lucide-react';
import { useAuth } from '../auth';
import { useDisplay, type ThemeName } from '../store';

const THEME_ICONS: [ThemeName, string, LucideIcon][] = [
  ['system', 'Match my device', Monitor],
  ['light', 'Light', Sun],
  ['dim', 'Dim', SunDim],
  ['dark', 'Dark', Moon],
  ['black', 'Black', Circle],
];

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span className="relative shrink-0 rotate-[4deg] rounded-[4px] border-2 border-ink" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-[3px] rounded-full bg-accent" />
    </span>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <Logo />
      <span className="font-display text-[1.0625rem] font-semibold leading-none tracking-tight">
        cogni<span className="text-accent">metric</span>
      </span>
    </Link>
  );
}

function ThemeSwitcher() {
  const [display, setDisplay] = useDisplay();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex rounded border border-line bg-paper p-0.5">
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
            className={`flex h-7 flex-1 items-center justify-center rounded-[3px] transition-colors ${on ? 'bg-surface text-accent shadow-panel' : 'text-faint hover:text-ink'}`}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  `group relative flex items-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-sunken text-ink' : 'text-muted hover:bg-sunken/60 hover:text-ink'}`;

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: LucideIcon; end?: boolean }) {
  return (
    <NavLink to={to} end={end} className={navCls}>
      {({ isActive }) => (
        <>
          <span className={`absolute bottom-1.5 left-0 top-1.5 w-[2.5px] rounded-full ${isActive ? 'bg-accent' : 'bg-transparent'}`} />
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
    ? [['/', 'Home', Home, true], ['/history', 'My history', History], ['/probes', 'Follow-up', ClipboardList]]
    : [['/', 'Home', Home, true], ['/login', 'Sign in', LogIn], ['/register', 'Create account', UserPlus]];
  const signOut = async () => { await logout(); nav('/'); };
  const skip = <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:p-3">Skip to content</a>;
  const main = <main id="main" className={`mx-auto w-full px-4 py-8 sm:px-8 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>{children}</main>;

  if (!chrome) return <div className="min-h-screen">{skip}{main}</div>;

  return (
    <div className="min-h-screen md:flex">
      {skip}
      {/* Sidebar on wide screens */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-paper/70 backdrop-blur-sm md:flex">
        <div className="border-b border-line/70 px-5 py-5"><Wordmark /></div>
        {me && (
          <div className="px-3 pt-4">
            <Link to="/start" className="btn-primary min-h-[40px] w-full px-3 text-sm"><Plus size={15} /> New session</Link>
          </div>
        )}
        <nav className="mt-5 flex flex-col gap-0.5 px-3" aria-label="Main">
          {links.map(([to, label, icon, end]) => <NavItem key={to} to={to} label={label} icon={icon} end={end} />)}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-line/70 px-3 pb-4 pt-3">
          <ThemeSwitcher />
          {me && (
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="truncate font-mono text-xs text-muted" aria-label="Signed in as">{me.user.username}</span>
              <button type="button" onClick={signOut} className="btn-quiet h-8 px-2 text-xs"><LogOut size={13} /> Sign out</button>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-1 font-mono text-[0.625rem] uppercase tracking-wider text-faint">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" />
            adaptive · not a diagnosis
          </div>
        </div>
      </aside>

      {/* Top bar on narrow screens */}
      <header className="sticky top-0 z-10 border-b border-line bg-paper/90 backdrop-blur-sm md:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Wordmark />
          {me && <Link to="/start" className="btn-primary min-h-[36px] px-3 text-sm"><Plus size={15} /> New</Link>}
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Main">
          {links.map(([to, label, , end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-sunken text-ink' : 'text-muted'}`}>{label}</NavLink>
          ))}
          {me && <button type="button" onClick={signOut} className="whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium text-muted">Sign out</button>}
        </nav>
      </header>

      <div className="min-w-0 flex-1">{main}</div>
    </div>
  );
}
