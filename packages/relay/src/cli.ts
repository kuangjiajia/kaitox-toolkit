#!/usr/bin/env node
/**
 * kaitox-relay —— 本地草稿包中转服务的命令行。
 *
 *   kaitox-relay start     后台启动（守护进程，拉起后立即返回）
 *   kaitox-relay dev       前台启动（阻塞，Ctrl-C 退出；调试用）
 *   kaitox-relay stop      停止后台服务
 *   kaitox-relay status    查看运行状态
 *   kaitox-relay restart   停止后重新后台启动
 *
 * 需要 Node 18+（用到全局 fetch）。数据落在 ~/.kaitox/outbox（可用 KAITOX_HOME 覆盖），
 * 端口默认 8765（可用 KAITOX_RELAY_PORT 覆盖）。
 */
import { fileURLToPath } from 'node:url';
import { startRelay, type RelayServerHandle } from './server.js';
import { RELAY_VERSION } from './config.js';
import { isRelayUp, spawnDaemon, stopDaemon, relayBaseUrl } from './daemon.js';

/** 本脚本（cli.js）的绝对路径，供 spawnDaemon 重跑自身。 */
const SELF = fileURLToPath(import.meta.url);

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'start':
      await cmdStart();
      break;
    case 'dev':
      await cmdDev();
      break;
    case 'stop':
      await cmdStop();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'restart':
      await cmdStop();
      await cmdStart();
      break;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      break;
    case '-v':
    case '--version':
      console.log(RELAY_VERSION);
      break;
    default:
      console.error(`未知命令：${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

/** 后台启动：已在跑则提示，否则 detached 拉起并等就绪。 */
async function cmdStart(): Promise<void> {
  if (await isRelayUp()) {
    console.log(`relay 已在运行：${relayBaseUrl()}`);
    return;
  }
  await spawnDaemon(SELF);
  console.log(`relay 已后台启动：${relayBaseUrl()}`);
}

/** 前台运行：阻塞直到收到退出信号。 */
async function cmdDev(): Promise<void> {
  if (await isRelayUp()) {
    console.log(`relay 已在运行：${relayBaseUrl()}（本次不重复启动）`);
    return;
  }
  let handle: RelayServerHandle;
  try {
    handle = await startRelay();
  } catch (err) {
    console.error('[kaitox-relay] 启动失败：', (err as any)?.message ?? err);
    process.exit(1);
  }
  console.log(`[kaitox-relay] 前台运行于 ${relayBaseUrl()}  (Ctrl-C 退出)`);
  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      await handle.close();
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
  process.exit(0);
}

async function cmdStop(): Promise<void> {
  const ok = await stopDaemon();
  console.log(ok ? 'relay 已停止。' : '没有找到运行中的 relay（pidfile 缺失）。');
}

async function cmdStatus(): Promise<void> {
  console.log((await isRelayUp()) ? `relay 运行中：${relayBaseUrl()}` : 'relay 未运行。');
}

function printHelp(): void {
  console.log(`kaitox-relay ${RELAY_VERSION} —— 本地草稿包中转服务

用法：
  kaitox-relay start      后台启动（守护进程，拉起后返回）
  kaitox-relay dev        前台启动（阻塞，Ctrl-C 退出；调试用）
  kaitox-relay stop       停止后台服务
  kaitox-relay status     查看运行状态
  kaitox-relay restart    重启（stop 后 start）

环境变量：
  KAITOX_HOME         数据目录（默认 ~/.kaitox）
  KAITOX_RELAY_PORT   监听端口（默认 8765）`);
}

main().catch((err) => {
  console.error('出错：', err?.message ?? err);
  process.exit(1);
});
