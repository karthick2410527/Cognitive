// Runners for the 'single' and 'encode_delay_retrieve' protocols, plus delayed-recall capture.
import { useEffect, useRef, useState } from 'react';
import { api, type ItemUnitBase, type ProbeCaptureUnit } from '../api';
import { Button, Card, Notice, Svg, inputCls } from '../components/ui';
import { nextFrame, sleep } from '../timing/harness';
import { QuestionCard, taskLabel as taskLabelOf } from '../components/QuestionCard';
import { ChoiceGrid, choiceFoot, type ChoiceAnswer } from './ChoiceItem';
import { DelayFiller } from './Fillers';

const uuid = () => crypto.randomUUID();

async function postAnswer(sessionId: string, adminId: string, phase: 'present' | 'retrieve', probe: number, a: ChoiceAnswer) {
  return api<{ recorded: boolean; complete: boolean; feedback?: { correct: boolean } }>('POST', `/sessions/${sessionId}/responses`, {
    response_uuid: uuid(), administration_id: adminId, phase, probe_index: probe,
    raw_input: a.choice === null ? { timeout: true } : { choice: a.choice },
    rt_ms: a.rt_ms, rt_source: 'event_timestamp', timing_quality: a.timing_quality, focus_lost_ms: a.focus_lost_ms, input_device: a.input_device,
  });
}

export function SingleItem({ unit, sessionId, onFinished }: { unit: ItemUnitBase; sessionId: string; onFinished: () => void }) {
  const r = unit.render!;
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isSvg = unit.renderer === 'svg';
  // Codes, letter lines and number rows: every character the same width, look-alikes kept distinct.
  const mono = r.display_style === 'mono';
  return (
    <QuestionCard unit={unit} kind={r.task_label ?? undefined} foot={choiceFoot(unit.response_spec.time_limit_ms, r.options.length)}>
      {isSvg && r.figure_svg && (
        <div className="stage mx-auto mb-6 max-w-[420px] rounded-md border border-line bg-paper p-3">
          <Svg svg={r.figure_svg} label={unit.text_alternative ?? 'Pattern grid with one missing piece'} />
        </div>
      )}
      {unit.text_alternative && isSvg && <details className="mb-4 text-sm text-muted"><summary className="cursor-pointer font-medium">Text description</summary><p className="mt-1">{unit.text_alternative}</p></details>}
      <ChoiceGrid
        prompt={
          <>
            {r.instruction && <p className={`mb-2 ${mono ? 'text-[1.05rem] font-medium text-ink' : 'text-muted'}`}>{r.instruction}</p>}
            <h2 className={mono && !r.display ? 'qcard-prompt break-words font-mono tracking-[0.12em]' : 'qcard-prompt'}>{r.stem}</h2>
            {r.display && <p className="mt-4 break-words rounded border border-line bg-paper px-4 py-3 font-mono text-xl leading-relaxed tracking-[0.18em]">{r.display}</p>}
          </>
        }
        options={r.options}
        kind={isSvg ? 'svg' : 'text'}
        mono={mono}
        limitMs={unit.response_spec.time_limit_ms ?? null}
        large={unit.large_targets}
        feedback={feedback}
        onAnswer={async (a) => {
          try {
            const res = await postAnswer(sessionId, unit.administration_id, 'present', 0, a);
            if (unit.reveal_feedback && res.feedback) { setFeedback(res.feedback.correct); await sleep(900); }
            onFinished();
          } catch (e) { setError((e as Error).message); }
        }}
      />
      {error && <div className="mt-4"><Notice tone="bad" title="Could not save the answer">{error} <Button variant="secondary" onClick={onFinished}>Retry</Button></Notice></div>}
    </QuestionCard>
  );
}

type EdrStage = 'announce' | 'encode' | 'delay' | 'retrieve';

export function EncodeDelayRetrieve({ unit, sessionId, onFinished }: { unit: ItemUnitBase; sessionId: string; onFinished: () => void }) {
  const r = unit.render! as { material: string; presentation: { exposure_ms: number; inter_stimulus_ms: number; positions?: [number, number][]; announce: string }; delay: { duration_ms: number; filler: string | null }; encode: { svg?: string; text?: string }[]; probes: { stem: string; cue: string | null; target_svg?: string | null; options: string[] }[] };
  const answered = (r as { answered_probes?: number[] }).answered_probes ?? [];
  const firstOpen = r.probes.findIndex((_, i) => !answered.includes(i));
  const [stage, setStage] = useState<EdrStage>(answered.length ? 'retrieve' : 'announce');
  const [shown, setShown] = useState<number | null>(null);
  const [probe, setProbe] = useState(answered.length ? Math.max(0, firstOpen) : 0);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function encode() {
    setStage('encode');
    for (let i = 0; i < r.encode.length && alive.current; i++) {
      await nextFrame();
      setShown(i);
      await sleep(r.presentation.exposure_ms);
      setShown(null);
      if (i < r.encode.length - 1) await sleep(r.presentation.inter_stimulus_ms);
    }
    if (alive.current) setStage('delay');
  }

  const pos = shown !== null ? r.presentation.positions?.[shown] ?? [0, 0] : [0, 0];
  const isText = r.material === 'word';
  const p = r.probes[probe];
  const foot: [string, string] = stage === 'retrieve' && p
    ? [`Recall question ${probe + 1} of ${r.probes.length}`, choiceFoot(unit.response_spec.per_probe_limit_ms, p.options.length)[1]]
    : stage === 'encode' ? ['Study', 'Just watch'] : stage === 'delay' ? ['Short break task', ''] : ['Remember, then answer', `${r.probes.length} questions`];
  return (
    <QuestionCard unit={unit} kind={`${taskLabelOf(unit.task_type)} · remember`} foot={foot}>
      {stage === 'announce' && (
        <div>
          <h2 className="qcard-prompt mb-3">Get ready to remember</h2>
          <p className="mb-2 text-lg leading-relaxed">{r.presentation.announce}</p>
          <p className="mb-5 text-muted">After that there is a short break task, and then some questions about what you saw.</p>
          <Button size="lg" onClick={encode}>Start</Button>
        </div>
      )}
      {stage === 'encode' && (
        <div className="relative mx-auto flex h-[360px] max-w-[560px] items-center justify-center rounded-md border border-line bg-paper" aria-live="off">
          <p className="absolute left-3 top-2 text-sm text-muted tabular">{shown !== null ? `${shown + 1} of ${r.encode.length}` : ''}</p>
          {shown !== null && (
            <div className="stage absolute" style={{ transform: `translate(${pos[0] * 150}px, ${pos[1] * 110}px)` }}>
              {isText ? <span className="text-4xl font-bold">{r.encode[shown]!.text}</span> : <div className="w-[170px]"><Svg svg={r.encode[shown]!.svg!} label="Picture to remember" /></div>}
            </div>
          )}
        </div>
      )}
      {stage === 'delay' && (
        <DelayFiller
          kind={r.delay.filler}
          durationMs={r.delay.duration_ms}
          onDone={(res) => {
            void api('POST', `/sessions/${sessionId}/responses`, { response_uuid: uuid(), administration_id: unit.administration_id, phase: 'delay', probe_index: 0, raw_input: { filler: res }, rt_ms: null }).catch(() => {});
            setStage('retrieve');
          }}
        />
      )}
      {stage === 'retrieve' && p && (
        <div key={probe}>
          <ChoiceGrid
            prompt={
              <>
                <h2 className="qcard-prompt">{p.stem}</h2>
                {p.cue && <p className="mt-2 text-muted">{p.cue}</p>}
                {p.target_svg && <div className="stage mt-3 w-[120px]"><Svg svg={p.target_svg} label="This picture" /></div>}
              </>
            }
            options={p.options}
            kind={isText ? 'text' : 'svg'}
            limitMs={unit.response_spec.per_probe_limit_ms ?? null}
            large={unit.large_targets}
            onAnswer={async (a) => {
              try {
                await postAnswer(sessionId, unit.administration_id, 'retrieve', probe, a);
                if (probe + 1 < r.probes.length) setProbe(probe + 1);
                else onFinished();
              } catch (e) { setError((e as Error).message); }
            }}
          />
        </div>
      )}
      {error && <div className="mt-4"><Notice tone="bad" title="Could not save the answer">{error}</Notice></div>}
    </QuestionCard>
  );
}

export function ProbeCapture({ unit, sessionId, onFinished }: { unit: ProbeCaptureUnit; sessionId: string; onFinished: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (skip: boolean) => {
    setBusy(true);
    await api('POST', `/sessions/${sessionId}/probes`, { answers: unit.questions.map((q) => ({ probe_id: q.probe_id, answer: skip ? null : answers[q.probe_id] ?? null })) }).catch(() => {});
    onFinished();
  };
  return (
    <Card className="!p-0">
      <div className="qcard-meta"><span><span className="text-accent">{unit.plugin.name}</span> · a few days from now</span></div>
      <div className="qcard-body">
      <h2 className="qcard-prompt mb-2">A few questions about today</h2>
      <p className="mb-5 text-muted">{unit.note} Please answer briefly. Do not include names.</p>
      <div className="space-y-5">
        {unit.questions.map((q, i) => (
          <div key={q.probe_id} className="space-y-1.5">
            <label htmlFor={`pq${i}`} className="block font-medium">{q.question}</label>
            <input id={`pq${i}`} className={inputCls} maxLength={300} autoComplete="off" value={answers[q.probe_id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.probe_id]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button size="lg" disabled={busy} onClick={() => submit(false)}>Save answers</Button>
        <Button variant="ghost" disabled={busy} onClick={() => submit(true)}>Skip these questions</Button>
      </div>
      </div>
    </Card>
  );
}
