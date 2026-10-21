// Thin API client. Every response from the engine carries engine_version and trace_id.
import type { BlockSpec, SubjectProfile } from '@cognimetric/core';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public detail?: unknown) {
    super(message);
  }
}

export async function api<T = Record<string, unknown>>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/v2${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), String(json.message ?? `HTTP ${res.status}`), json.detail);
  return json as T;
}

export interface DomainProgress {
  plugin: string;
  name: string;
  n: number;
  se: number;
  target_se: number;
  unmeasured: boolean;
  /** Live sessions only: questions ready in the buffer, generations running, and the threshold's plan. */
  ready?: number;
  generating?: number;
  plan?: 'more' | 'normal' | 'none';
  plan_reason?: string;
}

export interface Progress {
  served: number;
  live_served: number;
  max_items: number;
  fixed_length: boolean;
  block_index: number;
  blocks: number;
  elapsed_s: number;
  mode: 'live' | 'bank';
  domains: DomainProgress[];
}

export interface ItemUnitBase {
  kind: 'item';
  administration_id: string;
  position: number;
  block_index: number;
  phase: string;
  plugin: { id: string; name: string };
  task_type: string;
  protocol: 'single' | 'encode_delay_retrieve' | 'timed_block';
  renderer: 'dom' | 'svg';
  response_spec: { mode: string; time_limit_ms?: number | null; per_probe_limit_ms?: number | null };
  text_alternative: string | null;
  large_targets: boolean;
  reveal_feedback: boolean;
  progress: Progress;
  render?: Record<string, any>;
  block?: BlockSpec & { sequence_hash: string; attempt: number };
}

export interface ProbeCaptureUnit {
  kind: 'probe_capture';
  plugin: { id: string; name: string };
  questions: { probe_id: string; question: string }[];
  note: string;
}

export type Unit = ItemUnitBase | ProbeCaptureUnit;
export interface NextResponse { done: boolean; stop_reason?: string; resumed?: boolean; unit?: Unit }
export type { SubjectProfile };
