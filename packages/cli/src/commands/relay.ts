/**
 * `kaitox relay` — local relay lifecycle (infrastructure, feature-agnostic).
 *
 *   kaitox relay [--daemon]   run in foreground / start in background
 *   kaitox relay stop         stop the background relay
 *   kaitox relay restart      kill whatever holds the port, then start again
 *   kaitox relay status       show whether the relay is running
 */
import {
  isRelayUp,
  runRelayForeground,
  spawnRelay,
  stopRelay,
  restartRelay,
  relayBaseUrl,
} from '../relayControl.js';

export async function runRelay(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'stop') {
    const ok = await stopRelay();
    console.log(ok ? 'relay 已停止。' : '没有找到运行中的 relay（pidfile 缺失）。');
    return;
  }
  if (sub === 'restart') {
    await restartRelay();
    console.log(`relay 已重启：${relayBaseUrl()}`);
    return;
  }
  if (sub === 'status') {
    const up = await isRelayUp();
    console.log(up ? `relay 运行中：${relayBaseUrl()}` : 'relay 未运行。');
    return;
  }
  if (args.includes('--daemon')) {
    if (await isRelayUp()) {
      console.log(`relay 已在运行：${relayBaseUrl()}`);
      return;
    }
    await spawnRelay();
    console.log(`relay 已后台启动：${relayBaseUrl()}`);
    return;
  }
  // 前台
  if (await isRelayUp()) {
    console.log(`relay 已在运行：${relayBaseUrl()}（本次不重复启动）`);
    return;
  }
  await runRelayForeground();
}
