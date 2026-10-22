// timed_block protocol end to end (Doc 01 §4.1): device calibration → instructions (with optional
// read-aloud, unlimited reading time) → practice with a pass gate and unlimited repeats (never
// scored; after a missed practice the user may also start the task anyway, and the attempt count is
// sent with the block) → timed run → one aggregate submission. Trials run imperatively against the DOM, outside
// React rendering, so onset timing is frame-accurate. No pause is offered inside a block.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderStimulus, type DeviceProfile, type ResponseOption, type Stimulus, type TrialResult, type TrialSpec, type Variant } from '@cognimetric/core';
import { api, type ItemUnitBase } from '../api';
import { Button, Card, Notice, Svg } from '../components/ui';
import { QuestionCard, taskLabel } from '../components/QuestionCard';
import { load, save } from '../store';
import { TimingMonitor, calibrateDevice, clockOffset, inputDeviceOf, nextFrame, sleep, waitUntil } from '../timing/harness';

type Phase = 'calibrating' | 'instructions' | 'practice' | 'practice_feedback' | 'ready' | 'running' | 'submitting' | 'message';

interface RunOutcome { results: TrialResult[]; aborted: null | 'focus_lost' | 'degraded_trials'; accuracy: number; wallMs: number; device: 'touch' | 'mouse' | 'keyboard' | 'pen' }

const stimSize = (s: Stimulus): [number, number] => (s.kind === 'symbol_row' ? [720, 110] : s.kind === 'pair' ? [520, 300] : [420, 420]);

class TrialRunner {
  armed: { onset: number; resolve: (r: { id: string; ts: number; dev: RunOutcome['device'] }) => void } | null = null;
  device: RunOutcome['device'] = 'mouse';
  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const opt = this.responses.find((r) => r.key.toLowerCase() === e.key.toLowerCase() || (r.key === ' ' && e.code === 'Space'));
    if (!opt) return;
    e.preventDefault();
    this.respond(opt.id, e);
  };

  constructor(private stage: HTMLElement, private buffer: HTMLElement, private feedback: HTMLElement, private nudge: HTMLElement, private responses: ResponseOption[], private variant: Variant, private monitor: TimingMonitor) {}

  attach() { window.addEventListener('keydown', this.onKey); }
  detach() { window.removeEventListener('keydown', this.onKey); }

  respond(id: string, e: Event) {
    if (!this.armed) return; // responses before onset are not recorded as trial responses
    this.device = inputDeviceOf(e);
    // event.timeStamp shares performance.now()'s origin in current browsers; fall back if it does not.
    const ts = e.timeStamp > 0 && Math.abs(e.timeStamp - performance.now()) < 10_000 ? e.timeStamp : performance.now();
    const a = this.armed;
    this.armed = null;
    a.resolve({ id, ts, dev: this.device });
  }

  async run(trials: TrialSpec[], opts: { feedback: boolean; durationS: number | null; mode: 'paced' | 'self_paced'; nudge: { max_mean_rt_ms: number; message: string } | null; signal: { aborted: boolean } }): Promise<RunOutcome> {
    const fp = this.monitor.framePeriod;
    const results: TrialResult[] = [];
    const start = performance.now();
    let firstOnset: number | null = null;
    let correct = 0;
    const recent: number[] = [];
    let cursor = performance.now();
    this.stage.replaceChildren();
    for (const t of trials) {
      if (opts.signal.aborted) break;
      if (this.monitor.currentLoss() > 2000 || this.monitor.focusLostMs > 2000) return { results, aborted: 'focus_lost', accuracy: 0, wallMs: performance.now() - start, device: this.device };
      if (opts.durationS && firstOnset !== null && performance.now() - firstOnset >= opts.durationS * 1000) break;
      // Pre-rasterise the next stimulus off-screen during the foreperiod.
      const [w, h] = stimSize(t.stimulus);
      this.buffer.innerHTML = renderStimulus(t.stimulus, this.variant, `s${t.index}`, w, h);
      await waitUntil(cursor + t.foreperiod_ms, fp);
      // Commit on f1; the onset timestamp is taken on f2, after f1's paint.
      const f1 = await nextFrame();
      this.stage.replaceChildren(...Array.from(this.buffer.childNodes));
      const f2 = await nextFrame();
      const onset = performance.now();
      firstOnset ??= onset;
      const frameDelta = f2 - f1;
      const response = new Promise<{ id: string; ts: number; dev: RunOutcome['device'] } | null>((resolve) => {
        this.armed = { onset, resolve };
        setTimeout(() => { if (this.armed?.onset === onset) { this.armed = null; resolve(null); } }, t.response_window_ms);
      });
      let hideTimer: number | undefined;
      if (t.stimulus_duration_ms !== null) hideTimer = window.setTimeout(() => requestAnimationFrame(() => this.stage.replaceChildren()), Math.max(0, t.stimulus_duration_ms - fp / 2));
      const r = await response;
      const rt = r ? Math.max(0, Math.round((r.ts - onset) * 10) / 10) : null;
      // Paced trials with a fixed exposure keep their rhythm; stimuli that wait for a response end at it.
      const end = t.stimulus_duration_ms === null && r ? performance.now() : onset + t.response_window_ms;
      if (t.stimulus_duration_ms === null || !r) { window.clearTimeout(hideTimer); this.stage.replaceChildren(); }
      if (end > performance.now()) await sleep(end - performance.now());
      cursor = performance.now();
      const verdict = this.monitor.verdict(onset - fp, Math.max(end, onset + 1), true, frameDelta);
      const isCorrect = (t.correct === null && !r) || (r !== null && r.id === t.correct);
      if (isCorrect) correct++;
      results.push({ index: t.index, onset_ms: Math.round((onset - start) * 10) / 10, response: r?.id ?? null, rt_ms: rt, timing_quality: verdict, focus_lost_ms: Math.round(this.monitor.focusLostMs) });
      if (rt !== null) {
        recent.push(rt);
        if (recent.length > 8) recent.shift();
        if (opts.nudge && recent.length >= 6) this.nudge.textContent = recent.reduce((a, b) => a + b, 0) / recent.length > opts.nudge.max_mean_rt_ms ? opts.nudge.message : '';
      }
      if (opts.feedback) {
        this.feedback.textContent = isCorrect ? 'Correct' : t.correct === null ? 'That one needed no response' : r ? 'Not quite' : 'Too slow';
        await sleep(650);
        this.feedback.textContent = '';
        cursor = performance.now();
      }
    }
    this.stage.replaceChildren();
    const usable = results.length || 1;
    const degraded = results.filter((x) => x.timing_quality === 'degraded').length / usable;
    return { results, aborted: degraded > 0.1 && !opts.feedback ? 'degraded_trials' : null, accuracy: correct / usable, wallMs: performance.now() - start, device: this.device };
  }
}

export function TimedBlock({ unit, sessionId, variant, onFinished }: { unit: ItemUnitBase; sessionId: string; variant: Variant; onFinished: () => void }) {
  const block = unit.block!;
  const [phase, setPhase] = useState<Phase>('calibrating');
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);
  const [practiceAcc, setPracticeAcc] = useState<number | null>(null);
  const [practiceAttempts, setPracticeAttempts] = useState(0);
  const [device, setDevice] = useState<DeviceProfile | null>(load<DeviceProfile | null>(`device.${sessionId}`, null, true));
  const stageRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const nudgeRef = useRef<HTMLParagraphElement>(null);
  const runnerRef = useRef<TrialRunner | null>(null);
  const signal = useRef({ aborted: false });
  const large = unit.large_targets;

  const persistent = useMemo(() => (block.persistent ? renderStimulus(block.persistent, variant, 'persist', block.persistent.kind === 'symbol_key' ? 720 : 140, block.persistent.kind === 'symbol_key' ? 150 : 140) : null), [block.persistent, variant]);

  // Device calibration once per session.
  useEffect(() => {
    if (device) { setPhase('instructions'); return; }
    let cancelled = false;
    void calibrateDevice(() => { if (bufferRef.current) bufferRef.current.innerHTML = renderStimulus(block.trials[0]!.stimulus, variant, 'cal', 420, 420); }).then((d) => {
      if (cancelled) return;
      save(`device.${sessionId}`, d, true);
      setDevice(d);
      setPhase('instructions');
    });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    signal.current.aborted = false; // StrictMode re-mounts: the abort signal must reset with the component
    return () => { signal.current.aborted = true; runnerRef.current?.detach(); };
  }, []);

  const makeRunner = useCallback(() => {
    const monitor = new TimingMonitor(device?.frame_period_ms ?? 16.7);
    const r = new TrialRunner(stageRef.current!, bufferRef.current!, feedbackRef.current!, nudgeRef.current!, block.responses, variant, monitor);
    runnerRef.current = r;
    return { r, monitor };
  }, [device, block.responses, variant]);

  const readAloud = () => {
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${block.instruction_text} ${block.rule_reminder}`));
    } catch { /* speech unavailable */ }
  };

  async function runPractice() {
    setPhase('practice');
    await nextFrame();
    const { r, monitor } = makeRunner();
    monitor.start();
    r.attach();
    const out = await r.run(block.practice, { feedback: block.feedback_in_practice, durationS: null, mode: block.mode, nudge: null, signal: signal.current });
    r.detach();
    monitor.stop();
    setPracticeAttempts((n) => n + 1);
    setPracticeAcc(out.accuracy);
    setPhase('practice_feedback');
  }

  async function runBlock() {
    setPhase('running');
    await nextFrame();
    const offset = await clockOffset();
    const { r, monitor } = makeRunner();
    monitor.start();
    r.attach();
    const out = await r.run(block.trials, { feedback: false, durationS: block.duration_s, mode: block.mode, nudge: block.nudge, signal: signal.current });
    r.detach();
    monitor.stop();
    if (signal.current.aborted) return;
    setPhase('submitting');
    try {
      const res = await api<{ verdict: string; reason?: string }>('POST', `/sessions/${sessionId}/blocks/${unit.administration_id}/complete`, {
        sequence_hash: block.sequence_hash, attempt: block.attempt, status: out.aborted ? 'aborted' : 'completed', abort_reason: out.aborted,
        wall_ms: Math.round(out.wallMs), client_clock_offset_ms: offset, input_device: out.device, device_profile: device, practice_attempts: practiceAttempts, trials: out.results,
      });
      if (res.verdict === 'scored') return onFinished();
      if (res.verdict === 'reoffer') {
        setMessage({ title: 'Let’s try that block once more', body: res.reason === 'focus_lost' ? 'The window lost focus during the block, so it has to restart from the beginning. Please keep this window in front until the block ends.' : res.reason === 'accuracy_below_90' ? 'Quite a few answers were mistakes. Please read the instructions again: accuracy matters as well as speed.' : 'The timing of that block was not reliable enough to use (for example, the device was busy). It will restart with new trials.' });
      } else setMessage({ title: 'This block could not be measured', body: res.verdict === 'quarantined' ? 'The submitted data failed the server’s consistency checks, so it was set aside.' : 'It will be reported as not measured rather than given a possibly wrong score. You can carry on with the rest of the session.' });
      setPhase('message');
    } catch (e) {
      setMessage({ title: 'Could not save this block', body: (e as Error).message });
      setPhase('message');
    }
  }

  const btnSize = large ? 'min-h-[72px] min-w-[120px] text-xl' : 'min-h-[56px] min-w-[96px] text-lg';
  const showStage = phase === 'practice' || phase === 'running';
  const passed = practiceAcc !== null && practiceAcc >= block.practice_pass_accuracy;
  const keyHint = block.responses.map((r) => (r.key === ' ' ? 'Space bar' : r.key.startsWith('Arrow') ? r.key.replace('Arrow', '') + ' arrow' : r.key.toUpperCase())).join(' / ');

  return (
    <div className="space-y-5">
      {!showStage && phase !== 'calibrating' && phase !== 'submitting' && phase !== 'message' && (
        <QuestionCard unit={unit} kind={`${taskLabel(unit.task_type)} · timed task`} foot={['Timed task · no pause once it starts', `Respond with ${keyHint}`]}>
          <h2 className="qcard-prompt mb-4">{phase === 'ready' ? 'Practice done' : 'How this task works'}</h2>
          <p className="mb-3 text-lg leading-relaxed">{block.instruction_text}</p>
          <p className="mb-5 text-muted">Respond with {keyHint}, or tap the buttons under the task. Take as long as you like to read this. There is no pause once the task starts.</p>
          {persistent && <div className="stage mb-5 flex justify-center rounded-md border border-line bg-paper p-3"><Svg svg={persistent} className="max-w-[560px] w-full" label="Reference shown during the task" /></div>}
          {phase === 'practice_feedback' && (
            <div className="mb-5">
              {passed ? <Notice title="Practice passed">You got {Math.round((practiceAcc ?? 0) * 100)} % right. Practice is never scored.</Notice>
                : <Notice tone="warn" title="Practice not passed yet">You got {Math.round((practiceAcc ?? 0) * 100)} % right; {Math.round(block.practice_pass_accuracy * 100)} % passes. Read the instructions again and practise once more, or start the task now if you feel ready.</Notice>}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={readAloud}>Read aloud</Button>
            {phase === 'instructions' && <Button size="lg" onClick={runPractice}>Start practice</Button>}
            {phase === 'practice_feedback' && !passed && <Button size="lg" onClick={runPractice}>Practise again</Button>}
            {phase === 'practice_feedback' && !passed && <Button size="lg" variant="secondary" onClick={() => setPhase('ready')}>Start the task anyway</Button>}
            {phase === 'practice_feedback' && passed && <Button size="lg" onClick={() => setPhase('ready')}>Continue</Button>}
            {phase === 'ready' && <Button size="lg" onClick={runBlock}>Start the task</Button>}
          </div>
        </QuestionCard>
      )}
      {phase === 'calibrating' && <Card><p className="text-lg font-bold">Checking this device’s display timing…</p><p className="text-muted">This takes about five seconds. Please keep this window in front.</p></Card>}
      {phase === 'submitting' && <Card><p className="text-lg font-bold">Saving…</p></Card>}
      {phase === 'message' && message && (
        <Card>
          <h2 className="mb-2 text-xl font-semibold">{message.title}</h2>
          <p className="mb-5 leading-relaxed">{message.body}</p>
          <Button size="lg" onClick={onFinished}>Continue</Button>
        </Card>
      )}
      <div hidden={!showStage} className="qcard">
        <div className="qcard-meta">
          <span className="min-w-0"><span className="text-accent">{unit.plugin.name}</span> · Q{unit.progress.served} · {taskLabel(unit.task_type)}{phase === 'practice' ? ' · practice' : ''}</span>
        </div>
        <div className="p-4">
        <p className="mb-3 text-center text-lg font-semibold" aria-live="off">{block.rule_reminder}{phase === 'practice' ? ' (practice)' : ''}</p>
        {persistent && block.persistent_position === 'top' && <div className="stage mb-10 flex justify-center"><Svg svg={persistent} className="max-w-[560px] w-full" /></div>}
        <div className="flex min-h-[340px] flex-col items-center justify-center">
          {persistent && block.persistent_position === 'adjacent' && <div className="stage mb-2 flex w-full justify-center"><Svg svg={persistent} className="max-w-[560px] w-full" /></div>}
          <div
            ref={stageRef}
            className="stage flex min-h-[300px] w-full max-w-[560px] items-center justify-center [&>svg]:max-h-[320px]"
            onPointerDown={(e) => { if (block.responses.length === 1) runnerRef.current?.respond(block.responses[0]!.id, e.nativeEvent); }}
            aria-label="Task area"
          />
        </div>
        <div ref={bufferRef} aria-hidden="true" style={{ position: 'absolute', left: -10000, top: 0, visibility: 'hidden' }} />
        <p ref={feedbackRef} className="h-7 text-center text-lg font-bold" aria-live="polite" />
        <p ref={nudgeRef} className="h-7 text-center font-bold text-warn" aria-live="polite" />
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          {block.responses.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`${btnSize} rounded border-2 border-line-strong bg-paper px-4 font-semibold active:border-accent`}
              onPointerDown={(e) => { e.preventDefault(); runnerRef.current?.respond(r.id, e.nativeEvent); }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
              aria-label={r.label}
            >
              {r.glyph ? <span className="stage inline-block h-10 w-10"><Svg svg={renderStimulus(r.glyph, variant, `g${r.id}`, 80, 80)} /></span> : null}
              <span>{r.label}</span>
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}
