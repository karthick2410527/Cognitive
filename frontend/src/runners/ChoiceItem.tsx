// Single-screen choice items and retrieval probes. RT runs from the frame on which the options were
// painted to the pointerdown / keydown event; option labels are added here, never by the model.
import React, { useEffect, useRef, useState } from 'react';
import { TimerRing } from '../components/QuestionCard';
import { Svg } from '../components/ui';
import { inputDeviceOf, nextFrame } from '../timing/harness';

export interface ChoiceAnswer { choice: number | null; rt_ms: number | null; input_device: 'touch' | 'mouse' | 'keyboard' | 'pen'; timing_quality: 'high' | 'degraded' | 'unusable'; focus_lost_ms: number }

// Options are lettered A–H; the letter or the number key (1–8) answers.
const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const keyIndex = (k: string) => { const d = '12345678'.indexOf(k); return d >= 0 ? d : 'abcdefgh'.indexOf(k.toLowerCase()); };

export function ChoiceGrid({
  options, kind, limitMs, onAnswer, large, columns, feedback, prompt, mono,
}: {
  /** Show options in the monospaced face (codes, numbers). */
  mono?: boolean;
  /** The question, shown beside the timer ring. */
  prompt?: React.ReactNode;
  options: string[];
  kind: 'text' | 'svg';
  limitMs: number | null;
  onAnswer: (a: ChoiceAnswer) => void;
  large: boolean;
  columns?: number;
  feedback?: boolean | null;
}) {
  const onset = useRef<number | null>(null);
  const done = useRef(false);
  const lostFrom = useRef<number | null>(null);
  const lost = useRef(0);
  const [left, setLeft] = useState(limitMs ? limitMs / 1000 : null);
  const [picked, setPicked] = useState<number | null>(null);

  const answer = (choice: number | null, e?: Event) => {
    if (done.current) return;
    done.current = true;
    setPicked(choice);
    const ts = e && e.timeStamp > 0 && Math.abs(e.timeStamp - performance.now()) < 10_000 ? e.timeStamp : performance.now();
    const rt = onset.current !== null ? Math.round(ts - onset.current) : null;
    onAnswer({ choice, rt_ms: choice === null ? null : rt, input_device: e ? inputDeviceOf(e) : 'mouse', timing_quality: lost.current > 2000 ? 'unusable' : lost.current > 0 ? 'degraded' : 'high', focus_lost_ms: Math.round(lost.current) });
  };

  useEffect(() => {
    let alive = true;
    void (async () => { await nextFrame(); await nextFrame(); if (alive) onset.current = performance.now(); })();
    const blur = () => { lostFrom.current ??= performance.now(); };
    const focus = () => { if (lostFrom.current !== null) { lost.current += performance.now() - lostFrom.current; lostFrom.current = null; } };
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const i = keyIndex(e.key);
      if (i >= 0 && i < options.length) { e.preventDefault(); answer(i, e); }
    };
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    window.addEventListener('keydown', key);
    let timer: number | undefined;
    if (limitMs) {
      const end = performance.now() + limitMs;
      timer = window.setInterval(() => {
        const s = Math.max(0, (end - performance.now()) / 1000);
        setLeft(s);
        if (s <= 0) { window.clearInterval(timer); answer(null); }
      }, 200);
    }
    return () => { alive = false; window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); window.removeEventListener('keydown', key); window.clearInterval(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const svg = kind === 'svg';
  const cols = columns ?? (svg ? Math.min(4, options.length) : 1);
  return (
    <div>
      {(prompt || left !== null) && (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">{prompt}</div>
          {left !== null && limitMs && <TimerRing secondsLeft={left} totalSeconds={limitMs / 1000} />}
        </div>
      )}
      <div role="group" aria-label="Answer options" className="optlist" style={cols > 1 ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
        {options.map((o, i) => {
          const fb = feedback === undefined || feedback === null ? null : feedback;
          const state = picked === null ? '' : picked === i ? (fb === null ? 'optrow-selected' : fb ? 'optrow-correct' : 'optrow-incorrect') : 'optrow-dim';
          return (
            <button
              key={i}
              type="button"
              disabled={picked !== null}
              onPointerDown={(e) => { e.preventDefault(); answer(i, e.nativeEvent); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); answer(i, e.nativeEvent); } }}
              className={`optrow ${svg ? 'relative flex-col justify-center' : ''} ${large ? 'min-h-[72px] text-xl' : svg ? 'min-h-[56px]' : 'min-h-[52px] text-[1.0625rem]'} ${state}`}
              aria-label={`Option ${LABELS[i]}${kind === 'text' ? `: ${o}` : ''}`}
            >
              <span className={`optrow-key ${svg ? 'absolute left-2 top-2' : ''}`} aria-hidden="true">{LABELS[i]}</span>
              {svg ? <span className="stage mx-auto block w-full max-w-[140px] pt-4"><Svg svg={o} /></span> : <span className={mono ? 'whitespace-pre font-mono font-medium tracking-[0.08em]' : 'font-medium'}>{o}</span>}
              {picked === i && fb === true && <span className="ml-auto shrink-0 font-mono text-xs text-good">✓ correct</span>}
              {picked === i && fb === false && <span className="ml-auto shrink-0 font-mono text-xs text-bad">✕ your pick</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Footer text for a choice question: its time limit and how to answer. */
export function choiceFoot(limitMs: number | null | undefined, n: number): [string, string] {
  return [limitMs ? `Time limit: ${Math.round(limitMs / 1000)}s` : 'No time limit', `Select one · press A–${LABELS[Math.max(0, n - 1)]} or 1–${n}`];
}
