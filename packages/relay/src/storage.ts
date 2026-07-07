/** 草稿包在磁盘上的读写。布局：~/.kaitox/outbox/<id>/bundle.json + assets/<fileName>。 */
import { mkdir, readFile, writeFile, readdir, rm, rename, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { base64ToBytes, draftKind } from '@kaitox/relay-protocol';
import type { DraftBundle, DraftListItem, DraftStatus, PostDraftWireBody } from '@kaitox/relay-protocol';
import { outboxDir, sentDir } from './config.js';
import { fitImageBytes } from './imageFit.js';

const BUNDLE_FILE = 'bundle.json';
const ASSETS_DIR = 'assets';

/** id / 文件名清洗，防目录穿越。 */
export function sanitizeId(id: string): string {
  const s = basename(String(id)).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!s) throw new Error('非法 id');
  return s;
}
export function sanitizeFileName(name: string): string {
  const s = basename(String(name));
  if (!s || s === '.' || s === '..' || /[\\/]/.test(name)) throw new Error('非法文件名');
  return s;
}

async function ensureDirs(): Promise<void> {
  await mkdir(outboxDir(), { recursive: true });
  await mkdir(sentDir(), { recursive: true });
}

function draftDir(id: string, sent = false): string {
  return join(sent ? sentDir() : outboxDir(), id);
}

/** 落盘一份草稿包（POST /:kind/drafts）。kind 由路由层从路径段传入盖章。返回 id。 */
export async function saveDraft(wire: PostDraftWireBody, kind?: string): Promise<string> {
  await ensureDirs();
  const id = sanitizeId(wire.bundle.id);
  const dir = draftDir(id);
  await mkdir(join(dir, ASSETS_DIR), { recursive: true });

  // 写资源字节（base64 → 二进制）；超过 X 上限的图片入库前静默压到限内。
  const written = new Map<string, { mime: string; bytesLen: number }>();
  const assetsByName = new Map(wire.assets.map((a) => [sanitizeFileName(a.fileName), a]));
  for (const [fileName, a] of assetsByName) {
    const fit = await fitImageBytes(base64ToBytes(a.base64), a.mime);
    written.set(fileName, { mime: fit.mime, bytesLen: fit.bytes.byteLength });
    await writeFile(join(dir, ASSETS_DIR, fileName), fit.bytes);
  }

  const bundle: DraftBundle = {
    ...wire.bundle,
    id,
    // kind 以路径段为准盖章：新 bundle 从此必有 kind（absent 只剩历史磁盘 bundle）。
    kind: kind ?? wire.bundle.kind,
    // 重编码可能改变格式与体积，元数据跟着落盘后的实际字节走。
    assets: (wire.bundle.assets ?? []).map((meta) => {
      const w = written.get(sanitizeFileName(meta.fileName));
      return w ? { ...meta, mime: w.mime, bytesLen: w.bytesLen } : meta;
    }),
    status: 'pending',
  };
  await writeFile(join(dir, BUNDLE_FILE), JSON.stringify(bundle, null, 2), 'utf8');
  return id;
}

async function readBundleFrom(dir: string): Promise<DraftBundle | null> {
  try {
    const raw = await readFile(join(dir, BUNDLE_FILE), 'utf8');
    return JSON.parse(raw) as DraftBundle;
  } catch {
    return null;
  }
}

/** 草稿列表：outbox（pending/uploading/failed）+ sent（done），按创建时间倒序。
 *  已上传的草稿要留在列表里（消费方按 status 分栏展示），角标等按 status!=='done' 自行过滤。
 *  传 kind 时服务端过滤（legacy 无 kind 的 bundle 经 draftKind() 归入 'x-article'）。 */
export async function listDrafts(kind?: string): Promise<DraftListItem[]> {
  await ensureDirs();
  const items: DraftListItem[] = [];
  const seen = new Set<string>();
  // outbox 优先：万一 done 迁移 sent/ 时 rename 失败，两边同 id 以 outbox 为准。
  for (const sent of [false, true]) {
    let ids: string[];
    try {
      ids = await readdir(sent ? sentDir() : outboxDir());
    } catch {
      continue;
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      const b = await readBundleFrom(draftDir(id, sent));
      if (!b) continue;
      seen.add(id);
      if (kind && draftKind(b) !== kind) continue;
      items.push({
        id: b.id,
        kind: b.kind,
        title: b.title,
        source: b.source,
        createdAt: b.createdAt,
        mode: b.mode,
        status: b.status ?? 'pending',
        counts: b.styleReport?.counts,
        assetCount: b.assets?.length ?? 0,
      });
    }
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return items;
}

/** 读取单个草稿包（先 outbox 后 sent）。 */
export async function getDraft(id: string): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  return (await readBundleFrom(draftDir(safe))) ?? (await readBundleFrom(draftDir(safe, true)));
}

/** 资源文件的绝对路径（存在才返回）。先 outbox 后 sent。 */
export async function getAssetPath(id: string, fileName: string): Promise<string | null> {
  const safe = sanitizeId(id);
  const safeName = sanitizeFileName(fileName);
  for (const sent of [false, true]) {
    const p = join(draftDir(safe, sent), ASSETS_DIR, safeName);
    try {
      await stat(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** 设置/替换封面（PUT /drafts/:id/cover）。写字节并更新 bundle.cover；仅 outbox 里的草稿可改。
 *  body 带 original（用户新选图）时同时落盘原图并替换 bundle.coverOriginal；
 *  不带（基于原图重裁）时保留现有原图。 */
export async function setCover(
  id: string,
  cover: {
    fileName: string;
    mime: string;
    base64: string;
    original?: { fileName: string; mime: string; base64: string };
  },
): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  const dir = draftDir(safe);
  const b = await readBundleFrom(dir);
  if (!b) return null;
  // 加 cover- 前缀，避免与正文图片同名互踩（正文 assets 的 fileName 来自 markdown src）。
  const fileName = `cover-${sanitizeFileName(cover.fileName)}`;
  const { bytes, mime } = await fitImageBytes(base64ToBytes(cover.base64), cover.mime);
  await mkdir(join(dir, ASSETS_DIR), { recursive: true });
  await writeFile(join(dir, ASSETS_DIR, fileName), bytes);
  let coverOriginal = b.coverOriginal;
  if (cover.original) {
    const origFileName = `cover-original-${sanitizeFileName(cover.original.fileName)}`;
    const fit = await fitImageBytes(base64ToBytes(cover.original.base64), cover.original.mime);
    await writeFile(join(dir, ASSETS_DIR, origFileName), fit.bytes);
    coverOriginal = {
      key: 'cover-original',
      src: origFileName,
      fileName: origFileName,
      mime: fit.mime,
      bytesLen: fit.bytes.byteLength,
    };
  }
  // 不再被引用的旧封面/旧原图清掉，避免越攒越多。按「仍被引用集合」判断，防同名误删。
  const referenced = new Set([
    ...(b.assets ?? []).map((a) => a.fileName),
    fileName,
    ...(coverOriginal ? [coverOriginal.fileName] : []),
  ]);
  for (const old of [b.cover?.fileName, b.coverOriginal?.fileName]) {
    if (old && !referenced.has(old)) {
      await rm(join(dir, ASSETS_DIR, sanitizeFileName(old)), { force: true }).catch(() => {});
    }
  }
  const updated: DraftBundle = {
    ...b,
    cover: { key: 'cover', src: fileName, fileName, mime, bytesLen: bytes.byteLength },
    coverOriginal,
  };
  await writeFile(join(dir, BUNDLE_FILE), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

/** 更新草稿状态；status='done' 时移入 sent/。 */
export async function patchDraft(
  id: string,
  patch: { status: DraftStatus; restId?: string; error?: string },
): Promise<DraftBundle | null> {
  const safe = sanitizeId(id);
  const dir = draftDir(safe);
  const b = await readBundleFrom(dir);
  if (!b) return null;
  const updated: DraftBundle = {
    ...b,
    status: patch.status,
    restId: patch.restId ?? b.restId,
    error: patch.error ?? b.error,
  };
  await writeFile(join(dir, BUNDLE_FILE), JSON.stringify(updated, null, 2), 'utf8');
  if (patch.status === 'done') {
    const dest = draftDir(safe, true);
    await rm(dest, { recursive: true, force: true });
    await rename(dir, dest).catch(() => {});
  }
  return updated;
}

/** 删除草稿（outbox + sent 都删）。 */
export async function deleteDraft(id: string): Promise<boolean> {
  const safe = sanitizeId(id);
  let removed = false;
  for (const sent of [false, true]) {
    const dir = draftDir(safe, sent);
    try {
      await stat(dir);
      await rm(dir, { recursive: true, force: true });
      removed = true;
    } catch {
      /* not there */
    }
  }
  return removed;
}
