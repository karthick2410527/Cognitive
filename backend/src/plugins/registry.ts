// Plugin registry (Doc 03 §6). Loads plugins/*/manifest.json at boot, asserts the contract, imports
// every referenced module, loads exemplars, and records the manifest in the plugins table so a
// running session always knows which manifest version produced its items. Any failed assertion
// fails the boot with a message naming the plugin and the assertion.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ENGINE_VERSION, ManifestSchema,
  type CrossSessionModule, type LoadedPlugin, type LoadedTaskType, type Manifest, type ScoringModule,
} from '@cognimetric/core';
import { config } from '../config';
import { anchorsFor, leverValueOk } from '../engine/levers';
import { lexicon } from '../services/lexicon';

export class RegistryError extends Error {
  constructor(plugin: string, assertion: string) {
    super(`plugin "${plugin}" failed boot assertion: ${assertion}`);
  }
}

function satisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number);
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  return range.split(/\s+/).filter(Boolean).every((part) => {
    const m = part.match(/^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/);
    if (!m) return false;
    const c = cmp(v, m[2]!.split('.').map(Number));
    switch (m[1]) {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  });
}

async function importModule<T>(dir: string, ref: string, plugin: string, kind: string): Promise<T> {
  const file = path.join(dir, `${ref}.ts`);
  if (!fs.existsSync(file)) throw new RegistryError(plugin, `${kind} module "${ref}" does not resolve (${file})`);
  const mod = (await import(pathToFileURL(file).href)) as { default?: T };
  if (!mod.default) throw new RegistryError(plugin, `${kind} module "${ref}" has no default export`);
  return mod.default;
}

export interface Registry {
  plugins: Map<string, LoadedPlugin>;
  taskTypes: Map<string, { plugin: LoadedPlugin; tt: LoadedTaskType }>;
  dir: string;
}

export async function loadPlugin(dir: string, opts: { requireExemplars?: boolean } = {}): Promise<LoadedPlugin> {
  const requireExemplars = opts.requireExemplars ?? true;
  const id = path.basename(dir);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) throw new RegistryError(id, `manifest schema: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const m: Manifest = parsed.data;
  const P = m.plugin_id;
  if (P !== id) throw new RegistryError(id, `plugin_id "${P}" must match its folder name`);
  if (!satisfies(ENGINE_VERSION, m.engine_range)) throw new RegistryError(P, `engine_range ${m.engine_range} does not include engine ${ENGINE_VERSION}`);

  const weight = m.task_types.reduce((s, t) => s + t.weight, 0);
  if (Math.abs(weight - 1) > 0.01) throw new RegistryError(P, `Σ task_types[].weight = ${weight.toFixed(3)}, must be ≈ 1.0`);
  for (const d of Object.keys(m.loading)) if (!m.dimensions.includes(d)) throw new RegistryError(P, `loading dimension ${d} not in dimensions`);
  for (const d of m.dimensions) {
    const used = d in m.loading || Object.values(m.task_type_loadings).some((l) => d in l);
    if (!used) throw new RegistryError(P, `dimension ${d} appears in no loading vector`);
  }
  const ttIds = new Set(m.task_types.map((t) => t.id));
  for (const t of m.task_types) {
    for (const l of t.levers) if (!m.difficulty_levers[l]) throw new RegistryError(P, `task type ${t.id} lever ${l} ∉ difficulty_levers`);
    if (t.accessible_substitute && !ttIds.has(t.accessible_substitute)) throw new RegistryError(P, `accessible_substitute ${t.accessible_substitute} of ${t.id} is not a task type`);
    if (!t.solver && m.auto_promote && t.protocol !== 'cross_session') throw new RegistryError(P, `task type ${t.id} has no solver, so auto_promote must be false`);
    if (t.protocol === 'timed_block' && !t.expander) throw new RegistryError(P, `timed_block task type ${t.id} needs an expander`);
    if (t.protocol === 'timed_block' && !t.block_norm) throw new RegistryError(P, `timed_block task type ${t.id} needs a block_norm`);
    if (t.protocol === 'cross_session') continue;
    let anchors;
    try { anchors = anchorsFor(m, t.id); } catch { throw new RegistryError(P, `no lever_policy anchors for ${t.id}`); }
    for (const [theta, vec] of Object.entries(anchors)) {
      for (const l of t.levers) {
        if (!(l in vec)) throw new RegistryError(P, `anchor ${theta} for ${t.id} is missing lever ${l}`);
        if (!leverValueOk(m.difficulty_levers[l]!, vec[l])) throw new RegistryError(P, `anchor ${theta} for ${t.id}: ${l}=${JSON.stringify(vec[l])} is not a permitted value`);
      }
    }
  }
  for (const [name, def] of Object.entries(m.difficulty_levers)) {
    if (!def.research) throw new RegistryError(P, `lever ${name} has no research justification`);
    if (def.type !== 'continuous' && !def.values) throw new RegistryError(P, `lever ${name} needs permitted values`);
  }
  if (m.requires_services.includes('lexical')) for (const loc of m.bank.locales) {
    try { lexicon(loc); } catch { throw new RegistryError(P, `requires lexical service for locale ${loc}, which is missing`); }
  }

  const taskTypes = new Map<string, LoadedTaskType>();
  for (const t of m.task_types) {
    const lt: LoadedTaskType = {
      def: t,
      validators: [],
      scoring: await importModule<ScoringModule>(dir, t.scoring, P, 'scoring'),
    };
    if (t.author) lt.author = await importModule(dir, t.author, P, 'author');
    if (t.solver) lt.solver = await importModule(dir, t.solver, P, 'solver');
    if (t.context_blind_solver) lt.contextBlind = await importModule(dir, t.context_blind_solver, P, 'context_blind_solver');
    if (t.renderer.module) lt.renderer = await importModule(dir, t.renderer.module, P, 'renderer');
    if (t.expander) lt.expander = await importModule(dir, t.expander, P, 'expander');
    if (t.normalizer) lt.normalizer = await importModule(dir, t.normalizer, P, 'normalizer');
    if (t.vocabulary) lt.vocabulary = await importModule(dir, t.vocabulary, P, 'vocabulary');
    for (const v of t.validators) lt.validators.push(await importModule(dir, v, P, 'validator'));
    taskTypes.set(t.id, lt);
  }

  const exemplars: LoadedPlugin['exemplars'] = new Map();
  for (const t of m.task_types) {
    // Freeform types are written from the free-form prompt, which carries no exemplars.
    if (t.protocol === 'cross_session' || t.generation === 'freeform') continue;
    const rec = {} as Record<'easy' | 'medium' | 'hard', unknown[]>;
    for (const band of ['easy', 'medium', 'hard'] as const) {
      const f = path.join(dir, 'exemplars', t.id, `${band}.json`);
      if (!fs.existsSync(f)) {
        if (!requireExemplars) { rec[band] = []; continue; }
        throw new RegistryError(P, `task type ${t.id} has no exemplars for band ${band} (${f})`);
      }
      const items = JSON.parse(fs.readFileSync(f, 'utf8')).items as unknown[];
      if ((!Array.isArray(items) || items.length < 1) && requireExemplars) throw new RegistryError(P, `exemplars ${t.id}/${band} is empty`);
      rec[band] = items;
    }
    exemplars.set(t.id, rec);
  }

  const briefFile = path.join(dir, m.prompt.brief);
  if (!fs.existsSync(briefFile)) throw new RegistryError(P, `brief ${m.prompt.brief} missing`);
  let leverModel: LoadedPlugin['leverModel'] = null;
  if (m.lever_model) {
    const f = path.join(dir, m.lever_model);
    if (!fs.existsSync(f)) throw new RegistryError(P, `lever_model ${m.lever_model} missing`);
    const lm = JSON.parse(fs.readFileSync(f, 'utf8'));
    leverModel = { coefficients: lm.coefficients ?? {}, intercept: lm.intercept ?? 0, source: lm.source ?? 'designer_anchors' };
  }
  let crossSession: CrossSessionModule | undefined;
  if (m.cross_session?.enabled) crossSession = await importModule(dir, m.cross_session.module, P, 'cross_session');

  return { manifest: m, dir, brief: fs.readFileSync(briefFile, 'utf8'), taskTypes, exemplars, crossSession, leverModel };
}

export async function loadRegistry(dir = config.PLUGINS_DIR): Promise<Registry> {
  const plugins = new Map<string, LoadedPlugin>();
  const taskTypes = new Map<string, { plugin: LoadedPlugin; tt: LoadedTaskType }>();
  const dirs = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, 'manifest.json'))).sort();
  for (const d of dirs) {
    const p = await loadPlugin(path.join(dir, d));
    plugins.set(p.manifest.plugin_id, p);
    for (const [id, tt] of p.taskTypes) {
      if (taskTypes.has(id)) throw new RegistryError(p.manifest.plugin_id, `task type ${id} is already declared by ${taskTypes.get(id)!.plugin.manifest.plugin_id}`);
      taskTypes.set(id, { plugin: p, tt });
    }
  }
  return { plugins, taskTypes, dir };
}

let current: Registry | null = null;
export const setRegistry = (r: Registry) => { current = r; };
export function registry(): Registry {
  if (!current) throw new Error('plugin registry not loaded');
  return current;
}
