/** 后台守护进程的拉起 / 探活 / 停止。供 relay 自己的 CLI 与外部（@kaitox/cli）复用。 */
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { HOST, relayPort, pidPath } from './config.js';

export function relayBaseUrl(): string {
  return `http://${HOST}:${relayPort()}`;
}

/** 探活：GET /health（health 不需要 token）。Node 18+ 全局 fetch。 */
export async function isRelayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${relayBaseUrl()}/health`);
    if (!res.ok) return false;
    const j = (await res.json()) as { ok?: boolean };
    return !!j.ok;
  } catch {
    return false;
  }
}

/**
 * detached 拉起后台 relay：重跑自身入口的 `dev`（前台）子进程，脱离父进程，
 * 然后轮询 /health 直到就绪（最多 ~5s）。
 *
 * @param entryScript relay CLI 的可执行脚本绝对路径（cli.js），由入口传入。
 */
export async function spawnDaemon(entryScript: string): Promise<void> {
  const child = spawn(process.execPath, [entryScript, 'dev'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  for (let i = 0; i < 50; i++) {
    if (await isRelayUp()) return;
    await sleep(100);
  }
  throw new Error('relay 拉起后未在超时内就绪。用前台模式 `kaitox-relay dev` 看具体报错。');
}

/**
 * 读 pidfile 并 SIGTERM 停止后台 relay，等到端口真正释放（/health 不再应答）再返回。
 * 返回是否找到并发了信号（等待端口释放是尽力而为，不影响返回值）。
 */
export async function stopDaemon(): Promise<boolean> {
  let signalled = false;
  try {
    const pid = parseInt((await readFile(pidPath(), 'utf8')).trim(), 10);
    if (Number.isFinite(pid)) {
      process.kill(pid, 'SIGTERM');
      await rm(pidPath(), { force: true }).catch(() => {});
      signalled = true;
    }
  } catch {
    /* no pidfile */
  }
  if (signalled) await waitUntilDown();
  return signalled;
}

/** 轮询直到 /health 不再应答（或超时）。用于 restart 时避免和正在退出的旧进程抢端口。 */
export async function waitUntilDown(timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isRelayUp())) return;
    await sleep(100);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
