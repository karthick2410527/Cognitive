// Session runner: asks the engine for the next administrable unit and hands it to the runner for
// its protocol. Sessions are resumable: reloading the page re-serves the open unit.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Variant } from '@cognimetric/core';
import { api, type NextResponse, type Progress, type Unit } from '../api';
import { Layout } from '../components/Layout';
import { DomainSidebar, ProgressBar } from '../components/QuestionCard';
import { Button, Card, Notice, Spinner } from '../components/ui';
import { EncodeDelayRetrieve, ProbeCapture, SingleItem } from '../runners/ItemRunners';
import { TimedBlock } from '../runners/TimedBlock';
import { loadDisplay } from '../store';

const BLOCK_NAMES = ['Getting started', 'Adapting to you', 'Checking a few results'];

export function Session() {
  const { id } = useParams();
  const nav = useNavigate();
  const [unit, setUnit] = useState<Unit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [counter, setCounter] = useState(0);
  const [slow, setSlow] = useState(false);
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

  useEffect(() => { void fetchNext(); }, [fetchNext]);

  // Keep the last progress while the next question loads, so the counts don't flicker away.
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => { if (unit?.kind === 'item') setProgress(unit.progress); }, [unit]);
  const inBlock = unit?.kind === 'item' && unit.protocol === 'timed_block' && !loading;
  const activeId = unit?.kind === 'item' || unit?.kind === 'probe_capture' ? unit.plugin.id : undefined;

  return (
    <Layout chrome={false} wide>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-2">{progress ? BLOCK_NAMES[progress.block_index] ?? 'Session' : 'Session'}</p>
          {progress && <ProgressBar progress={progress} />}
        </div>
        {!inBlock && <Button variant="secondary" onClick={() => setPaused(true)}>Take a break</Button>}
      </div>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
      {paused ? (
        <Card>
          <h1 className="mb-2 text-2xl font-semibold">Paused</h1>
          <p className="mb-5 text-muted">Take as long as you need. You can also close this page and come back to the same address within 24 hours to continue where you left off.</p>
          <Button size="lg" onClick={() => setPaused(false)}>Continue</Button>
        </Card>
      ) : error ? (
        <Notice tone="bad" title="Something went wrong">{error}<div className="mt-3"><Button onClick={fetchNext}>Try again</Button></div></Notice>
      ) : loading || !unit ? (
        <Card>
          <Spinner label={slow ? 'Writing a new question for you' : 'Preparing the next task'} />
          {slow && <p className="mt-3 text-sm text-muted">Questions in this session are written as you go and checked before you see them. This can take up to half a minute; if it takes longer, a question that was checked earlier is used instead.</p>}
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
    </Layout>
  );
}

