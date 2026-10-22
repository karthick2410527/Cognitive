import { useEffect, useState } from 'react';

// Per-viewer conveniences only (remembered subject id, display preferences, admin token for this
// tab). Every access is guarded: storage can be unavailable in private windows.
export function load<T>(key: string, fallback: T, session = false): T {
  try {
    const s = (session ? window.sessionStorage : window.localStorage).getItem(`cm.${key}`);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown, session = false) {
  try {
    (session ? window.sessionStorage : window.localStorage).setItem(`cm.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: the page still works */
  }
}

// Only dark-on-light themes: positive display polarity gives better reading and task performance
// (Piepenbrock et al., 2013, Ergonomics), so no dark theme is offered for testing.
export type ThemeName = 'light' | 'soft' | 'contrast';
export const THEMES: [ThemeName, string, string][] = [
  ['light', 'Light', 'Recommended: clear dark text on white'],
  ['soft', 'Low glare', 'Softer warm paper, for long sessions or glare'],
  ['contrast', 'High contrast', 'Pure black on white, for low vision'],
];

/** highContrast mirrors theme === 'contrast' (sent with the profile and used for stimulus variants). */
export interface DisplayPrefs { highContrast: boolean; large: boolean; theme: ThemeName }
export const DEFAULT_DISPLAY: DisplayPrefs = { highContrast: false, large: false, theme: 'light' };

export function loadDisplay(): DisplayPrefs {
  const p = load<Partial<DisplayPrefs> & { theme?: string }>('display', {});
  // Older saved values: dark themes and "match my device" become Light; the old high-contrast switch becomes its theme.
  const theme: ThemeName = p.highContrast || p.theme === 'contrast' ? 'contrast' : p.theme === 'soft' ? 'soft' : 'light';
  return { ...DEFAULT_DISPLAY, large: !!p.large, theme, highContrast: theme === 'contrast' };
}

export function applyDisplay(p: DisplayPrefs) {
  const el = document.documentElement;
  if (p.theme === 'contrast') el.dataset.contrast = 'high';
  else delete el.dataset.contrast;
  el.dataset.large = String(p.large);
  if (p.theme === 'soft') el.dataset.theme = 'soft';
  else delete el.dataset.theme;
}

/** Saves, applies and announces display preferences so every open control stays in sync. */
export function setDisplay(p: DisplayPrefs) {
  p = { ...p, highContrast: p.theme === 'contrast' };
  save('display', p);
  applyDisplay(p);
  window.dispatchEvent(new CustomEvent('cm:display', { detail: p }));
}

export function useDisplay(): [DisplayPrefs, (p: DisplayPrefs) => void] {
  const [p, setP] = useState<DisplayPrefs>(loadDisplay);
  useEffect(() => {
    const on = (e: Event) => setP((e as CustomEvent<DisplayPrefs>).detail);
    window.addEventListener('cm:display', on);
    return () => window.removeEventListener('cm:display', on);
  }, []);
  return [p, setDisplay];
}
