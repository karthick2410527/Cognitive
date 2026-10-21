// Client timing harness (Doc 09 §7). Without it every reaction-time measure partly measures the
// test-taker's hardware.
//  • performance.now() only — never Date.now(); RT is never computed from a network round trip.
//  • Onset = the frame on which the stimulus was actually painted: commit in rAF f1, timestamp in f2.
//  • Responses captured at pointerdown / keydown using the event's own timeStamp.
//  • Per-trial verdict: high | degraded | unusable, from long tasks, frame irregularity, focus and
//    visibility.
import type { DeviceProfile, TimingQuality } from '@cognimetric/core';
import { api } from '../api';

export const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(() => r(performance.now())));
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Waits until `target` (performance.now() ms), finishing on a frame boundary. */
export async function waitUntil(target: number, framePeriod: number) {
  const coarse = target - performance.now() - framePeriod * 1.5;
  if (coarse > 0) await sleep(coarse);
  while (performance.now() < target - framePeriod / 2) await nextFrame();
}

export class TimingMonitor {
  private longTasks: [number, number][] = [];
  private hidden: [number, number][] = [];
  private hiddenSince: number | null = null;
  private observer: PerformanceObserver | null = null;
  focusLostMs = 0;
  private listeners: [EventTarget, string, EventListener][] = [];

  constructor(public framePeriod: number) {}

  start() {
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) this.longTasks.push([e.startTime, e.startTime + e.duration]);
      });
      this.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      this.observer = null; // long-task API unavailable: frame-interval checks still apply
    }
    const lost = () => { if (this.hiddenSince === null) this.hiddenSince = performance.now(); };
    const back = () => {
      if (this.hiddenSince !== null) {
        const now = performance.now();
        this.hidden.push([this.hiddenSince, now]);
        this.focusLostMs += now - this.hiddenSince;
        this.hiddenSince = null;
      }
    };
    const vis = () => (document.visibilityState === 'hidden' ? lost() : back());
    for (const [t, e, f] of [[document, 'visibilitychange', vis], [window, 'blur', lost], [window, 'focus', back]] as [EventTarget, string, EventListener][]) {
      t.addEventListener(e, f);
      this.listeners.push([t, e, f]);
    }
  }

  stop() {
    this.observer?.disconnect();
    for (const [t, e, f] of this.listeners) t.removeEventListener(e, f);
    this.listeners = [];
  }

  /** Focus currently lost, and for how long (ms). */
  currentLoss(): number {
    return this.hiddenSince === null ? 0 : performance.now() - this.hiddenSince;
  }

  verdict(t0: number, t1: number, paintConfirmed: boolean, frameDelta: number): TimingQuality {
    const overlaps = (iv: [number, number][]) => iv.some(([a, b]) => a < t1 && b > t0);
    if (!paintConfirmed || this.hiddenSince !== null || overlaps(this.hidden) || document.visibilityState === 'hidden' || !document.hasFocus()) return 'unusable';
    const longTask = this.longTasks.some(([a, b]) => a < t1 && b > t0 && b - a > 50);
    const irregular = frameDelta > this.framePeriod * 1.25 + 1 || frameDelta < this.framePeriod * 0.5;
    return longTask || irregular ? 'degraded' : 'high';
  }
}

/** 5-second silent device calibration before the first timed block (Doc 09 §7.6). */
export async function calibrateDevice(sampleRender: () => void): Promise<DeviceProfile> {
  const deltas: number[] = [];
  let last = await nextFrame();
  const end = last + 1500;
  while (last < end) {
    const t = await nextFrame();
    deltas.push(t - last);
    last = t;
  }
  deltas.sort((a, b) => a - b);
  const period = deltas[Math.floor(deltas.length / 2)] ?? 16.7;
  const mean = deltas.reduce((s, x) => s + x, 0) / Math.max(1, deltas.length);
  const jitter = Math.sqrt(deltas.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, deltas.length));
  const costs: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    sampleRender();
    await nextFrame();
    costs.push(performance.now() - t0);
  }
  await sleep(Math.max(0, 5000 - 1500 - costs.reduce((s, x) => s + x, 0)));
  const w = Math.min(window.screen.width, window.screen.height);
  return {
    frame_period_ms: Math.round(period * 100) / 100,
    frame_jitter_ms: Math.round(jitter * 100) / 100,
    input_latency_ms: null, // not measurable without the user's own input; recorded as unknown
    render_cost_ms: Math.round((costs.sort((a, b) => a - b)[4] ?? 0) * 100) / 100,
    refresh_hz: Math.round(1000 / period),
    device_class: w < 600 ? 'phone' : w < 1024 && matchMedia('(pointer: coarse)').matches ? 'tablet' : 'desktop',
    presentation_api: false,
  };
}

/** Server-synchronised clock offset, measured once per block (stored, never used to compute RT). */
export async function clockOffset(): Promise<number | null> {
  try {
    const t0 = performance.now();
    const r = await api<{ server_time_ms: number }>('GET', '/time');
    const t1 = performance.now();
    return Math.round(r.server_time_ms - (performance.timeOrigin + (t0 + t1) / 2));
  } catch {
    return null;
  }
}

export function inputDeviceOf(e: Event): 'touch' | 'mouse' | 'keyboard' | 'pen' {
  if (e instanceof KeyboardEvent) return 'keyboard';
  if (e instanceof PointerEvent) return e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';
  return 'mouse';
}
