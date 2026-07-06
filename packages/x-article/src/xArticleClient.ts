/**
 * X Article HTTP 客户端。
 *
 * 封装两件事：
 *   1. 媒体分片上传：INIT → APPEND → FINALIZE，拿到 media_id_string。
 *   2. 创建文章草稿：POST 到 GraphQL 的 ArticleEntityDraftCreate。
 *
 * 鉴权本质：带着你在浏览器里登录 x.com 的会话（cookie + ct0 + 公开 bearer）替你调私有接口。
 * 所以它要么跑在 x.com 页面上下文里（扩展 content script，同源 fetch 自带 cookie），
 * 要么跑在服务端但你得把 cookie 和 ct0 显式传进来。
 */

import type {
  ContentState,
  XCredentials,
  ArticleFeatures,
  ArticleFieldToggles,
  ArticleDraftCreateBody,
  ArticleUpdateCoverMediaBody,
  MediaUploadInitResponse,
  UploadMediaCategory,
} from './types';

/** 所有 x.com 网页端共用的公开 bearer token（长期不变）。 */
export const DEFAULT_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** ArticleEntityDraftCreate 的 GraphQL queryId。X 会不定期轮换，需要时覆盖。 */
export const ARTICLE_DRAFT_CREATE_QUERY_ID = 'g1l5N8BxGewYuCy5USe_bQ';

/** ArticleEntityUpdateCoverMedia 的 GraphQL queryId（设置封面）。同样会轮换。 */
export const ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID = 'AbzX20PDk6TTzqmN67hiPQ';

const UPLOAD_URL = 'https://upload.x.com/i/media/upload.json';
const GRAPHQL_BASE = 'https://x.com/i/api/graphql';

/** ArticleEntityDraftCreate 请求所需的 features，原样保留。 */
export const DEFAULT_ARTICLE_FEATURES: ArticleFeatures = {
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

/**
 * ArticleEntityUpdateCoverMedia 请求所需的 features（原样保留）。
 * 注意有三个 flag 与 DEFAULT_ARTICLE_FEATURES 取值相反，别混用。
 */
export const DEFAULT_COVER_MEDIA_FEATURES: ArticleFeatures = {
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

export const DEFAULT_ARTICLE_FIELD_TOGGLES: ArticleFieldToggles = {
  withPayments: false,
  withAuxiliaryUserLabels: false,
};

/** 单个 APPEND 分片上限。X 官方约 5MB，这里留点余量。 */
const APPEND_CHUNK_SIZE = 4 * 1024 * 1024;

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    credentials?: 'include' | 'omit' | 'same-origin';
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
}>;

export interface XArticleClientOptions {
  /** 注入 fetch（Node 用全局 fetch，浏览器用原生；测试可 mock）。默认取全局 fetch。 */
  fetchImpl?: FetchLike;
  /**
   * 是否发送 cookie。浏览器同源页面里用 'include'（默认）自动带上登录 cookie；
   * 服务端调用时应传 'omit' 并在 credentials.cookie 里显式给出 cookie 串。
   */
  credentialsMode?: 'include' | 'omit' | 'same-origin';
  /** 覆盖 ArticleEntityDraftCreate 的 queryId。 */
  articleDraftCreateQueryId?: string;
  /** 覆盖 ArticleEntityUpdateCoverMedia 的 queryId。 */
  updateCoverMediaQueryId?: string;
  features?: ArticleFeatures;
  fieldToggles?: ArticleFieldToggles;
  /** 覆盖设置封面时用的 features（默认 DEFAULT_COVER_MEDIA_FEATURES）。 */
  coverFeatures?: ArticleFeatures;
}

export class XArticleClient {
  private readonly fetchImpl: FetchLike;
  private readonly credentialsMode: 'include' | 'omit' | 'same-origin';
  private readonly queryId: string;
  private readonly coverQueryId: string;
  private readonly features: ArticleFeatures;
  private readonly fieldToggles: ArticleFieldToggles;
  private readonly coverFeatures: ArticleFeatures;

  constructor(
    private readonly credentials: XCredentials,
    options: XArticleClientOptions = {},
  ) {
    const globalFetch = (globalThis as any).fetch as FetchLike | undefined;
    const impl = options.fetchImpl ?? globalFetch;
    if (!impl) throw new Error('没有可用的 fetch，请通过 options.fetchImpl 注入。');
    this.fetchImpl = impl;
    this.credentialsMode = options.credentialsMode ?? 'include';
    this.queryId = options.articleDraftCreateQueryId ?? ARTICLE_DRAFT_CREATE_QUERY_ID;
    this.coverQueryId = options.updateCoverMediaQueryId ?? ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID;
    this.features = options.features ?? DEFAULT_ARTICLE_FEATURES;
    this.fieldToggles = options.fieldToggles ?? DEFAULT_ARTICLE_FIELD_TOGGLES;
    this.coverFeatures = options.coverFeatures ?? DEFAULT_COVER_MEDIA_FEATURES;
  }

  // --- 鉴权头 ---------------------------------------------------------------

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      authorization: `Bearer ${this.credentials.bearerToken || DEFAULT_BEARER_TOKEN}`,
      'x-csrf-token': this.credentials.csrfToken,
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': this.credentials.clientLanguage ?? 'en',
      ...extra,
    };
    if (this.credentials.cookie) h['cookie'] = this.credentials.cookie;
    if (this.credentials.clientTransactionId) h['x-client-transaction-id'] = this.credentials.clientTransactionId;
    return h;
  }

  // --- 媒体上传：INIT / APPEND / FINALIZE -----------------------------------

  /**
   * 分片上传一张图片，返回 media_id_string。
   * @param bytes    图片二进制
   * @param mimeType 如 image/webp、image/png、image/jpeg、image/gif
   * @param category 上传分类，图片用 tweet_image（注意与正文里的 DraftTweetImage 不同）
   */
  async uploadMedia(
    bytes: Uint8Array | Blob,
    mimeType: string,
    category: UploadMediaCategory = 'tweet_image',
  ): Promise<string> {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mimeType });
    const totalBytes = blob.size;

    // 1) INIT
    const initUrl =
      `${UPLOAD_URL}?command=INIT&total_bytes=${totalBytes}` +
      `&media_type=${encodeURIComponent(mimeType)}&media_category=${category}`;
    const init = (await this.postJson(initUrl, null)) as MediaUploadInitResponse;
    const mediaId = init.media_id_string;
    if (!mediaId) throw new Error(`INIT 未返回 media_id_string：${JSON.stringify(init)}`);

    // 2) APPEND（按 4MB 分片；图片通常一片搞定）
    let segmentIndex = 0;
    for (let offset = 0; offset < totalBytes; offset += APPEND_CHUNK_SIZE) {
      const chunk = blob.slice(offset, Math.min(offset + APPEND_CHUNK_SIZE, totalBytes));
      const form = new FormData();
      form.append('media', chunk);
      const appendUrl = `${UPLOAD_URL}?command=APPEND&media_id=${mediaId}&segment_index=${segmentIndex}`;
      // 注意：不要手动设 content-type，让 fetch 自己带 multipart boundary。
      await this.postForm(appendUrl, form);
      segmentIndex++;
    }

    // 3) FINALIZE
    const finalizeUrl = `${UPLOAD_URL}?command=FINALIZE&media_id=${mediaId}`;
    const finalize = await this.postJson(finalizeUrl, null);
    // 视频/GIF 会返回 processing_info 需要轮询 STATUS；图片一般即时完成。
    if (finalize?.processing_info?.state && finalize.processing_info.state !== 'succeeded') {
      await this.waitForProcessing(mediaId);
    }
    return mediaId;
  }

  /** 媒体处理异步完成时轮询 STATUS（图片一般用不到，留给视频/GIF）。 */
  private async waitForProcessing(mediaId: string, maxWaitMs = 60_000): Promise<void> {
    const start = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const statusUrl = `${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`;
      const res = await this.fetchImpl(statusUrl, {
        method: 'GET',
        headers: this.authHeaders(),
        credentials: this.credentialsMode,
      });
      const body = await res.json();
      const info = body?.processing_info;
      if (!info || info.state === 'succeeded') return;
      if (info.state === 'failed') throw new Error(`媒体处理失败：${JSON.stringify(info)}`);
      if (Date.now() - start > maxWaitMs) throw new Error('媒体处理超时。');
      await sleep((info.check_after_secs ?? 1) * 1000);
    }
  }

  // --- 创建文章草稿 ---------------------------------------------------------

  /**
   * 创建 X Article 草稿。返回解析后的响应，并尽力抽出草稿的 rest_id。
   * 注意：这一步只是「创建草稿」，正式发布是后续 publish 动作（见文档）。
   */
  async createArticleDraft(
    title: string,
    contentState: ContentState,
  ): Promise<{ restId?: string; raw: any }> {
    const body: ArticleDraftCreateBody = {
      variables: { content_state: sanitizeContentState(contentState), title },
      features: this.features,
      fieldToggles: this.fieldToggles,
      queryId: this.queryId,
    };
    const url = `${GRAPHQL_BASE}/${this.queryId}/ArticleEntityDraftCreate`;
    const raw = await this.postJson(url, JSON.stringify(body), { 'content-type': 'application/json' });
    return { restId: extractRestId(raw), raw };
  }

  /**
   * 给已存在的文章草稿设置封面/头图。
   * 前置：mediaId 必须先经 uploadMedia(..., 'tweet_image') 上传得到；articleEntityId 是
   * createArticleDraft 返回的 restId。这是**建草稿之后**的独立一步。
   */
  async updateCoverMedia(articleEntityId: string, mediaId: string): Promise<{ raw: any }> {
    const body: ArticleUpdateCoverMediaBody = {
      variables: {
        articleEntityId,
        coverMedia: { media_id: mediaId, media_category: 'DraftTweetImage' },
      },
      features: this.coverFeatures,
      queryId: this.coverQueryId,
      // 注意：此 mutation 不接受 fieldToggles，别加。
    };
    const url = `${GRAPHQL_BASE}/${this.coverQueryId}/ArticleEntityUpdateCoverMedia`;
    const raw = await this.postJson(url, JSON.stringify(body), { 'content-type': 'application/json' });
    return { raw };
  }

  // --- 底层请求 -------------------------------------------------------------

  private async postJson(
    url: string,
    body: string | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<any> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.authHeaders(extraHeaders),
      body,
      credentials: this.credentialsMode,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`请求失败 ${res.status} ${url}\n${text}`);
    return text ? JSON.parse(text) : {};
  }

  private async postForm(url: string, form: FormData): Promise<any> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.authHeaders(), // 不含 content-type，交给 fetch
      body: form as unknown as BodyInit,
      credentials: this.credentialsMode,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`APPEND 失败 ${res.status} ${url}\n${text}`);
    return text ? JSON.parse(text) : {};
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * X 实测接受的 inline style 枚举全集（2026-07 探针验证）。
 * `Code` / `CODE` / `InlineCode` / `Underline` 都会 GRAPHQL_VALIDATION_FAILED。
 */
const VALID_INLINE_STYLES = new Set(['Bold', 'Italic', 'Strikethrough']);

/**
 * 后端不支持、但能过 GraphQL 校验的 block 类型 → 安全降级映射（2026-07 探针验证）。
 * 这两个类型会让整单 OperationalError: Internal: Unspecified。
 */
const BLOCK_TYPE_FALLBACK: Record<string, string> = {
  'header-three': 'header-two',
  'code-block': 'unstyled',
};

/**
 * 发送前按白名单重建 content_state。
 *
 * X 的 ArticleEntityDraftCreate input 是强类型的，出现任何未知字段或非法枚举值
 * 都会整单被拒（GRAPHQL_VALIDATION_FAILED），实测踩过的坑：
 *   - block 上带 Draft.js 原生的 `depth` → path: blocks[i].depth
 *   - style 用了枚举外的值（如 `Code`）→ path: blocks[i].inline_style_ranges[j].style
 * 另有一类能过校验但后端建草稿时报 OperationalError 的值（header-three / code-block）。
 * 这里兜底剥掉未知字段、过滤非法样式、降级不支持的 block 类型，保证进 X 的永远是合法结构。
 */
export function sanitizeContentState(cs: ContentState): ContentState {
  return {
    blocks: cs.blocks.map((b) => ({
      key: b.key,
      text: b.text,
      type: (BLOCK_TYPE_FALLBACK[b.type] ?? b.type) as typeof b.type,
      data: b.data ?? {},
      entity_ranges: (b.entity_ranges ?? []).map((r) => ({
        key: r.key,
        offset: r.offset,
        length: r.length,
      })),
      inline_style_ranges: (b.inline_style_ranges ?? [])
        .filter((r) => VALID_INLINE_STYLES.has(r.style))
        .map((r) => ({ offset: r.offset, length: r.length, style: r.style })),
    })),
    entity_map: cs.entity_map.map((e) => ({ key: e.key, value: e.value })),
  };
}

/**
 * 从 GraphQL 响应里找出「草稿」的 rest_id。
 *
 * 实测响应结构（2026-07）：
 *   data.articleentity_create_draft.article_entity_results.result
 *     ├─ rest_id: "2073680457065992192"        ← 草稿 id（要的是这个）
 *     ├─ id: base64("ArticleEntity:<rest_id>")
 *     └─ metadata.author_results.result.rest_id ← 作者的用户 id（别拿错！）
 * 响应里作者 User 对象也有 rest_id，所以不能盲目深度搜第一个 rest_id——
 * 深搜顺序不稳定时会把用户 id 当草稿 id，跳转编辑页就会 404。
 */
function extractRestId(raw: any): string | undefined {
  try {
    const result = raw?.data?.articleentity_create_draft?.article_entity_results?.result;
    if (typeof result?.rest_id === 'string') return result.rest_id;
    // 兜底 1：base64 的 id 形如 "ArticleEntity:<rest_id>"。
    if (typeof result?.id === 'string' && typeof atob === 'function') {
      const decoded = atob(result.id);
      const m = /^ArticleEntity:(\d+)$/.exec(decoded);
      if (m) return m[1];
    }
    // 兜底 2：结构变动时深度搜 rest_id，但跳过 User 对象（作者信息）。
    const stack = [raw?.data];
    while (stack.length) {
      const node = stack.pop();
      if (node && typeof node === 'object') {
        if (node.__typename === 'User') continue;
        if (typeof node.rest_id === 'string') return node.rest_id;
        for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
