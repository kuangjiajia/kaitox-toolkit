/** relay 的路径、端口、CORS 与 token 配置。 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

// Read the version from package.json at runtime so it can never drift.
export const RELAY_VERSION: string = (() => {
  try {
    return createRequire(import.meta.url)('../package.json').version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
export const DEFAULT_PORT = 8765;
export const HOST = '127.0.0.1';

export function relayPort(): number {
  const p = process.env.KAITOX_RELAY_PORT;
  const n = p ? parseInt(p, 10) : DEFAULT_PORT;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PORT;
}

/** ~/.kaitox（可用 KAITOX_HOME 覆盖，方便测试）。 */
export function kaitoxHome(): string {
  return process.env.KAITOX_HOME || join(homedir(), '.kaitox');
}
export function outboxDir(): string {
  return join(kaitoxHome(), 'outbox');
}
export function sentDir(): string {
  return join(kaitoxHome(), 'sent');
}
export function configPath(): string {
  return join(kaitoxHome(), 'config.json');
}
export function pidPath(): string {
  return join(kaitoxHome(), 'relay.pid');
}

export interface RelayConfig {
  /** 可选 per-install token；设置后各端须带 x-kaitox-token。默认不设（v1）。 */
  token?: string;
}

export async function loadConfig(): Promise<RelayConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { token: typeof parsed.token === 'string' ? parsed.token : undefined };
  } catch {
    return {};
  }
}

/**
 * CORS：只放行 x.com / twitter.com 和任意 chrome-extension:// 源。
 * 无 Origin（CLI/同进程/curl）视为放行——它们不是浏览器跨源场景。
 */
const ALLOWED_ORIGIN_RE = [
  /^https?:\/\/(x\.com|twitter\.com|mobile\.twitter\.com)$/i,
  /^chrome-extension:\/\/[a-z]+$/i,
  /^app:\/\/obsidian\.md$/i, // Obsidian 桌面端 renderer
];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGIN_RE.some((re) => re.test(origin));
}
