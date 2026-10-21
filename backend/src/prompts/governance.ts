// Prompt governance (Doc 02 §9). Every layer body is a row in prompt_versions with a content hash;
// nothing reaches a model that is not in that table. L1 is compiled at boot and compared with the
// active row: a stored body that does not hash to its body_hash, or that differs from the compiler
// output for the same manifest version, fails the boot in production.
import type { LoadedPlugin } from '@cognimetric/core';
import { audit, q, q1, type Db } from '../db/pool';
import { isProd } from '../config';
import { sha256, log } from '../util';
import { compileL1 } from './compiler';
import { L0_BODY, L0_VERSION } from './l0';
import { L2_TEMPLATE, L2_TEMPLATE_VERSION } from './l2';
import { FREEFORM_TEMPLATE_BODY, FREEFORM_VERSION, VERIFY_SYSTEM, VERIFY_VERSION } from '../generation/freeform';

type Row = { prompt_version: string; layer: string; plugin_id: string | null; body: string; body_hash: string; activated_at: Date | null; retired_at: Date | null };

async function ensure(id: string, layer: string, plugin: string | null, body: string, db?: Db, notes?: string) {
  const hash = sha256(body);
  const existing = await q1<Row>('SELECT * FROM prompt_versions WHERE prompt_version = $1', [id], db);
  if (existing) {
    if (sha256(existing.body) !== existing.body_hash) throw new Error(`prompt_versions row ${id} was hand-edited (body does not match body_hash)`);
    if (existing.body_hash !== hash) throw new Error(`prompt_versions row ${id} differs from the compiler output for the same version`);
    return existing;
  }
  await q('INSERT INTO prompt_versions (prompt_version, layer, plugin_id, body, body_hash, notes) VALUES ($1,$2,$3,$4,$5,$6)', [id, layer, plugin, body, hash, notes ?? null], db);
  return (await q1<Row>('SELECT * FROM prompt_versions WHERE prompt_version = $1', [id], db))!;
}

async function activateIfNone(id: string, layer: string, plugin: string | null, db?: Db) {
  const active = await q1<Row>('SELECT * FROM prompt_versions WHERE layer = $1 AND plugin_id IS NOT DISTINCT FROM $2 AND activated_at IS NOT NULL AND retired_at IS NULL', [layer, plugin], db);
  if (!active) await q('UPDATE prompt_versions SET activated_at = now() WHERE prompt_version = $1', [id], db);
}

export async function syncPrompts(plugins: LoadedPlugin[], db?: Db) {
  await ensure(L0_VERSION, 'L0', null, L0_BODY, db);
  await activateIfNone(L0_VERSION, 'L0', null, db);
  await ensure(L2_TEMPLATE_VERSION, 'L2_template', null, L2_TEMPLATE, db);
  await activateIfNone(L2_TEMPLATE_VERSION, 'L2_template', null, db);
  // The free-form written-question prompt and its independent answer check.
  const ffId = `${FREEFORM_VERSION}#${sha256(FREEFORM_TEMPLATE_BODY).slice(0, 8)}`;
  await ensure(ffId, 'freeform', null, FREEFORM_TEMPLATE_BODY, db, 'free-form written questions (product prompt, verbatim)');
  await activateIfNone(ffId, 'freeform', null, db);
  await ensure(VERIFY_VERSION, 'freeform_verify', null, VERIFY_SYSTEM, db, 'independent answer check for free-form questions');
  await activateIfNone(VERIFY_VERSION, 'freeform_verify', null, db);
  for (const p of plugins) {
    const m = p.manifest;
    const body = compileL1(m, p.brief);
    const id = `L1/${m.plugin_id}/${m.version}#${sha256(body).slice(0, 8)}`;
    const active = await q1<Row>("SELECT * FROM prompt_versions WHERE layer='L1' AND plugin_id=$1 AND activated_at IS NOT NULL AND retired_at IS NULL", [m.plugin_id], db);
    if (active && sha256(active.body) !== active.body_hash) throw new Error(`active L1 for ${m.plugin_id} (${active.prompt_version}) was hand-edited`);
    await ensure(id, 'L1', m.plugin_id, body, db);
    if (active && active.prompt_version !== id) {
      const sameVersion = active.prompt_version.startsWith(`L1/${m.plugin_id}/${m.version}#`);
      if (sameVersion && isProd()) throw new Error(`L1 for ${m.plugin_id} ${m.version} changed without a version bump`);
      await q('UPDATE prompt_versions SET retired_at = now() WHERE prompt_version = $1', [active.prompt_version], db);
      await q('UPDATE prompt_versions SET activated_at = now() WHERE prompt_version = $1', [id], db);
      await audit('boot', 'prompt_version_changed', 'prompt_version', id, { previous: active.prompt_version, note: 'shadow run required; auto_promote probation applies' }, db);
      log('prompts', `L1 for ${m.plugin_id} changed → ${id} (previous ${active.prompt_version}); probation applies`);
    } else await activateIfNone(id, 'L1', m.plugin_id, db);
    for (const [tt, bands] of p.exemplars) for (const band of ['easy', 'medium', 'hard'] as const) {
      const b = l3Body(bands[band]);
      await ensure(`L3/${tt}/${band}#${sha256(b).slice(0, 8)}`, 'L3', m.plugin_id, b, db);
    }
  }
}

export function l3Body(items: unknown[]): string {
  return [
    'GOLD EXEMPLARS — human-reviewed items at this difficulty band. They show form, not content:',
    'do not reuse their stimuli, words or rule instances.',
    ...items.slice(0, 3).map((x, i) => `EXEMPLAR ${i + 1}\n${JSON.stringify(x)}`),
  ].join('\n');
}

export async function activeLayer(layer: 'L0' | 'L1' | 'L2_template', plugin: string | null, db?: Db): Promise<Row> {
  const r = await q1<Row>('SELECT * FROM prompt_versions WHERE layer=$1 AND plugin_id IS NOT DISTINCT FROM $2 AND activated_at IS NOT NULL AND retired_at IS NULL ORDER BY activated_at DESC LIMIT 1', [layer, plugin], db);
  if (!r) throw new Error(`no active ${layer} prompt for ${plugin ?? 'engine'}`);
  if (sha256(r.body) !== r.body_hash) throw new Error(`prompt ${r.prompt_version} body does not match its hash`);
  return r;
}

export async function l3Row(taskType: string, band: string, db?: Db): Promise<Row> {
  const r = await q1<Row>("SELECT * FROM prompt_versions WHERE layer='L3' AND prompt_version LIKE $1 ORDER BY prompt_version DESC LIMIT 1", [`L3/${taskType}/${band}#%`], db);
  if (!r) throw new Error(`no L3 exemplars for ${taskType}/${band}`);
  return r;
}

/** Items created after a prompt change ride on probation (auto_promote false) for the first N items. */
export async function probationRemaining(promptVersion: string, limit: number, db?: Db): Promise<number> {
  const r = await q1<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE provenance->'generator'->>'prompt_version' = $1", [promptVersion], db);
  return Math.max(0, limit - (r?.n ?? 0));
}
