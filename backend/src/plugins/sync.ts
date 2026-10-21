// Writes the loaded registry into the plugins and task_types tables.
import { modalityOf } from '@cognimetric/core';
import type { Registry } from './registry';
import { audit, q, q1, type Db } from '../db/pool';
import { syncPrompts } from '../prompts/governance';

export async function syncRegistry(reg: Registry, db?: Db) {
  for (const p of reg.plugins.values()) {
    const m = p.manifest;
    const prev = await q1<{ version: string }>('SELECT version FROM plugins WHERE plugin_id = $1', [m.plugin_id], db);
    await q(
      `INSERT INTO plugins (plugin_id, name, version, manifest, dimensions) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (plugin_id) DO UPDATE SET name=$2, version=$3, manifest=$4, dimensions=$5, loaded_at=now()`,
      [m.plugin_id, m.name, m.version, m, m.dimensions], db,
    );
    if (prev && prev.version !== m.version) await audit('boot', 'plugin_version_changed', 'plugin', m.plugin_id, { from: prev.version, to: m.version }, db);
    for (const t of m.task_types)
      await q(
        `INSERT INTO task_types (task_type, plugin_id, protocol, renderer, solver, spec) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (task_type) DO UPDATE SET plugin_id=$2, protocol=$3, renderer=$4, solver=$5, spec=$6`,
        [t.id, m.plugin_id, t.protocol, t.renderer.target, t.solver, t], db,
      );
  }
  await syncPrompts([...reg.plugins.values()], db);
  // Backfill presentation modality on items banked before modality tracking existed.
  for (const p of reg.plugins.values()) for (const t of p.manifest.task_types) {
    // A single-modality task type fixes the modality of all its items (also re-labels items banked when it had two).
    if (t.modalities.length === 1) { await q('UPDATE items SET modality=$2 WHERE task_type=$1 AND modality IS DISTINCT FROM $2', [t.id, t.modalities[0]], db); continue; }
    const rows = await q<{ item_id: string; blueprint: Record<string, unknown> }>('SELECT item_id, blueprint FROM items WHERE task_type=$1 AND modality IS NULL', [t.id], db);
    for (const r of rows) await q('UPDATE items SET modality=$2 WHERE item_id=$1', [r.item_id, modalityOf(t, r.blueprint as never)], db);
  }
}

export async function enabledPlugins(reg: Registry, db?: Db) {
  const rows = await q<{ plugin_id: string; enabled: boolean }>('SELECT plugin_id, enabled FROM plugins', [], db);
  const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.plugin_id));
  return [...reg.plugins.values()].filter((p) => enabled.has(p.manifest.plugin_id));
}
