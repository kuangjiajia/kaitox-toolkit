/**
 * `kaitox x` — X (Twitter) Article publishing commands.
 *
 *   kaitox x push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]
 *   kaitox x list
 *   kaitox x status <id>
 */
import { stat } from 'node:fs/promises';
import type { DraftMode } from '@kaitox/relay-protocol';
import { buildDraft } from '../bundleBuilder.js';
import { printReport, promptDecision } from '../report.js';
import { ensureRelay, makeClient, isRelayUp } from '../relayControl.js';

export const ARTICLES_URL = 'https://x.com/compose/articles';

export async function runX(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'push':
      await cmdPush(args.slice(1));
      break;
    case 'list':
      await cmdList();
      break;
    case 'status':
      await cmdStatus(args.slice(1));
      break;
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      printXHelp();
      break;
    default:
      console.error(`Unknown subcommand: kaitox x ${sub}\n`);
      printXHelp();
      process.exit(1);
  }
}

// --- push ------------------------------------------------------------------

async function cmdPush(args: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    console.error('Usage: kaitox x push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]');
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
    console.error('Usage: --cover <image path or URL> (--cover requires a value)');
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
      console.log('已取消。修改后重新运行 `kaitox x push`。');
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

// --- list / status ----------------------------------------------------------

async function cmdList(): Promise<void> {
  if (!(await isRelayUp())) {
    console.log('relay 未运行。先 `kaitox relay --daemon` 或 `kaitox x push` 会自动拉起。');
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
    console.error('Usage: kaitox x status <id>');
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

export function printXHelp(): void {
  console.log(`kaitox x — publish local Markdown as X (Twitter) Article drafts

Usage:
  kaitox x push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]
      Style-check the Markdown, bundle it (with image bytes) and deliver
      it to the local relay.
      --cover IMG  article cover image (local path or http(s) URL; resolved
                   against the current directory, falling back to the
                   Markdown file's directory)
      --plaintext  degrade to plaintext mode when the content is unfriendly
      --force      upload as-is (rich) even when unfriendly
      --title T    override the title

  kaitox x list               list pending drafts on the relay
  kaitox x status <id>        show the status of one draft

After pushing: open ${ARTICLES_URL} and click "上传草稿" in the kaitox
extension panel.`);
}
