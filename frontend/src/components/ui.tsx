import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = { primary: 'btn-primary', secondary: 'btn-ghost', ghost: 'btn-quiet', danger: 'btn-danger' };
export const buttonCls = (variant: Variant = 'primary', size: 'md' | 'lg' = 'md') =>
  `${VARIANT[variant]} ${size === 'lg' ? 'min-h-[52px] px-6 text-base' : 'min-h-[44px] px-4 text-sm'}`;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' }>(function Button(
  { variant = 'primary', size = 'md', className = '', ...rest },
  ref,
) {
  return <button ref={ref} className={`${buttonCls(variant, size)} ${className}`} {...rest} />;
});

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`panel p-5 sm:p-6 ${className}`}>{children}</section>;
}

/** Small "// label" line above a heading. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow mb-1.5">{children}</p>;
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' }) {
  const t = {
    neutral: 'border-line text-muted bg-paper',
    good: 'border-good/40 text-good bg-good/10',
    warn: 'border-warn/40 text-warn bg-warn/10',
    bad: 'border-bad/40 text-bad bg-bad/10',
    accent: 'border-accent/40 text-accent bg-accent/10',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Notice({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'warn' | 'bad'; title?: string }) {
  const t = { neutral: 'border-l-line-strong', warn: 'border-l-warn', bad: 'border-l-bad' }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'note'} className={`rounded-2xl border border-line/80 border-l-[3px] bg-surface p-4 shadow-sm ${t}`}>
      {title && <p className="mb-1 font-display font-semibold">{title}</p>}
      <div className="text-[0.95rem] leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** Headline number with a mono caption, as on a dashboard. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel px-5 py-4">
      <p className="text-xs font-medium leading-tight text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-sm text-muted">{sub}</p>}
    </div>
  );
}

/** Renders SVG produced by the engine's own deterministic renderer (never model-authored markup). */
export function Svg({ svg, className = '', label }: { svg: string; className?: string; label?: string }) {
  return <div className={`svg-fit ${className}`} role={label ? 'img' : undefined} aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function Field({ label, hint, children, id }: { label: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label">{label}</label>
      {hint && <p id={`${id}-hint`} className="text-sm text-muted">{hint}</p>}
      {children}
    </div>
  );
}

export const inputCls = 'field min-h-[44px]';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 font-mono text-sm text-muted">
      <span className="inline-block h-4 w-4 rounded-full border-2 border-muted border-t-transparent" style={{ animation: 'spin 0.9s linear infinite' }} />
      <span>{label}…</span>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
