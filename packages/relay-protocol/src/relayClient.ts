/**
 * RelayClient —— 上传端 / 插件 与 relay 服务之间的 HTTP 契约与一个通用实现。
 *
 * 传输格式（v1，零依赖优先）：
 *   - POST /drafts 用「单个 JSON + base64 资源」的形态，relay 落盘时把 base64 解成
 *     二进制写进 assets/。这样 relay 不需要 multipart 解析器（纯 Node builtins）。
 *   - GET /drafts/:id/assets/:name 回二进制（插件当 Blob 收，走的是更频繁、更在意带宽的方向）。
 *
 * 云端 relay（v2）只要实现同一个 RelayClient 接口即可替换，上层无感。
 */

import type { DraftBundle, DraftListItem, DraftMode, DraftSource, DraftStatus, StyleReport } from './bundle.js';
import { bytesToBase64 } from './base64.js';

/** 待上传的一张图片（内存字节形态）。 */
export interface DraftAssetInput {
  /** 稳定 key，如 "img-0"（可等于 src）。 */
  key: string;
  /** Markdown 里原样 src。 */
  src: string;
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

/** 构建并投递一份草稿所需的输入。 */
export interface PostDraftInput {
  title: string;
  markdown: string;
  mode: DraftMode;
  source: DraftSource;
  sourceMeta?: Record<string, unknown>;
  styleReport?: StyleReport;
  assets: DraftAssetInput[];
  /** 可选封面图（不进正文；插件建草稿后单独上传设为封面）。 */
  cover?: DraftAssetInput;
}

/** relay 客户端接口。本地 relay 与云端 relay 共用。 */
export interface RelayClient {
  health(): Promise<{ ok: boolean; version: string; port?: number }>;
  postDraft(input: PostDraftInput): Promise<{ id: string }>;
  listDrafts(): Promise<DraftListItem[]>;
  getDraft(id: string): Promise<DraftBundle>;
  getAsset(id: string, fileName: string): Promise<Uint8Array>;
  ack(id: string, patch: { status: DraftStatus; restId?: string; error?: string }): Promise<void>;
  deleteDraft(id: string): Promise<void>;
}

/** POST /drafts 的线上 JSON 形态（relay 端解析这个）。 */
export interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}

export interface HttpRelayClientOptions {
  /** 注入 fetch（Node 18+/浏览器都有全局 fetch；测试可 mock）。默认取全局。 */
  fetchImpl?: typeof fetch;
  /** 可选 per-install token，作 x-kaitox-token 头。 */
  token?: string;
  /** 生成 id / 时间戳；默认 crypto.randomUUID + new Date()。可注入以便测试。 */
  makeId?: () => string;
  now?: () => string;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8765';

/** 基于 fetch 的 RelayClient 实现，Node 与浏览器通用。 */
export class HttpRelayClient implements RelayClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly makeId: () => string;
  private readonly now: () => string;

  constructor(baseUrl: string = DEFAULT_BASE_URL, opts: HttpRelayClientOptions = {}) {
    this.base = baseUrl.replace(/\/+$/, '');
    const f = opts.fetchImpl ?? (globalThis as any).fetch;
    if (!f) throw new Error('没有可用的 fetch，请通过 opts.fetchImpl 注入。');
    this.fetchImpl = f;
    this.token = opts.token;
    this.makeId = opts.makeId ?? (() => (globalThis as any).crypto.randomUUID());
    this.now = opts.now ?? (() => new Date().toISOString());
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h['x-kaitox-token'] = this.token;
    return h;
  }

  async health(): Promise<{ ok: boolean; version: string; port?: number }> {
    const res = await this.fetchImpl(`${this.base}/health`, { headers: this.headers() });
    if (!res.ok) throw new Error(`relay /health ${res.status}`);
    return res.json();
  }

  async postDraft(input: PostDraftInput): Promise<{ id: string }> {
    const id = this.makeId();
    const bundle: PostDraftWireBody['bundle'] = {
      schemaVersion: 1,
      id,
      title: input.title,
      markdown: input.markdown,
      mode: input.mode,
      assets: input.assets.map((a) => ({
        key: a.key,
        src: a.src,
        fileName: a.fileName,
        mime: a.mime,
        bytesLen: a.bytes.byteLength,
      })),
      cover: input.cover
        ? {
            key: input.cover.key,
            src: input.cover.src,
            fileName: input.cover.fileName,
            mime: input.cover.mime,
            bytesLen: input.cover.bytes.byteLength,
          }
        : undefined,
      styleReport: input.styleReport,
      createdAt: this.now(),
      source: input.source,
      sourceMeta: input.sourceMeta,
    };
    // 封面字节和正文图一起塞进 wire.assets（relay 按 fileName 落盘），插件再按 cover.fileName 取。
    const wireAssets = input.assets.map((a) => ({
      fileName: a.fileName,
      mime: a.mime,
      base64: bytesToBase64(a.bytes),
    }));
    if (input.cover) {
      wireAssets.push({
        fileName: input.cover.fileName,
        mime: input.cover.mime,
        base64: bytesToBase64(input.cover.bytes),
      });
    }
    const body: PostDraftWireBody = {
      bundle,
      assets: wireAssets,
    };
    const res = await this.fetchImpl(`${this.base}/drafts`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`relay POST /drafts ${res.status}: ${await safeText(res)}`);
    return res.json();
  }

  async listDrafts(): Promise<DraftListItem[]> {
    const res = await this.fetchImpl(`${this.base}/drafts`, { headers: this.headers() });
    if (!res.ok) throw new Error(`relay GET /drafts ${res.status}`);
    return res.json();
  }

  async getDraft(id: string): Promise<DraftBundle> {
    const res = await this.fetchImpl(`${this.base}/drafts/${encodeURIComponent(id)}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`relay GET /drafts/${id} ${res.status}`);
    return res.json();
  }

  async getAsset(id: string, fileName: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(
      `${this.base}/drafts/${encodeURIComponent(id)}/assets/${encodeURIComponent(fileName)}`,
      { headers: this.headers() },
    );
    if (!res.ok) throw new Error(`relay GET asset ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async ack(id: string, patch: { status: DraftStatus; restId?: string; error?: string }): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/drafts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`relay PATCH /drafts/${id} ${res.status}`);
  }

  async deleteDraft(id: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/drafts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`relay DELETE /drafts/${id} ${res.status}`);
  }
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
