// "Spec-sheet" question card: a dashed meta line (domain · question number · task), the body, and a
// dashed footer. Every runner renders inside one, so the domain of each question is always shown.
import type { ReactNode } from 'react';
import type { DomainProgress, ItemUnitBase, Progress } from '../api';
import { Pill } from './ui';

export const taskLabel = (taskType: string) => taskType.replace(/_block$/, '').replace(/_/g, ' ');

export function QuestionCard({ unit, kind, foot, children }: { unit: ItemUnitBase; kind?: string; foot?: [ReactNode, ReactNode]; children: ReactNode }) {
  const source = (unit as { source?: string }).source;
  const modality = (unit as { modality?: string | null }).modality;
  return (
    <article className="qcard" aria-label={`${unit.plugin.name} question`}>
      <div className="qcard-meta">
        <span className="min-w-0">
          <span className="text-accent">{unit.plugin.name}</span> · Q{unit.progress.served} · {kind ?? taskLabel(unit.task_type)}
        </span>
        {source && (
          <span title={source === 'live' ? 'Written for this session and checked automatically' : 'From the pre-checked question bank'} className="shrink-0">
            <Pill tone={source === 'live' ? 'accent' : 'neutral'}>{source === 'live' ? 'live' : 'bank'}{modality ? ` · ${modality}` : ''}</Pill>
          </span>
        )}
      </div>
      <div className="qcard-body">{children}</div>
      {foot && (
        <div className="qcard-foot">
          <span>{foot[0]}</span>
          <span>{foot[1]}</span>
        </div>
      )}
    </article>
  );
}

const R = 17;
const C = 2 * Math.PI * R;

export function TimerRing({ secondsLeft, totalSeconds }: { secondsLeft: number; totalSeconds: number }) {
  const ratio = totalSeconds > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSeconds)) : 0;
  const state = ratio <= 0.15 ? 'danger' : ratio <= 0.4 ? 'warn' : '';
  return (
    <div className={`ring-timer ${state}`} role="timer" aria-label={`${Math.max(0, Math.ceil(secondsLeft))} seconds left`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="track" cx="20" cy="20" r={R} />
        <circle className="fill" cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - ratio)} />
      </svg>
      <span aria-hidden="true">{Math.max(0, Math.ceil(secondsLeft))}</span>
    </div>
  );
}

export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = Math.min(100, (progress.served / progress.max_items) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 font-mono text-sm text-muted">
        <span aria-live="polite">
          Question <span className="font-semibold text-ink">{progress.served}</span> {progress.fixed_length ? 'of' : 'of up to'} {progress.max_items}
          {progress.mode === 'live' && <span className="hidden sm:inline"> · {progress.live_served} written live</span>}
        </span>
        <span className="tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Session progress">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const PLAN: Record<NonNullable<DomainProgress['plan']>, { label: string; tone: 'accent' | 'neutral' | 'good' }> = {
  more: { label: 'more', tone: 'accent' },
  normal: { label: 'fewer', tone: 'neutral' },
  none: { label: 'done', tone: 'good' },
};

/**
 * One row per domain. No right/wrong counts: answers are not revealed during a measured session.
 * The bar shows measurement precision — how far the domain's SE has come from 1 (no information)
 * towards its target.
 */
export function DomainSidebar({ progress, activeId }: { progress: Progress; activeId?: string }) {
  const live = progress.mode === 'live';
  return (
    <div className="space-y-2">
      <p className="eyebrow">Domains</p>
      {progress.domains.map((d) => {
        const precision = d.unmeasured ? 0 : Math.max(0, Math.min(1, (1 - d.se) / Math.max(0.01, 1 - d.target_se)));
        return (
          <div key={d.plugin} className={`domain-row ${d.plugin === activeId ? 'domain-row-active' : ''}`} aria-current={d.plugin === activeId ? 'true' : undefined}>
            <div className="flex items-center justify-between gap-2">
              <span className="domain-row-name">{d.name}</span>
              {live && d.plan && !d.unmeasured && (
                <span title={d.plan_reason}><Pill tone={PLAN[d.plan].tone}>{PLAN[d.plan].label}</Pill></span>
              )}
            </div>
            <div className="domain-row-stats">
              {d.unmeasured ? <span>not measured</span> : <span>{d.n} asked</span>}
              {live && !d.unmeasured && (
                <>
                  <span>·</span>
                  <span>{d.ready ?? 0} ready</span>
                  {!!d.generating && (
                    <>
                      <span>·</span>
                      <span className="text-accent">{d.generating} writing</span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="domain-bar-track" title={`Precision: SE ${d.se.toFixed(2)}, target ${d.target_se}`}>
              <div className="domain-bar-fill" style={{ width: `${Math.round(precision * 100)}%` }} />
            </div>
          </div>
        );
      })}
      {live && <p className="px-1 pt-1 text-xs leading-relaxed text-muted">The bar fills as an area's score becomes precise. "More" keeps two new questions ready for an uncertain area, "fewer" keeps one, "done" stops writing.</p>}
    </div>
  );
}
