// Gemini provider over the REST API: provider-side structured output (responseJsonSchema +
// application/json), thinking budget per plugin, and a non-STOP finish treated as retryable —
// all carried over from v1 where they worked.
import { pool } from '../db/pool';
import { ProviderError, type GenerateRequest, type GenerateResult, type LlmProvider } from './provider';

const BASE = (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const PRICE = {
  in: Number(process.env.GEMINI_PRICE_IN_PER_M ?? 0.1),
  cached: Number(process.env.GEMINI_PRICE_CACHED_PER_M ?? 0.025),
  out: Number(process.env.GEMINI_PRICE_OUT_PER_M ?? 0.4),
};
const THINKING: Record<string, number> = { minimal: 0, low: 512, medium: 2048, high: 8192 };

// Pacing shared by every process (API, workers, scripts) through the provider_calls table: at most
// GEMINI_RPM calls per rolling minute in total (0 = off), so a burst queues instead of being refused
// with 429. Background work (bank top-up, preloads) may use only GEMINI_RPM − GEMINI_LIVE_RESERVE of
// them, which keeps room for live sessions. The free tier allows 15 requests per minute.
const RPM = Number(process.env.GEMINI_RPM ?? 14);
const LIVE_RESERVE = Number(process.env.GEMINI_LIVE_RESERVE ?? 4);
async function pace(priority: 'live' | 'background') {
  if (!(RPM > 0)) return;
  const cap = priority === 'live' ? RPM : Math.max(1, RPM - LIVE_RESERVE);
  for (;;) {
    const c = await pool.connect();
    let waitMs = 0;
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(724001)'); // one reservation at a time, across processes
      const r = await c.query<{ n: number; oldest: Date | null }>("SELECT count(*)::int AS n, min(at) AS oldest FROM provider_calls WHERE at > now() - interval '60 seconds'");
      const { n, oldest } = r.rows[0]!;
      if (n < cap) {
        await c.query('INSERT INTO provider_calls (priority) VALUES ($1)', [priority]);
        await c.query("DELETE FROM provider_calls WHERE at < now() - interval '10 minutes'");
        await c.query('COMMIT');
        return;
      }
      await c.query('COMMIT');
      waitMs = oldest ? Math.max(200, 60_000 - (Date.now() - new Date(oldest).getTime()) + 50) : 1000;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
    await new Promise((res) => setTimeout(res, Math.min(waitMs, 5000)));
  }
}

/** Reads Gemini's 429 body: the quota that was hit and how long it asks us to wait. */
function quotaDetail(body: string): { note: string; retryAfterMs?: number } {
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; details?: { '@type'?: string; retryDelay?: string; violations?: { quotaId?: string; quotaValue?: string }[] }[] } }).error;
    const retry = e?.details?.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const v = e?.details?.find((d) => d['@type']?.endsWith('QuotaFailure'))?.violations?.[0];
    const secs = retry ? Number.parseFloat(retry) : NaN;
    return { note: [v?.quotaId, v?.quotaValue ? `limit ${v.quotaValue}` : null, retry ? `retry in ${retry}` : null].filter(Boolean).join(', ') || (e?.message ?? '').slice(0, 160), retryAfterMs: Number.isFinite(secs) ? secs * 1000 : undefined };
  } catch {
    return { note: body.slice(0, 160) };
  }
}

export class GeminiProvider implements LlmProvider {
  id = 'gemini';
  constructor(private apiKey: string, public model: string) {}

  /**
   * Plain JSON mode by default. Doc 02's response schema declares blueprint parts (trial_rule, puzzle,
   * stimuli, probes) as free-form objects, and Gemini's schema-constrained decoding then emits them
   * empty. The exemplars carry the exact shape; Zod and the five gates validate every item anyway.
   * GEMINI_STRICT_SCHEMA=true sends responseJsonSchema (and falls back here if the API rejects it).
   */
  private schemaUnsupported = process.env.GEMINI_STRICT_SCHEMA !== 'true';

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return await this.call(req, !this.schemaUnsupported);
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'server' && /schema/i.test(e.message) && !this.schemaUnsupported) {
        this.schemaUnsupported = true;
        return this.call(req, false);
      }
      throw e;
    }
  }

  private async call(req: GenerateRequest, withSchema: boolean): Promise<GenerateResult> {
    const contents: unknown[] = [{ role: 'user', parts: [{ text: req.request }] }];
    if (req.followUp) contents.push({ role: 'model', parts: [{ text: req.followUp.previous }] }, { role: 'user', parts: [{ text: req.followUp.message }] });
    const thinking = THINKING[req.thinking ?? 'low'] ?? 512;
    // Gemini 3.x takes a thinking level; earlier models take a token budget.
    const thinkingConfig = /gemini-3/.test(this.model) ? { thinkingLevel: req.thinking === 'medium' || req.thinking === 'high' ? req.thinking : 'low' } : { thinkingBudget: thinking };
    const body = {
      systemInstruction: { parts: [{ text: req.prefix.text }] },
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
        ...(withSchema ? { responseJsonSchema: req.schema } : {}),
        // Thinking tokens count against the output cap; leave room so JSON is not cut mid-array.
        maxOutputTokens: req.maxOutputTokens + (/gemini-3/.test(this.model) ? ({ minimal: 1024, low: 4096, medium: 12288, high: 24576 } as Record<string, number>)[req.thinking ?? 'low']! : thinking),
        ...(req.seed !== undefined ? { seed: req.seed & 0x7fffffff } : {}), // TYPE_INT32
        thinkingConfig,
      },
    };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), req.timeoutMs);
    let res: Response;
    await pace(req.priority ?? 'background');
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
    } catch (e) {
      throw new ProviderError(`network/timeout: ${(e as Error).message}`, true, 'timeout');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const t = await res.text();
      if (res.status === 401 || res.status === 403) throw new ProviderError(`auth ${res.status}`, false, 'auth');
      if (res.status === 404) throw new ProviderError(`model ${this.model} not found`, false, 'not_found');
      if (res.status === 429) {
        const q = quotaDetail(t);
        throw new ProviderError(`quota / rate limited: ${q.note}`, true, 'quota', q.retryAfterMs);
      }
      throw new ProviderError(`HTTP ${res.status}: ${t.slice(0, 300)}`, res.status >= 500, 'server');
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
      modelVersion?: string;
    };
    const cand = data.candidates?.[0];
    const finish = cand?.finishReason ?? 'UNKNOWN';
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
    if (finish !== 'STOP') throw new ProviderError(`finish reason ${finish} (output ${data.usageMetadata?.candidatesTokenCount ?? '?'} + thinking ${data.usageMetadata?.thoughtsTokenCount ?? '?'} tokens)`, true, 'truncated');
    let json: unknown;
    try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new ProviderError('response is not valid JSON', true, 'malformed'); }
    const u = data.usageMetadata ?? {};
    const inputTokens = u.promptTokenCount ?? 0;
    const cached = u.cachedContentTokenCount ?? 0;
    const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const costUsd = ((inputTokens - cached) * PRICE.in + cached * PRICE.cached + outputTokens * PRICE.out) / 1e6;
    return { json, text, usage: { inputTokens, cachedInputTokens: cached, outputTokens }, finishReason: finish, modelId: data.modelVersion ?? this.model, costUsd };
  }

  async getModelInfo() {
    try {
      const res = await fetch(`${BASE}/models/${encodeURIComponent(this.model)}`, { headers: { 'x-goog-api-key': this.apiKey } });
      if (res.status === 404) return { available: false, retired: true, note: `model ${this.model} not found or retired` };
      if (!res.ok) return { available: false, note: `HTTP ${res.status}` };
      return { available: true };
    } catch (e) {
      return { available: false, note: (e as Error).message };
    }
  }
}
