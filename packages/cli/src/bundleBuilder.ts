/** 从一份本地 Markdown 构建可投递的草稿（解析 frontmatter、把图片解析成字节）。 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectImageSources,
  deriveTitle,
  toPlaintextMarkdown,
  checkMarkdownStyle,
  parseFrontmatter,
  baseName,
  guessMimeFromName,
  safeFileName,
  makeCoverAsset,
} from '@kaitox/x-article';
import type { AssetMeta } from '@kaitox/x-article';
import type { DraftAssetInput, PostDraftInput, StyleReport, DraftMode } from '@kaitox/relay-protocol';

export interface ResolvedAsset extends DraftAssetInput {
  resolved: boolean;
}

/** 解析结果：图片资源 + 供 styleCheck 用的 assetMap。 */
export interface ResolveResult {
  assets: ResolvedAsset[];
  assetMap: Record<string, AssetMeta>;
  /** 解析失败（本地路径没找到 / 远程下载失败）的 src。 */
  unresolved: string[];
}

/**
 * 把 markdown 里的所有图片 src 解析成字节。
 *   - 远程 http(s)：用 fetch 下载（对应「上传端预下载远程图片」）。
 *   - 本地/相对路径：相对 mdDir 解析后读取。
 * 解析不到的记入 unresolved（styleCheck 会把它标成 image-missing）。
 */
/** 把一个图片来源（远程 URL / file:// / 本地绝对或相对路径）读成字节 + MIME。 */
async function loadImageBytes(src: string, baseDir: string): Promise<{ bytes: Uint8Array; mime: string }> {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mime: res.headers.get('content-type')?.split(';')[0]?.trim() || guessMimeFromName(src),
    };
  }
  if (src.startsWith('file://')) {
    const p = fileURLToPath(src);
    return { bytes: new Uint8Array(await readFile(p)), mime: guessMimeFromName(p) };
  }
  const p = isAbsolute(src) ? src : resolve(baseDir, decodeURIComponent(src));
  return { bytes: new Uint8Array(await readFile(p)), mime: guessMimeFromName(p) };
}

export async function resolveAssets(markdown: string, mdDir: string): Promise<ResolveResult> {
  const srcs = collectImageSources(markdown);
  const assets: ResolvedAsset[] = [];
  const assetMap: Record<string, AssetMeta> = {};
  const unresolved: string[] = [];
  const taken = new Set<string>();

  for (const src of srcs) {
    try {
      const { bytes, mime } = await loadImageBytes(src, mdDir);
      const fileName = safeFileName(baseName(src), taken);
      assets.push({ key: `img-${assets.length}`, src, fileName, mime, bytes, resolved: true });
      assetMap[src] = { bytesLen: bytes.byteLength, mime, resolved: true };
    } catch {
      unresolved.push(src);
      assetMap[src] = { resolved: false };
    }
  }

  return { assets, assetMap, unresolved };
}

/**
 * 解析封面图（CLI 的 --cover）。相对路径先按**当前工作目录**解析（与命令行传入的
 * md 路径一致），找不到再回退到 markdown 文件所在目录（与正文图片的解析规则对齐）。
 * fileName 用 cover- 前缀并避开正文图片文件名，防止覆盖。
 */
export async function resolveCover(
  coverPath: string,
  takenFileNames: Set<string>,
  mdDir?: string,
): Promise<DraftAssetInput> {
  let loaded: { bytes: Uint8Array; mime: string };
  try {
    loaded = await loadImageBytes(coverPath, process.cwd());
  } catch (err) {
    if (!mdDir || isAbsolute(coverPath) || /^(https?|file):/i.test(coverPath)) throw err;
    loaded = await loadImageBytes(coverPath, mdDir);
  }
  const { bytes, mime } = loaded;
  return makeCoverAsset(bytes, mime, coverPath, takenFileNames);
}

export interface BuildOptions {
  markdownPath: string;
  titleOverride?: string;
  mode: DraftMode;
  /** 封面图路径/URL（相对当前工作目录，找不到时回退 md 文件目录）。
   *  缺省时回退 frontmatter 的 `cover:` 字段（与 Obsidian 端行为对齐）。 */
  coverPath?: string;
}

export interface BuildResult {
  input: PostDraftInput;
  report: StyleReport;
  unresolved: string[];
  /** 指定了 --cover 但解析失败时，记下这个路径供 CLI 警告；成功则为 undefined。 */
  coverUnresolved?: string;
}

/**
 * 端到端构建一份草稿投递输入：读文件 → 剥 frontmatter → 解析图片 → styleCheck →
 * （纯文本模式）降级 → 返回 PostDraftInput 与报告。
 *
 * 说明：纯文本降级在上传端一次性完成，bundle.markdown 即「可直接转换」的最终文本；
 * 插件收到后无脑跑 markdownToContentState 即可（mode 仅作展示/记录）。
 */
export async function buildDraft(opts: BuildOptions): Promise<BuildResult> {
  const raw = await readFile(opts.markdownPath, 'utf8');
  const { fields, body } = parseFrontmatter(raw);
  const fmTitle = fields.title;
  const mdDir = dirname(resolve(opts.markdownPath));

  // 先在「原文」上解析图片 + 检查，供用户决策。
  const first = await resolveAssets(body, mdDir);
  const report = checkMarkdownStyle(body, { assetMap: first.assetMap });

  // 决定最终文本（纯文本模式做降级；图片 src 被 toPlaintextMarkdown 原样保留）。
  const finalMd = opts.mode === 'plaintext' ? toPlaintextMarkdown(body) : body;
  // rich 模式 finalMd===body，直接复用首次解析；plaintext 按最终文本重新解析以确保 src 对齐。
  const { assets, unresolved } =
    finalMd === body ? first : await resolveAssets(finalMd, mdDir);

  const title = opts.titleOverride?.trim() || fmTitle || deriveTitle(finalMd) || basename(opts.markdownPath);

  const input: PostDraftInput = {
    kind: 'x-article',
    title,
    markdown: finalMd,
    mode: opts.mode,
    source: 'cli',
    sourceMeta: { path: resolve(opts.markdownPath) },
    styleReport: report,
    assets,
  };

  // 封面（可选）：--cover 优先，缺省回退 frontmatter cover:。命名避开正文图片文件名。
  let coverUnresolved: string | undefined;
  const coverPath = opts.coverPath ?? fields.cover;
  if (coverPath) {
    const taken = new Set(assets.map((a) => a.fileName));
    try {
      input.cover = await resolveCover(coverPath, taken, mdDir);
    } catch {
      coverUnresolved = coverPath;
    }
  }

  return { input, report, unresolved, coverUnresolved };
}
