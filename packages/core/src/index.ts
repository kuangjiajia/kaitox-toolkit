/**
 * kaitox-x-publisher —— 把 Markdown 发成 X (Twitter) Article 草稿的实现。
 *
 * 三层结构，按需复用：
 *   - types.ts          数据模型（Draft.js content_state + X API）
 *   - contentState.ts   Markdown → content_state 转换（核心算法）
 *   - xArticleClient.ts HTTP + 鉴权 + 媒体上传 + 建草稿
 *   - publishArticle.ts 端到端编排
 *
 * 详见 docs/x-article-publish-protocol.md。
 */

export * from './types.js';
export {
  markdownToContentState,
  collectImageSources,
} from './contentState.js';
export {
  XArticleClient,
  sanitizeContentState,
  DEFAULT_BEARER_TOKEN,
  ARTICLE_DRAFT_CREATE_QUERY_ID,
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
  DEFAULT_ARTICLE_FEATURES,
  DEFAULT_COVER_MEDIA_FEATURES,
  DEFAULT_ARTICLE_FIELD_TOGGLES,
} from './xArticleClient.js';
export type { XArticleClientOptions, FetchLike } from './xArticleClient.js';
export {
  publishXArticle,
  deriveTitle,
} from './publishArticle.js';
export type {
  PublishArticleParams,
  PublishArticleResult,
  ImageFetcher,
  CoverFetcher,
} from './publishArticle.js';

// --- 草稿包 / relay 契约（上传端 + 插件 + relay 共用） ---
export type {
  DraftBundle,
  DraftAsset,
  DraftListItem,
  DraftMode,
  DraftSource,
  DraftStatus,
  StyleIssue,
  StyleReport,
} from './bundle.js';
export {
  HttpRelayClient,
  bytesToBase64,
  base64ToBytes,
} from './relayClient.js';
export type {
  RelayClient,
  PostDraftInput,
  DraftAssetInput,
  PostDraftWireBody,
  HttpRelayClientOptions,
} from './relayClient.js';

// --- 风格检查 + 纯文本兜底 ---
export {
  checkMarkdownStyle,
  toPlaintextMarkdown,
} from './styleCheck.js';
export type { AssetMeta, StyleCheckOptions } from './styleCheck.js';
