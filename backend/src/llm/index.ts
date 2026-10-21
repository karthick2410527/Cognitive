// Provider selection and health. A failed probe marks the provider degraded (recorded in
// provider_status so the bank-health page shows it) instead of being log-only; sessions keep
// running from the bank either way (Doc 01 §11).
import { config } from '../config';
import { q } from '../db/pool';
import { log } from '../util';
import { GeminiProvider } from './gemini';
import { LocalProvider } from './local';
import type { LlmProvider } from './provider';

let provider: LlmProvider | null = null;
let degraded = false;
let degradedUntil = 0; // 0 = until the next probe; otherwise an epoch-ms expiry (e.g. a daily quota reset)

export function getProvider(): LlmProvider {
  if (!provider) {
    if (config.LLM_PROVIDER === 'gemini') {
      if (!config.GEMINI_API_KEY) {
        log('llm', 'LLM_PROVIDER=gemini but GEMINI_API_KEY is unset; falling back to the local provider');
        provider = new LocalProvider();
      } else provider = new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL);
    } else provider = new LocalProvider();
  }
  return provider;
}

export const setProvider = (p: LlmProvider) => { provider = p; degraded = false; degradedUntil = 0; };
export const providerDegraded = () => {
  if (degraded && degradedUntil && Date.now() >= degradedUntil) { degraded = false; degradedUntil = 0; log('llm', 'provider back in service after its quota reset'); }
  return degraded;
};

export async function probeProvider(): Promise<{ provider: string; model: string; state: string; note?: string }> {
  const p = getProvider();
  const info = await p.getModelInfo();
  degraded = !info.available;
  const state = info.available ? 'ok' : info.retired ? 'retired' : 'degraded';
  await q(
    `INSERT INTO provider_status (provider, model, state, note, checked_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (provider) DO UPDATE SET model=$2, state=$3, note=$4, checked_at=now()`,
    [p.id, p.model, state, info.note ?? null],
  );
  if (!info.available) log('llm', `provider ${p.id}/${p.model} is ${state}: ${info.note ?? ''} — sessions continue from the bank`);
  return { provider: p.id, model: p.model, state, note: info.note };
}

/** Marks the provider unavailable; with `untilMs` it comes back by itself at that time. */
export function markDegraded(note: string, untilMs = 0) {
  degraded = true;
  degradedUntil = untilMs;
  const p = getProvider();
  void q(`INSERT INTO provider_status (provider, model, state, note) VALUES ($1,$2,'degraded',$3) ON CONFLICT (provider) DO UPDATE SET state='degraded', note=$3, checked_at=now()`, [p.id, p.model, note]).catch(() => {});
}
