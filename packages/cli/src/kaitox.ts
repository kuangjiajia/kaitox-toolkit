#!/usr/bin/env node
/**
 * kaitox —— 把本地 Markdown 检查、打包并投递到本地 relay，供 Chrome 插件同步为 X Article 草稿。
 *
 *   kaitox push <file.md> [--title T] [--plaintext] [--force]
 *   kaitox relay [--daemon] | relay stop | relay status
 *   kaitox list
 *   kaitox status <id>
 */
import { basename } from 'node:path';
import { stat } from 'node:fs/promises';
import type { DraftMode } from '@kaitox/relay-protocol';
import { buildDraft } from './bundleBuilder.js';
import { printReport, promptDecision } from './report.js';
import {
  ensureRelay,
  makeClient,
  isRelayUp,
  runRelayForeground,
  spawnRelay,
  stopRelay,
  relayBaseUrl,
} from './relayControl.js';

const ARTICLES_URL = 'https://x.com/compose/articles';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case 'push':
      await cmdPush(argv.slice(1));
      break;
    case 'relay':
      await cmdRelay(argv.slice(1));
      break;
    case 'list':
      await cmdList();
      break;
    case 'status':
      await cmdStatus(argv.slice(1));
      break;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      break;
    default:
      console.error(`未知命令：${cmd}\n`);
      printHelp();
      process.exit(1);
  }
}

// --- push ------------------------------------------------------------------

async function cmdPush(args: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    console.error('用法：kaitox push <file.md> [--title T] [--plaintext] [--force]');
    process.exit(1);
  }
  try {
    await stat(file);
  } catch {
    console.error(`文件不存在：${file}`);
    process.exit(1);
  }

  const titleOverride = flags.title as string | undefined;
  const forcePlaintext = !!flags.plaintext;
  const forceRaw = !!flags.force;
  const coverPath = typeof flags.cover === 'string' ? flags.cover : undefined;
  if (flags.cover === true) {
    console.error('用法：--cover <图片路径或URL>（--cover 需要跟一个值）');
    process.exit(1);
  }

  // 先按用户初选的模式构建（默认 rich）以拿到风格报告。
  let mode: DraftMode = forcePlaintext ? 'plaintext' : 'rich';
  let built = await buildDraft({ markdownPath: file, titleOverride, mode, coverPath });
  printReport(built.report);

  // 不友好且未显式指定处理方式 → 询问。
  if (!built.report.friendly && !forcePlaintext && !forceRaw) {
    const decision = await promptDecision();
    if (decision === 'fix') {
      console.log('已取消。修改后重新运行 `kaitox push`。');
      return;
    }
    if (decision === 'plaintext') {
      mode = 'plaintext';
      built = await buildDraft({ markdownPath: file, titleOverride, mode, coverPath });
      console.log('→ 使用纯文本兜底模式。');
    }
    // decision === 'upload' → 原样 rich 上传
  }

  if (built.unresolved.length) {
    console.warn(`⚠ 有 ${built.unresolved.length} 张图片未解析，将被跳过：`);
    for (const s of built.unresolved) console.warn(`    ${s}`);
  }
  if (built.coverUnresolved) {
    console.warn(`⚠ 封面图未解析，将不设封面：${built.coverUnresolved}`);
  }

  // 确保 relay 在跑（不在就拉起）。
  await ensureRelay();
  const client = await makeClient();
  const { id } = await client.postDraft(built.input);

  console.log(`\n✓ 草稿已投递到 relay（id: ${id}）。`);
  console.log(`  标题：${built.input.title}`);
  console.log(`  模式：${built.input.mode}   图片：${built.input.assets.length} 张`);
  if (built.input.cover) console.log(`  封面：${built.input.cover.fileName}（上传时设为文章封面）`);
  console.log(`\n下一步：在浏览器打开 ${ARTICLES_URL} ，在 kaitox 插件面板里点「上传草稿」。`);
}

// --- relay ------------------------------------------------------------------

async function cmdRelay(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'stop') {
    const ok = await stopRelay();
    console.log(ok ? 'relay 已停止。' : '没有找到运行中的 relay（pidfile 缺失）。');
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

// --- list / status ----------------------------------------------------------

async function cmdList(): Promise<void> {
  if (!(await isRelayUp())) {
    console.log('relay 未运行。先 `kaitox relay --daemon` 或 `kaitox push` 会自动拉起。');
    return;
  }
  const client = await makeClient();
  const items = await client.listDrafts();
  if (!items.length) {
    console.log('（暂无待上传草稿）');
    return;
  }
  console.log('待上传草稿：');
  for (const d of items) {
    const warn = d.counts ? ` [${d.counts.error}E/${d.counts.warning}W]` : '';
    console.log(`  ${d.id.slice(0, 8)}  ${d.status.padEnd(9)} ${d.mode.padEnd(9)} ${d.title}${warn}`);
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error('用法：kaitox status <id>');
    process.exit(1);
  }
  if (!(await isRelayUp())) {
    console.log('relay 未运行。');
    return;
  }
  const client = await makeClient();
  try {
    const d = await client.getDraft(id);
    console.log(`标题：${d.title}`);
    console.log(`状态：${d.status ?? 'pending'}`);
    if (d.restId) console.log(`文章 rest_id：${d.restId}`);
    if (d.error) console.log(`错误：${d.error}`);
  } catch {
    console.error(`找不到草稿：${id}`);
    process.exit(1);
  }
}

// --- helpers ----------------------------------------------------------------

function parseArgs(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function printHelp(): void {
  console.log(`kaitox —— 本地 Markdown → X Article 草稿投递

用法：
  kaitox push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]
      检查 Markdown 的推特友好度，打包投递到本地 relay。
      --cover IMG  指定文章封面图（本地路径或 http(s) URL，相对当前目录）
      --plaintext  不友好时直接用纯文本兜底模式
      --force      不友好时仍按原样（rich）上传
      --title T    覆盖标题

  kaitox relay [--daemon]     前台/后台启动本地 relay
  kaitox relay stop           停止后台 relay
  kaitox relay status         查看 relay 状态
  kaitox list                 列出待上传草稿
  kaitox status <id>          查看某草稿状态

投递后：打开 ${ARTICLES_URL} ，在 kaitox 插件面板点「上传草稿」。`);
}

main().catch((err) => {
  console.error('出错：', err?.message ?? err);
  process.exit(1);
});
