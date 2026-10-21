// Delay fillers for encode → delay → retrieve (Doc 03 §10): they occupy the retention interval to
// prevent rehearsal. Performance is recorded but never scored.
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';

export interface FillerResult { attempts: number; correct: number }

export function DelayFiller({ kind, durationMs, onDone }: { kind: string | null; durationMs: number; onDone: (r: FillerResult) => void }) {
  const [left, setLeft] = useState(Math.ceil(durationMs / 1000));
  const res = useRef<FillerResult>({ attempts: 0, correct: 0 });
  useEffect(() => {
    const end = performance.now() + durationMs;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      setLeft(s);
      if (s <= 0) { window.clearInterval(t); onDone(res.current); }
    }, 250);
    return () => window.clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const score = (ok: boolean) => { res.current.attempts++; if (ok) res.current.correct++; };
  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-muted tabular">Short break task · {left} s</p>
      {kind === 'counting' ? <OddEven onAnswer={score} /> : kind === 'digit_span' ? <DigitSpan onAnswer={score} /> : kind === 'visual_search' ? <FindX onAnswer={score} /> : <p className="text-lg">Please wait. The questions start in a moment.</p>}
    </div>
  );
}

function OddEven({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [n, setN] = useState(() => 10 + Math.floor(Math.random() * 89));
  const pick = (odd: boolean) => { onAnswer(odd === (n % 2 === 1)); setN(10 + Math.floor(Math.random() * 89)); };
  return (
    <div className="text-center">
      <p className="mb-2 text-muted">Is this number odd or even?</p>
      <p className="mb-5 text-6xl font-bold tabular">{n}</p>
      <div className="flex justify-center gap-3"><Button size="lg" variant="secondary" onClick={() => pick(true)}>Odd</Button><Button size="lg" variant="secondary" onClick={() => pick(false)}>Even</Button></div>
    </div>
  );
}

function DigitSpan({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [seq, setSeq] = useState<number[]>(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * 9) + 1));
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState<number[]>([]);
  useEffect(() => {
    if (shown >= seq.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [shown, seq]);
  const press = (d: number) => {
    const next = [...typed, d];
    setTyped(next);
    if (next.length === seq.length) {
      onAnswer(next.every((x, i) => x === seq[i]));
      setSeq(Array.from({ length: 3 }, () => Math.floor(Math.random() * 9) + 1));
      setShown(0);
      setTyped([]);
    }
  };
  return (
    <div className="text-center">
      <p className="mb-2 text-muted">{shown < seq.length ? 'Watch the numbers' : 'Enter the numbers in the same order'}</p>
      <p className="mb-5 h-16 text-6xl font-bold tabular">{shown < seq.length ? seq[shown] : typed.join(' ') || '·'}</p>
      {shown >= seq.length && (
        <div className="mx-auto grid max-w-xs grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => <Button key={d} variant="secondary" onClick={() => press(d)}>{d}</Button>)}
        </div>
      )}
    </div>
  );
}

function FindX({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 16));
  return (
    <div className="text-center">
      <p className="mb-3 text-muted">Tap the ✕ among the plus signs.</p>
      <div className="mx-auto grid max-w-xs grid-cols-4 gap-2">
        {Array.from({ length: 16 }, (_, i) => (
          <button key={`${target}-${i}`} type="button" className="h-14 rounded border-2 border-line bg-surface text-2xl font-bold" onClick={() => { onAnswer(i === target); setTarget(Math.floor(Math.random() * 16)); }} aria-label={i === target ? 'cross' : 'plus'}>
            {i === target ? '✕' : '+'}
          </button>
        ))}
      </div>
    </div>
  );
}
