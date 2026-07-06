/** relay 生命周期：探活、按需 detached 拉起、停止、状态。委托给 @kaitox/relay 的 daemon 助手。 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { HttpRelayClient } from '@kaitox/core';
import {
  loadConfig,
  isRelayUp as relayIsUp,
  spawnDaemon,
  stopDaemon,
  relayBaseUrl as relayBase,
  startRelay,
} from '@kaitox/relay';

const require = createRequire(import.meta.url);

export function relayBaseUrl(): string {
  return relayBase();
}

/** relay CLI 可执行入口（@kaitox/relay 的 dist/cli.js）。 */
function relayCliPath(): string {
  const index = require.resolve('@kaitox/relay');
  return join(dirname(index), 'cli.js');
}

export async function makeClient(): Promise<HttpRelayClient> {
  const { token } = await loadConfig();
  return new HttpRelayClient(relayBaseUrl(), { token });
}

export async function isRelayUp(): Promise<boolean> {
  return relayIsUp();
}

/** detached 拉起 relay 并等待 /health 就绪。 */
export async function spawnRelay(): Promise<void> {
  await spawnDaemon(relayCliPath());
}

/** 确保 relay 在跑：不在就拉起。 */
export async function ensureRelay(): Promise<void> {
  if (await relayIsUp()) return;
  await spawnDaemon(relayCliPath());
}

/** 前台运行 relay（阻塞，直到 Ctrl-C）。 */
export async function runRelayForeground(): Promise<void> {
  const handle = await startRelay();
  console.log(`[kaitox] relay 前台运行于 ${relayBaseUrl()}  (Ctrl-C 退出)`);
  await new Promise<void>((resolvePromise) => {
    const shutdown = async () => {
      await handle.close();
      resolvePromise();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

export async function stopRelay(): Promise<boolean> {
  return stopDaemon();
}
