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

export type ThemeName = 'system' | 'light' | 'dim' | 'dark' | 'black';
export const THEMES: [ThemeName, string][] = [['system', 'Match my device'], ['light', 'Light'], ['dim', 'Dim'], ['dark', 'Dark'], ['black', 'Black']];

export interface DisplayPrefs { highContrast: boolean; large: boolean; theme: ThemeName }
export const DEFAULT_DISPLAY: DisplayPrefs = { highContrast: false, large: false, theme: 'system' };

export function loadDisplay(): DisplayPrefs {
  const p = load<Partial<DisplayPrefs>>('display', {});
  const theme = THEMES.some(([t]) => t === p.theme) ? (p.theme as ThemeName) : 'system';
  return { ...DEFAULT_DISPLAY, ...p, theme };
}

export function applyDisplay(p: DisplayPrefs) {
  const el = document.documentElement;
  if (p.highContrast) el.dataset.contrast = 'high';
  else delete el.dataset.contrast;
  el.dataset.large = String(p.large);
  if (p.theme === 'system') delete el.dataset.theme;
  else el.dataset.theme = p.theme;
}

/** Saves, applies and announces display preferences so every open control stays in sync. */
export function setDisplay(p: DisplayPrefs) {
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
