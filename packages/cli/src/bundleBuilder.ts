/** 从一份本地 Markdown 构建可投递的草稿（解析 frontmatter、把图片解析成字节）。 */
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectImageSources,
  deriveTitle,
  toPlaintextMarkdown,
  checkMarkdownStyle,
} from '@kaitox/core';
import type { DraftAssetInput, PostDraftInput, StyleReport, DraftMode } from '@kaitox/core';
import type { AssetMeta } from '@kaitox/core';

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

/** 剥离 YAML frontmatter，并尽力取出 title。 */
export function parseFrontmatter(md: string): { title?: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: md };
  const yaml = m[1];
  const body = md.slice(m[0].length);
  const titleLine = yaml.split(/\r?\n/).find((l) => /^title\s*:/.test(l));
  let title: string | undefined;
  if (titleLine) {
    title = titleLine.replace(/^title\s*:/, '').trim().replace(/^["']|["']$/g, '') || undefined;
  }
  return { title, body };
}

function guessMime(pathOrSrc: string): string {
  const ext = extname(pathOrSrc.split('?')[0]).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function safeFileName(src: string, taken: Set<string>): string {
  let name = basename(src.split('?')[0].split('#')[0]) || 'image';
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!extname(name)) name += '.bin';
  let candidate = name;
  let i = 1;
  while (taken.has(candidate)) {
    const dot = name.lastIndexOf('.');
    candidate = `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
    i++;
  }
  taken.add(candidate);
  return candidate;
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
      mime: res.headers.get('content-type')?.split(';')[0]?.trim() || guessMime(src),
    };
  }
  if (src.startsWith('file://')) {
    const p = fileURLToPath(src);
    return { bytes: new Uint8Array(await readFile(p)), mime: guessMime(p) };
  }
  const p = isAbsolute(src) ? src : resolve(baseDir, decodeURIComponent(src));
  return { bytes: new Uint8Array(await readFile(p)), mime: guessMime(p) };
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
      const fileName = safeFileName(src, taken);
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
 * 解析封面图（CLI 的 --cover）。路径相对**当前工作目录**（与命令行传入的 md 路径一致，
 * 而非 markdown 文件所在目录）。fileName 用 cover- 前缀并避开正文图片文件名，防止覆盖。
 */
export async function resolveCover(coverPath: string, takenFileNames: Set<string>): Promise<DraftAssetInput> {
  const { bytes, mime } = await loadImageBytes(coverPath, process.cwd());
  const rawBase = basename(coverPath.split('?')[0].split('#')[0]) || 'image';
  const fileName = safeFileName(`cover-${rawBase}`, takenFileNames);
  return { key: 'cover', src: '__cover__', fileName, mime, bytes };
}

export interface BuildOptions {
  markdownPath: string;
  titleOverride?: string;
  mode: DraftMode;
  /** 封面图路径/URL（相对当前工作目录）。 */
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
  const { title: fmTitle, body } = parseFrontmatter(raw);
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
    title,
    markdown: finalMd,
    mode: opts.mode,
    source: 'cli',
    sourceMeta: { path: resolve(opts.markdownPath) },
    styleReport: report,
    assets,
  };

  // 封面（可选）。命名避开正文图片文件名，防止写盘时互相覆盖。
  let coverUnresolved: string | undefined;
  if (opts.coverPath) {
    const taken = new Set(assets.map((a) => a.fileName));
    try {
      input.cover = await resolveCover(opts.coverPath, taken);
    } catch {
      coverUnresolved = opts.coverPath;
    }
  }

  return { input, report, unresolved, coverUnresolved };
}
