// Four-layer assembly (Doc 02 §2): L0 + L1 + L3 form the stable, cache-keyed prefix in that order;
// L2 is appended last. The prefix is byte-identical across calls within a cell.
import type { LoadedPlugin } from '@cognimetric/core';
import { sha256 } from '../util';
import { activeLayer, l3Row } from './governance';
import { difficultyBand } from '../engine/levers';

export interface PromptPrefix { text: string; hash: string; layer_hashes: Record<string, string>; layer_ids: Record<string, string>; prompt_version: string }

export async function assemblePrefix(plugin: LoadedPlugin, taskType: string, targetB: number): Promise<PromptPrefix> {
  const l0 = await activeLayer('L0', null);
  const l1 = await activeLayer('L1', plugin.manifest.plugin_id);
  const l2 = await activeLayer('L2_template', null);
  const l3 = await l3Row(taskType, difficultyBand(targetB));
  const text = [l0.body, l1.body, l3.body].join('\n\n────────\n\n');
  const layer_hashes = { L0: l0.body_hash, L1: l1.body_hash, L2: l2.body_hash, L3: l3.body_hash };
  return {
    text,
    hash: sha256(text),
    layer_hashes,
    layer_ids: { L0: l0.prompt_version, L1: l1.prompt_version, L2: l2.prompt_version, L3: l3.prompt_version },
    // One composite id per (L0, L1, L2 template): "what else came from this prompt version?" is one SQL query.
    prompt_version: `pv-${sha256(l0.body_hash + l1.body_hash + l2.body_hash).slice(0, 12)}`,
  };
}
