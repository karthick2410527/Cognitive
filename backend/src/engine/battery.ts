// A battery is a stored block plan, not code (Doc 05 §2.3). Screening, standard and long
// batteries are configuration. "domains": "*" means every enabled plugin, so a new plugin joins
// batteries without engine changes.
export interface BlockPlanBlock {
  index: number;
  kind: 'calibration' | 'adaptive' | 'confirmation' | 'delayed_probe';
  items_per_domain?: number;
  b_targets?: number[];
  interleave?: boolean;
  source?: 'bank_only' | 'bank_and_speculative';
  max_items?: number;
  selection?: 'max_information_balanced' | 'round_robin' | 'weakest_first' | 'random' | 'weighted_random';
  exposure_control?: string;
  triggers?: ('se_above_target' | 'misfit' | 'boundary')[];
  delay_days?: [number, number];
  max_probes?: number;
}

export interface Battery {
  battery_id: string;
  name: string;
  description: string;
  domains: '*' | string[];
  blocks: BlockPlanBlock[];
  global: { max_items: number; max_duration_min: number; target_se: number; max_per_domain: number; reveal_feedback: boolean };
}

export const BATTERIES: Record<string, Battery> = {
  standard_5domain_v1: {
    battery_id: 'standard_5domain_v1',
    name: 'Standard',
    description: 'Calibration block, adaptive block, confirmation block and delayed recall probes. About 25 minutes.',
    domains: '*',
    blocks: [
      { index: 0, kind: 'calibration', items_per_domain: 2, b_targets: [-0.5, 0.5], interleave: true, source: 'bank_only' },
      { index: 1, kind: 'adaptive', max_items: 20, selection: 'max_information_balanced', exposure_control: 'sympson_hetter_0.25', source: 'bank_and_speculative' },
      { index: 2, kind: 'confirmation', max_items: 6, triggers: ['se_above_target', 'misfit', 'boundary'] },
      { index: 3, kind: 'delayed_probe', delay_days: [7, 14], max_probes: 3 },
    ],
    global: { max_items: 36, max_duration_min: 25, target_se: 0.32, max_per_domain: 10, reveal_feedback: false },
  },
  screening_5domain_v1: {
    battery_id: 'screening_5domain_v1',
    name: 'Screening',
    description: 'Block 0 only: two items per domain from the bank. About 10 minutes. Results are staircase-only and are not reported as scores.',
    domains: '*',
    blocks: [{ index: 0, kind: 'calibration', items_per_domain: 2, b_targets: [-0.5, 0.5], interleave: true, source: 'bank_only' }],
    global: { max_items: 10, max_duration_min: 15, target_se: 0.32, max_per_domain: 2, reveal_feedback: false },
  },
  practice_feedback_v1: {
    battery_id: 'practice_feedback_v1',
    name: 'Practice (with feedback)',
    description: 'A short practice run that shows whether each answer was correct. Feedback changes behaviour, so this battery is never scored as a measurement.',
    domains: '*',
    blocks: [{ index: 0, kind: 'calibration', items_per_domain: 1, b_targets: [-0.5], interleave: true, source: 'bank_only' }],
    global: { max_items: 5, max_duration_min: 10, target_se: 0.32, max_per_domain: 1, reveal_feedback: true },
  },
};
