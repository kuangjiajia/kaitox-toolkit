/**
 * @kaitox/x-article — publish Markdown as X (Twitter) Article drafts.
 *
 * Layered so you can reuse exactly what you need:
 *   - types.ts          data model (Draft.js content_state + X API)
 *   - contentState.ts   Markdown → content_state conversion (the core algorithm)
 *   - xArticleClient.ts HTTP + auth + media upload + draft creation
 *   - publishArticle.ts end-to-end orchestration
 *   - styleCheck.ts     X-friendliness linter + plaintext fallback
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
