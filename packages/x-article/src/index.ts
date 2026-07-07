/**
 * @kaitox/x-article — publish Markdown as X (Twitter) Article drafts.
 *
 * Layered so you can reuse exactly what you need:
 *   - types.ts          data model (Draft.js content_state + X API)
 *   - contentState.ts   Markdown → content_state conversion (the core algorithm)
 *   - xArticleClient.ts HTTP + auth + media upload + draft creation
 *   - publishArticle.ts end-to-end orchestration
 *   - styleCheck.ts     X-friendliness linter + plaintext fallback
 *   - previewModel.ts   content_state → render-ready model (framework-free)
 *   - previewHtml.ts    render-ready model → HTML string (pair with ./preview.css)
 *
 * See docs/x-article-publish-protocol.md for the protocol reference.
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

// --- style check + plaintext fallback ---
export {
  checkMarkdownStyle,
  toPlaintextMarkdown,
} from './styleCheck.js';
export type { AssetMeta, StyleCheckOptions } from './styleCheck.js';

// --- mermaid 围栏 → 图片引用变换（渲染由消费方在浏览器里完成）---
export {
  extractMermaidBlocks,
  MERMAID_SRC_PREFIX,
} from './mermaid.js';
export type { MermaidBlock, ExtractMermaidResult } from './mermaid.js';

// --- preview（框架无关的渲染层，样式见包根 preview.css）---
export {
  buildPreviewModel,
  segmentText,
  groupBlocks,
} from './previewModel.js';
export type { PreviewModel, Segment, BlockGroup } from './previewModel.js';
export {
  renderPreviewHtml,
  renderModelHtml,
} from './previewHtml.js';
export type { RenderPreviewOptions } from './previewHtml.js';
