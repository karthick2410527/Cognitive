// Thin provider seam (Doc 02 §8): data-residency deployments can swap providers, and prompt-version
// A/B tests are easier when the provider is an interface.
import type { LoadedPlugin, LoadedTaskType, Levers, ServiceBag } from '@cognimetric/core';

export interface PromptPrefixIn { text: string; hash: string }

export interface GenerateRequest {
  prefix: PromptPrefixIn; // L0+L1+L3, cache-keyed
  request: string; // L2
  schema: unknown;
  maxOutputTokens: number;
  thinking?: 'minimal' | 'low' | 'medium' | 'high';
  seed?: number;
  timeoutMs: number;
  /** Live session work goes first when the provider's per-minute budget is tight. */
  priority?: 'live' | 'background';
  /** A repair turn on the same conversation (Doc 02 §6.2). */
  followUp?: { previous: string; message: string };
  /** Structured copy of L2 for providers that author procedurally; remote providers ignore it. */
  local?: { plugin: LoadedPlugin; taskType: LoadedTaskType; modality?: 'text' | 'visual'; levers: Levers; count: number; seed: number; locale: string; readingLevel: string; services: ServiceBag; exclusions: string[] };
}

export interface GenerateResult {
  json: unknown;
  text: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
  finishReason: string;
  modelId: string;
  costUsd: number;
}

export interface LlmProvider {
  id: string;
  model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  getModelInfo(): Promise<{ available: boolean; retired?: boolean; note?: string }>;
}

export class ProviderError extends Error {
  constructor(message: string, public retryable: boolean, public kind: 'auth' | 'quota' | 'not_found' | 'timeout' | 'malformed' | 'truncated' | 'server' = 'server', public retryAfterMs?: number) {
    super(message);
  }
}
