// Session runner: asks the engine for the next administrable unit and hands it to the runner for
// its protocol. Sessions are resumable: reloading the page re-serves the open unit.
// A new live session first shows a "preparing" screen while its first questions are written (two per
// area), so the questions that follow appear without waiting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import type { Variant } from '@cognimetric/core';
import { api, type NextResponse, type Progress, type Unit } from '../api';
import { Layout, ThemeSwitcher } from '../components/Layout';
import { DomainSidebar, ProgressBar } from '../components/QuestionCard';
import { Button, Card, Notice, Spinner } from '../components/ui';
import { domainMeta } from '../components/domains';
import { EncodeDelayRetrieve, ProbeCapture, SingleItem } from '../runners/ItemRunners';
import { TimedBlock } from '../runners/TimedBlock';
import { loadDisplay } from '../store';

const BLOCK_NAMES = ['Getting started', 'Adapting to you', 'Checking a few results'];
/** Longest the preparing screen waits before starting with whatever is ready (stored questions fill gaps). */
const PREPARE_CAP_MS = 60_000;

interface Prepare {
  mode: string; served: number; settled: boolean; provider_paused: boolean;
  target_per_domain: number; ready_total: number; target_total: number;
  domains: { plugin_id: string; name: string; ready: number; generating: number }[];
}

function Preparing({ status, elapsed, onStart }: { status: Prepare | null; elapsed: number; onStart: () => void }) {
  const pct = status && status.target_total ? Math.round((status.ready_total / status.target_total) * 100) : 0;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="panel overflow-hidden">
        <div className="px-6 pb-6 pt-7 sm:px-8">
          <p className="eyebrow">Preparing your session</p>
          <h1 className="mt-2 text-3xl font-semibold">Writing your first questions</h1>
          <p className="mt-2 text-muted">Every question is written for you and checked before you see it. Once these are ready, the session runs without waiting; new questions are written in the background as you answer.</p>
          <div className="mt-6 flex items-center justify-between font-mono text-sm text-muted">
            <span><b className="text-ink">{status?.ready_total ?? 0}</b> of {status?.target_total ?? '…'} ready</span>
            <span>{pct}%</span>
          </div>
          <div className="progress-track mt-2"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
        </div>
        <ul className="divide-y divide-line/70 border-t border-line/70">
          {(status?.domains ?? []).map((d) => {
            const Icon = domainMeta(d.plugin_id)?.icon;
            const done = d.ready >= (status?.target_per_domain ?? 2);
            const stopped = !done && d.generating === 0;
            return (
              <li key={d.plugin_id} className="flex items-center gap-3 px-6 py-3.5 sm:px-8">
                {Icon && <span className="domain-icon !h-8 !w-8"><Icon size={15} /></span>}
                <span className="flex-1 font-medium">{d.name}</span>
                <span className="font-mono text-xs text-muted">{Math.min(d.ready, status?.target_per_domain ?? 2)}/{status?.target_per_domain ?? 2}</span>
                {done ? <span className="grid h-6 w-6 place-items-center rounded-full bg-good/15 text-good"><Check size={14} /></span>
                  : stopped ? <span className="rounded-full bg-sunken px-2 py-0.5 text-[0.6875rem] text-muted" title="Saved questions you have not seen will be used for this area">saved</span>
                  : <Loader2 size={16} className="animate-spin text-accent" aria-label="writing" />}
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 bg-paper/40 px-6 py-4 sm:px-8">
          <p className="text-sm text-muted">
            {status?.provider_paused ? 'The question writer is busy right now, so saved questions will be used.' : elapsed > 20_000 ? 'Taking a little longer than usual. You can start now; saved questions fill any gaps.' : 'Usually ready within half a minute.'}
          </p>
          <Button onClick={onStart}>Start now</Button>
        </div>
      </div>
    </div>
  );
}

function ExitDialog({ onStay, onExit, inBlock = false }: { onStay: () => void; onExit: () => void; inBlock?: boolean }) {
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onStay(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onStay]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="exit-title">
      <div className="panel w-full max-w-md p-6">
        <h2 id="exit-title" className="text-xl font-semibold">Leave this session?</h2>
        <p className="mt-2 text-muted">Your answers so far are saved. You can continue from where you stopped within 24 hours from your <b className="text-ink">Dashboard</b>.</p>
        {inBlock && <p className="mt-2 text-sm text-muted">The timed task you are in will start again from its beginning when you come back.</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button ref={stay} variant="secondary" onClick={onStay}>Keep going</Button>
          <Button variant="danger" onClick={onExit}>Exit session</Button>
        </div>
      </div>
    </div>
  );
}

export function Session() {
  const { id } = useParams();
  const nav = useNavigate();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [counter, setCounter] = useState(0);
  const [slow, setSlow] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [prep, setPrep] = useState<Prepare | null>(null);
  const [preparing, setPreparing] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const display = loadDisplay();
  const variant: Variant = display.highContrast ? 'high_contrast' : display.large ? 'large' : 'default';

  const fetchNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSlow(false);
    const t = window.setTimeout(() => setSlow(true), 1500);
    try {
      const n = await api<NextResponse>('GET', `/sessions/${id}/next`);
      if (n.done) return nav(`/session/${id}/report`, { replace: true });
      setUnit(n.unit!);
      setCounter((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      window.clearTimeout(t);
      setLoading(false);
    }
  }, [id, nav]);

  // Preparation: poll until the first questions are written (or nothing is left running), then start.
  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    void (async () => {
      while (alive) {
        try {
          const s = await api<Prepare>('GET', `/sessions/${id}/prepare`);
          if (!alive) return;
          setPrep(s);
          if (s.settled || performance.now() - t0 > PREPARE_CAP_MS) break;
        } catch {
          break; // the session runner shows any real error
        }
        setElapsed(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (alive) setPreparing(false);
    })();
    return () => { alive = false; };
  }, [id]);

  useEffect(() => { if (!preparing) void fetchNext(); }, [preparing, fetchNext]);

  // Keep the last progress while the next question loads, so the counts don't flicker away.
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => { if (unit?.kind === 'item') setProgress(unit.progress); }, [unit]);
  const inBlock = unit?.kind === 'item' && unit.protocol === 'timed_block' && !loading;
  const activeId = unit?.kind === 'item' || unit?.kind === 'probe_capture' ? unit.plugin.id : undefined;

  // Always visible, including during timed tasks: leaving mid-task is safe, the task restarts on resume.
  const exitButton = (
    <button
      type="button"
      onClick={() => setExiting(true)}
      className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-line bg-surface/80 py-1 pl-1 pr-4 text-sm font-medium text-muted shadow-sm backdrop-blur transition-colors hover:border-line-strong hover:text-ink"
      aria-label="Exit session"
      title="Exit session"
    >
      <span className="grid h-8 w-8 place-items-center rounded-full bg-sunken text-ink transition-transform group-hover:-translate-x-0.5"><ArrowLeft size={17} /></span>
      Exit
    </button>
  );

  if (preparing && (!prep || prep.mode === 'live') && !(prep && prep.served > 0)) {
    return (
      <Layout chrome={false} wide>
        <div className="mb-8 flex items-center justify-between gap-3">{exitButton}<div className="w-32 shrink-0"><ThemeSwitcher /></div></div>
        <Preparing status={prep} elapsed={elapsed} onStart={() => setPreparing(false)} />
        {exiting && <ExitDialog onStay={() => setExiting(false)} onExit={() => nav('/history')} />}
      </Layout>
    );
  }

  return (
    <Layout chrome={false} wide>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        {exitButton}
        <div className="flex items-center gap-3">
          {!inBlock && <Button variant="secondary" onClick={() => setPaused(true)}>Take a break</Button>}
          <div className="w-32 shrink-0"><ThemeSwitcher /></div>
        </div>
      </div>
      <div className="mb-6">
        <p className="eyebrow mb-2">{progress ? BLOCK_NAMES[progress.block_index] ?? 'Session' : 'Session'}</p>
        {progress && <ProgressBar progress={progress} />}
      </div>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
      {/* The question is unmounted while paused or while the exit dialog is open, so its timer does not
          run out behind it; it is re-served in full afterwards. */}
      {paused || exiting ? (
        <Card>
          <h1 className="mb-2 text-2xl font-semibold">Paused</h1>
          <p className="mb-5 text-muted">Take as long as you need. You can also close this page and come back to the same address within 24 hours to continue where you left off.</p>
          <Button size="lg" onClick={() => setPaused(false)}>Continue</Button>
        </Card>
      ) : error ? (
        <Notice tone="bad" title="Something went wrong">{error}<div className="mt-3"><Button onClick={fetchNext}>Try again</Button></div></Notice>
      ) : loading || !unit ? (
        <Card>
          <Spinner label={slow ? 'Getting your next question' : 'Preparing the next task'} />
          {slow && <p className="mt-3 text-sm text-muted">If a new question is not ready in a few seconds, a checked question you have not seen before is used instead.</p>}
        </Card>
      ) : unit.kind === 'probe_capture' ? (
        <ProbeCapture key={counter} unit={unit} sessionId={id!} onFinished={fetchNext} />
      ) : unit.protocol === 'timed_block' ? (
        <TimedBlock key={`${unit.administration_id}-${unit.block?.attempt}-${counter}`} unit={unit} sessionId={id!} variant={variant} onFinished={fetchNext} />
      ) : unit.protocol === 'encode_delay_retrieve' ? (
        <EncodeDelayRetrieve key={`${unit.administration_id}-${counter}`} unit={unit} sessionId={id!} onFinished={fetchNext} />
      ) : (
        <SingleItem key={`${unit.administration_id}-${counter}`} unit={unit} sessionId={id!} onFinished={fetchNext} />
      )}
      </div>
      {progress && <aside className="order-2" aria-label="Domains"><DomainSidebar progress={progress} activeId={activeId} /></aside>}
      </div>
      {exiting && <ExitDialog inBlock={inBlock} onStay={() => setExiting(false)} onExit={() => nav('/history')} />}
    </Layout>
  );
}
