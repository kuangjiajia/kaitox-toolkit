/**
 * 笔记解析：把当前 Markdown 笔记（含 Obsidian ![[wikilink]] 嵌入、相对路径、
 * 远程图片、frontmatter cover）解析成「标准化正文 + 图片字节」。
 *
 * 预览、样式检查、推送三处共用同一份解析结果——预览里看到的就是推送出去的，
 * 保证所见即所得。原逻辑来自 main.ts 的 resolveAndRewrite/resolveCover，抽出复用。
 */
import { requestUrl, TFile, type App } from 'obsidian';
import {
  parseFrontmatter,
  baseName,
  guessMimeFromName,
  safeFileName,
  makeCoverAsset,
  deriveTitle,
} from '@kaitox/x-article';
import type { AssetMeta } from '@kaitox/x-article';
import type { DraftAssetInput } from '@kaitox/relay-protocol';

export interface Resolved {
  title: string;
  /** 标准化后的正文（![[wiki]]/相对路径/远程图都改写成 ![alt](fileName)）。 */
  body: string;
  assets: DraftAssetInput[];
  assetMap: Record<string, AssetMeta>;
  /** 解析失败、将被跳过的引用（图片或封面）。 */
  unresolved: string[];
  /** frontmatter cover: 解析出的封面（可选，不进正文）。 */
  cover?: DraftAssetInput;
}

/** 读笔记、把嵌入/图片解析成字节、改写成标准 ![alt](fileName)。 */
export async function resolveActiveNote(app: App, file: TFile): Promise<Resolved> {
  const raw = await app.vault.cachedRead(file);
  const { fields, body } = parseFrontmatter(raw);
  const fmTitle = fields.title;
  const fmCover = fields.cover;

  const assets: DraftAssetInput[] = [];
  const assetMap: Record<string, AssetMeta> = {};
  const unresolved: string[] = [];
  const taken = new Set<string>();
  const byIdentity = new Map<string, string>(); // 文件身份 → 已分配 src（去重复引用）

  const addAsset = (bytes: Uint8Array, rawName: string, mime: string, identity: string): string => {
    const existing = byIdentity.get(identity);
    if (existing) return existing; // 同一文件多次引用 → 复用一个资源，避免重复上传
    const fileName = safeFileName(rawName, taken);
    const src = fileName;
    assets.push({ key: `img-${assets.length}`, src, fileName, mime, bytes });
    assetMap[src] = { bytesLen: bytes.byteLength, mime, resolved: true };
    byIdentity.set(identity, src);
    return src;
  };

  // 1) ![[wikilink]] 嵌入
  let work = await replaceAsync(body, /!\[\[([^\]\n]+?)\]\]/g, async (whole, inner) => {
    const { link, alias } = splitWiki(inner);
    const tfile = app.metadataCache.getFirstLinkpathDest(link, file.path);
    if (!tfile || !isImageExt(tfile.extension)) {
      unresolved.push(inner);
      return whole;
    }
    const bytes = new Uint8Array(await app.vault.readBinary(tfile));
    const src = addAsset(bytes, tfile.name, guessMimeFromName(tfile.name), tfile.path);
    return `![${alias ?? ''}](${src})`;
  });

  // 2) 标准 ![alt](src)
  work = await replaceAsync(work, /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, async (whole, alt, src) => {
    if (assetMap[src]) return whole; // 已是我们改写过的资源
    try {
      if (/^https?:\/\//i.test(src)) {
        const r = await requestUrl({ url: src });
        const bytes = new Uint8Array(r.arrayBuffer);
        const mime =
          (r.headers['content-type'] || r.headers['Content-Type'] || '').split(';')[0] || guessMimeFromName(src);
        const newSrc = addAsset(bytes, baseName(src) || 'image', mime, src);
        return `![${alt}](${newSrc})`;
      }
      const dec = decodeURIComponent(src);
      const tfile = app.metadataCache.getFirstLinkpathDest(dec, file.path);
      if (!tfile) {
        unresolved.push(src);
        return whole;
      }
      const bytes = new Uint8Array(await app.vault.readBinary(tfile));
      const newSrc = addAsset(bytes, tfile.name, guessMimeFromName(tfile.name), tfile.path);
      return `![${alt}](${newSrc})`;
    } catch {
      unresolved.push(src);
      return whole;
    }
  });

  // frontmatter cover: 解析封面（wikilink / 相对路径 / 远程 URL）。不进正文。
  let cover: DraftAssetInput | undefined;
  if (fmCover) {
    cover = (await resolveCover(app, fmCover, file, taken)) ?? undefined;
    if (!cover) unresolved.push(`cover: ${fmCover}`);
  }

  const title = fmTitle || deriveTitle(work) || file.basename;
  return { title, body: work, assets, assetMap, unresolved, cover };
}

/** 把一张图片文件读成封面资产（'__cover__' 哨兵）。支持 [[wiki]]、相对路径、http(s)。 */
export async function resolveCover(
  app: App,
  ref: string,
  file: TFile,
  taken: Set<string>,
): Promise<DraftAssetInput | null> {
  try {
    let bytes: Uint8Array;
    let mime: string;
    let rawName: string;
    if (/^https?:\/\//i.test(ref)) {
      const r = await requestUrl({ url: ref });
      bytes = new Uint8Array(r.arrayBuffer);
      mime = (r.headers['content-type'] || r.headers['Content-Type'] || '').split(';')[0] || guessMimeFromName(ref);
      rawName = baseName(ref) || 'cover';
    } else {
      const wiki = ref.match(/^!?\[\[([^\]]+?)\]\]$/);
      const link = wiki ? splitWiki(wiki[1]).link : ref;
      const tfile = app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!tfile || !isImageExt(tfile.extension)) return null;
      bytes = new Uint8Array(await app.vault.readBinary(tfile));
      mime = guessMimeFromName(tfile.name);
      rawName = tfile.name;
    }
    return makeCoverAsset(bytes, mime, rawName, taken);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 纯工具（浏览器环境安全，不依赖 node:path）
// ---------------------------------------------------------------------------

export async function replaceAsync(
  str: string,
  regex: RegExp,
  fn: (whole: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...str.matchAll(regex)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += str.slice(last, m.index);
    out += await fn(m[0], ...m.slice(1));
    last = (m.index ?? 0) + m[0].length;
  }
  out += str.slice(last);
  return out;
}

export function splitWiki(inner: string): { link: string; alias?: string } {
  let link = inner;
  let alias: string | undefined;
  const pipe = inner.indexOf('|');
  if (pipe >= 0) {
    link = inner.slice(0, pipe);
    alias = inner.slice(pipe + 1).trim();
  }
  const hash = link.indexOf('#');
  if (hash >= 0) link = link.slice(0, hash);
  return { link: link.trim(), alias };
}

export function isImageExt(ext: string): boolean {
  return /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(ext.replace(/^\./, ''));
}

/** 字节 → 可显示的 blob URL。（cast 规避 TS lib 对 Uint8Array<ArrayBufferLike> 的名义收紧。） */
export function bytesToBlobUrl(bytes: Uint8Array, mime: string): string {
  return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
}
