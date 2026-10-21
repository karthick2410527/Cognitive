// Worker entrypoint: same image as the API, different entrypoint (Doc 01 §12). W1 generation with
// W2 validation inline per job, W3 calibration, W4 scheduling.
import { config } from '../config';
import { providerDegraded } from '../llm';
import { boot } from '../index';
import { log } from '../util';
import { calibrate } from './calibrator';
import { drainJobs, topUpTick } from './generator';
import { scheduleTick } from './scheduler';

function every(ms: number, name: string, fn: () => Promise<void>) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { log(name, `error: ${(e as Error).message}`); } finally { busy = false; }
  };
  void run();
  return setInterval(run, ms);
}

await boot('workers');
let paused = false;
every(config.WORKER_INTERVAL_MS, 'W1', async () => {
  // While the provider is paused (e.g. its daily quota is used up) W1 makes no calls at all; it resumes
  // by itself when the pause expires.
  if (providerDegraded()) {
    if (!paused) log('W1', 'provider paused — bank top-up waits until it is available again');
    paused = true;
    return;
  }
  if (paused) log('W1', 'provider available again — bank top-up resumes');
  paused = false;
  if (config.WORKER_TOPUP) await topUpTick();
  await drainJobs(4);
});
every(config.SCHEDULER_INTERVAL_MS, 'W4', scheduleTick);
every(config.CALIBRATOR_INTERVAL_MS, 'W3', calibrate);
log('workers', `running: W1 every ${config.WORKER_INTERVAL_MS} ms (top-up ${config.WORKER_TOPUP ? 'on' : 'off'}), W4 every ${config.SCHEDULER_INTERVAL_MS} ms, W3 every ${config.CALIBRATOR_INTERVAL_MS} ms`);
