// Item Bank API (Doc 01 §2): selection queries, reservation via the administrations unique index,
// exposure tracking, coverage. Never mutates item content.
import { q, q1, type Db } from '../db/pool';

export interface Candidate {
  item_id: string;
  task_type: string;
  difficulty_b: number;
  discrimination_a: number;
  param_source: string;
  n_administered: number;
  job_kind: string | null;
  created_at: Date;
}

/**
 * Items that passed every gate, not yet seen in this session, nearest to target b. Normally only
 * 'live' items; with `includeValidated` also 'validated' ones (passed every automatic gate, awaiting
 * human review — used when the deployment serves unreviewed items).
 */
export async function candidates(pluginId: string, locale: string, taskTypes: string[], sessionId: string, targetB: number, limit = 60, db?: Db, includeValidated = false): Promise<Candidate[]> {
  if (!taskTypes.length) return [];
  return q<Candidate>(
    `SELECT i.item_id, i.task_type, i.difficulty_b, i.discrimination_a, i.param_source, coalesce(s.n_administered,0) AS n_administered,
            j.kind AS job_kind, i.created_at
     FROM items i
     LEFT JOIN item_stats s USING (item_id)
     LEFT JOIN generation_jobs j ON j.job_id::text = i.provenance->>'job_id'
     WHERE i.plugin_id=$1 AND i.status = ANY($7) AND i.locale=$2 AND i.task_type = ANY($3)
       AND NOT coalesce(s.drift_flag, false)
       AND NOT EXISTS (SELECT 1 FROM item_validations v WHERE v.item_id = i.item_id AND v.verdict <> 'pass')
       AND NOT EXISTS (SELECT 1 FROM administrations a WHERE a.session_id=$4 AND a.item_id=i.item_id)
     ORDER BY abs(i.difficulty_b - $5), random()
     LIMIT $6`,
    [pluginId, locale, taskTypes, sessionId, targetB, limit, includeValidated ? ['live', 'validated'] : ['live']], db,
  );
}

/** Recent exposure rate of items in a plugin: administrations / sessions that used the plugin (7 days). */
export async function exposureRates(pluginId: string, itemIds: string[], db?: Db): Promise<Map<string, number>> {
  if (!itemIds.length) return new Map();
  const sessions = await q1<{ n: number }>(
    "SELECT count(DISTINCT session_id)::int AS n FROM administrations WHERE plugin_id=$1 AND served_at > now() - interval '7 days'", [pluginId], db);
  const n = Math.max(20, sessions?.n ?? 0); // a floor keeps the first sessions from looking over-exposed
  const rows = await q<{ item_id: string; k: number }>(
    "SELECT item_id, count(*)::int AS k FROM administrations WHERE item_id = ANY($1) AND served_at > now() - interval '7 days' GROUP BY item_id", [itemIds], db);
  return new Map(rows.map((r) => [r.item_id, r.k / n]));
}

export async function bankDepth(pluginId: string, taskType: string, locale: string, band: number, db?: Db): Promise<number> {
  const r = await q1<{ n: number }>("SELECT count(*)::int AS n FROM items WHERE plugin_id=$1 AND task_type=$2 AND locale=$3 AND b_band=$4 AND status='live'", [pluginId, taskType, locale, band], db);
  return r?.n ?? 0;
}

export async function getItem(itemId: string, db?: Db) {
  return q1<{
    item_id: string; plugin_id: string; task_type: string; protocol: string; blueprint: Record<string, unknown>; levers: Record<string, unknown>;
    answer_key: { kind: string; value: unknown }; response_spec: Record<string, unknown>; difficulty_b: number; discrimination_a: number;
    text_alternative: string | null; accessibility: Record<string, unknown>; status: string; provenance: Record<string, unknown>; rationale: string | null; locale: string; b_band: number; param_source: string;
  }>('SELECT * FROM items WHERE item_id=$1', [itemId], db);
}

export async function rendering(itemId: string, variant: string, db?: Db): Promise<unknown | null> {
  const r = await q1<{ payload: string }>(
    "SELECT payload FROM item_renderings WHERE item_id=$1 AND variant IN ($2,'default') ORDER BY (variant=$2) DESC LIMIT 1", [itemId, variant], db);
  return r ? JSON.parse(r.payload) : null;
}
