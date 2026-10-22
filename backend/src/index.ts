// API entrypoint. Boot: config → migrations → plugin registry (with boot assertions) → registry and
// prompt sync → provider probe (degraded, never fatal: sessions run from the bank) → listen.
import { ENGINE_VERSION } from '@cognimetric/core';
import { config, logConfig } from './config';
import { migrate } from './db/migrate';
import { probeProvider } from './llm';
import { loadRegistry, setRegistry } from './plugins/registry';
import { syncRegistry } from './plugins/sync';
import { createApp } from './api/app';
import { log } from './util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function boot(scope: string) {
  log(scope, `Cognimetric engine ${ENGINE_VERSION} booting`);
  logConfig((s) => log(scope, s));
  await migrate((s) => log(scope, s));
  const reg = await loadRegistry();
  setRegistry(reg);
  await syncRegistry(reg);
  log(scope, `plugins loaded: ${[...reg.plugins.values()].map((p) => `${p.manifest.plugin_id}@${p.manifest.version}`).join(', ')}`);
  const pr = await probeProvider();
  log(scope, `provider ${pr.provider}/${pr.model}: ${pr.state}`);
  return reg;
}

if (process.argv[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  boot('api')
    .then(() => {
      createApp().listen(
        config.PORT,
        '0.0.0.0',
        () => log('api', `listening on port ${config.PORT}`)
      );
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
