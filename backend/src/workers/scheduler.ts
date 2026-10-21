// W4 — scheduler: session suspension/abandonment, delayed-recall probe lifecycle and retention
// (90 days max; hard delete after scoring), bank-health alarms.
import { audit, q } from '../db/pool';
import { coverage } from './generator';
import { registry } from '../plugins/registry';
import { log } from '../util';

export async function scheduleTick() {
  // A worker that died mid-job must not starve its cell forever: reclaim stale running jobs.
  const stale = await q("UPDATE generation_jobs SET state='failed', error='stale: worker stopped mid-job', finished_at=now() WHERE state='running' AND started_at < now() - interval '10 minutes' RETURNING job_id");
  if (stale.length) log('W4', `reclaimed ${stale.length} stale generation job(s)`);
  const suspended = await q("UPDATE sessions SET suspended_at=now() WHERE phase <> 'done' AND suspended_at IS NULL AND last_activity_at < now() - interval '10 minutes' RETURNING session_id");
  const abandoned = await q("UPDATE sessions SET phase='done', completed_at=now(), stop_reason='abandoned' WHERE phase <> 'done' AND suspended_at < now() - interval '24 hours' RETURNING session_id");
  await q("UPDATE administrations SET state='abandoned' WHERE state='served' AND session_id IN (SELECT session_id FROM sessions WHERE stop_reason='abandoned')");
  const due = await q("UPDATE recall_probes SET state='due' WHERE state='pending' AND due_at <= now() RETURNING probe_id");
  const expired = await q("UPDATE recall_probes SET state='expired', stored_answer=NULL WHERE state IN ('pending','due') AND due_at < now() - interval '7 days' RETURNING probe_id");
  const deleted = await q("DELETE FROM recall_probes WHERE delete_after < now() OR (state='awaiting_answer' AND asked_at < now() - interval '1 day') RETURNING probe_id");
  if (suspended.length + abandoned.length + due.length + expired.length + deleted.length)
    log('W4', `suspended ${suspended.length}, abandoned ${abandoned.length}, probes due ${due.length}, expired ${expired.length}, hard-deleted ${deleted.length}`);
  const low = (await coverage()).filter((c) => c.live < 0.5 * registry().plugins.get(c.plugin_id)!.manifest.bank.k_min_per_cell);
  if (low.length) await audit('W4', 'bank_depth_alarm', 'bank', null, { cells_below_half_kmin: low.length, sample: low.slice(0, 5) });
}
