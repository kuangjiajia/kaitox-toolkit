# @kaitox/x-article

Publish Markdown as **X (Twitter) Article drafts**: a Markdown → `content_state` converter, a client for X's private web API, end-to-end publish orchestration, and an X-friendliness style checker. Works in browsers (same-origin on x.com) and in Node (>= 18). ESM-only.

This is the engine behind the [Kaitox](https://kaitox.ai) publishing platform (CLI, local relay, Obsidian plugin, Chrome extension). It has no dependency on the rest of Kaitox — you can embed it in your own browser extension or server.

> **Unofficial.** This library drives the user's own logged-in x.com session against X's private GraphQL endpoints. See [Known limitations & compliance](#known-limitations--compliance) before shipping anything on top of it.

## Install

```bash
npm i @kaitox/x-article
```

Dependencies: [`marked`](https://www.npmjs.com/package/marked) (Markdown lexing) and [`@kaitox/relay-protocol`](https://www.npmjs.com/package/@kaitox/relay-protocol) (only for the `StyleIssue`/`StyleReport` types).

## How it works

X Articles are edited in a Draft.js-style editor. Under the hood a draft is a `content_state` — an array of `blocks` (paragraphs, headings, list items, quotes, atomic blocks) plus an `entity_map` (links, images, dividers, embedded Markdown). This package:

1. **Converts** Markdown into that `content_state` (`markdownToContentState`). Images become `MEDIA` entities that reference `media_id`s, so images must be uploaded *first*.
2. **Talks to X** (`XArticleClient`): chunked media upload (`INIT`/`APPEND`/`FINALIZE`), then a GraphQL `ArticleEntityDraftCreate` mutation, optionally followed by `ArticleEntityUpdateCoverMedia` for a cover image.
3. **Orchestrates** the whole pipeline (`publishXArticle`): collect image sources → upload each → convert → create draft → set cover.

The three layers are independently usable:

| Layer | Use it when |
|---|---|
| Converter only (`contentState`) | You have your own transport and just need Markdown → `content_state`. The most reusable piece. |
| Client (`XArticleClient`) | You build `content_state` yourself (or import it) and need upload + draft creation with correct auth headers. |
| Full orchestration (`publishXArticle`) | You have Markdown + a way to fetch image bytes and want a draft in one call. |

The full protocol (headers, request bodies, response shapes, mapping rules) is documented in [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md).

### Authentication

Every call rides the user's logged-in x.com session:

- `authorization`: the **public** web bearer token shared by every x.com web client (`DEFAULT_BEARER_TOKEN`, long-lived).
- `x-csrf-token`: the value of the `ct0` cookie.
- Cookies: the actual identity. Same-origin fetch on x.com sends them automatically with `credentials: 'include'`; server-side you must pass the full cookie header explicitly.

## Quick start A: inside a browser extension on x.com

Run in a content script (or page context) on `x.com`. Same-origin fetch carries the login cookies, so credentials boil down to reading `ct0` from `document.cookie` and leaving `bearerToken` empty (the built-in default is used). This mirrors what the Kaitox Chrome extension does:

```ts
import { publishXArticle, type ImageFetcher } from '@kaitox/x-article';

const ct0 = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
if (!ct0) throw new Error('Not logged in to x.com');

// You own image resolution: return bytes + MIME for each src
// found in the Markdown (local store, IndexedDB, your backend, ...).
const fetchImage: ImageFetcher = async (src) => {
  const bytes = await myAssetStore.get(src); // Uint8Array | Blob
  return { bytes, mimeType: 'image/png' };
};

const result = await publishXArticle({
  markdown: '# Hello\n\nFirst article via API.\n\n![diagram](assets/diagram.png)',
  credentials: { bearerToken: '', csrfToken: ct0 }, // '' → built-in public bearer
  clientOptions: {
    fetchImpl: window.fetch.bind(window),
    credentialsMode: 'include', // same-origin: cookies ride along automatically
    // X rotates GraphQL queryIds occasionally — make them configurable:
    // articleDraftCreateQueryId: '...',
    // updateCoverMediaQueryId: '...',
  },
  fetchImage,
});

console.log(result.restId); // draft id → https://x.com/compose/articles/edit/<restId>
```

To also set a cover image, pass `fetchCover: async () => ({ bytes, mimeType })` — it is called only after the draft exists and its `restId` is known.

## Quick start B: server-side Node

Node has no logged-in session, so you must export credentials from a browser where you are logged in to x.com (DevTools → Application → Cookies → `https://x.com`): the `ct0` value and the **full cookie header string** (the `auth_token` cookie is HttpOnly, so copy it from the panel, not from `document.cookie`).

```ts
import { publishXArticle } from '@kaitox/x-article';

const result = await publishXArticle({
  markdown: myMarkdown,
  credentials: {
    bearerToken: '',                    // '' → built-in public bearer
    csrfToken: process.env.X_CT0!,      // the ct0 cookie value
    cookie: process.env.X_COOKIE!,      // full cookie string incl. auth_token
  },
  clientOptions: {
    credentialsMode: 'omit',            // don't rely on ambient cookies; send the header explicitly
  },
});
```

A runnable version lives at [`examples/publish.ts`](examples/publish.ts).

> **Fragile — expect breakage.** Server-side calls are exactly the setup X's anti-automation measures target. X validates an `x-client-transaction-id` header on many GraphQL calls; it is computed by obfuscated code in the x.com frontend, and this package does **not** generate it (you can supply one via `credentials.clientTransactionId`). Same-origin page-context calls can omit it; server-side calls may be rejected without it. Sessions expire, queryIds rotate, and cookie strings leak easily — prefer the browser path (Quick start A) for anything durable, and never commit credentials.

## API reference

| Export | One-liner |
|---|---|
| `markdownToContentState(markdown, mediaIdBySrc?)` | Convert Markdown to `{ contentState, skippedImages, title? }`; `mediaIdBySrc` maps image src → uploaded `media_id` (Record or Map); the first `#` heading becomes `title` and is excluded from the body. |
| `collectImageSources(markdown)` | All image srcs in document order, deduplicated — upload these first to build `mediaIdBySrc`. |
| `XArticleClient` | HTTP client: `uploadMedia(bytes, mimeType, category?)` → `media_id_string`; `createArticleDraft(title, contentState)` → `{ restId?, raw }`; `updateCoverMedia(articleEntityId, mediaId)` → `{ raw }`. |
| `publishXArticle(params)` | End-to-end: collect images → upload (concurrency 3 by default) → convert → create draft → optional cover; returns `PublishArticleResult`. |
| `deriveTitle(markdown)` | First H1's text, falling back to the first heading of any level, then `''`. |
| `sanitizeContentState(cs)` | Whitelist-rebuild a `content_state` so X accepts it: strips unknown fields, drops invalid inline styles, downgrades unsupported block types (`header-three` → `header-two`, `code-block` → `unstyled`). Applied automatically by `createArticleDraft`. |
| `checkMarkdownStyle(markdown, opts?)` | Lint Markdown for X-friendliness; returns a `StyleReport`. See [Style checker](#style-checker). |
| `toPlaintextMarkdown(markdown)` | Degrade unfriendly constructs (tables, code/HTML blocks, nested lists) into plain Markdown that converts cleanly. |
| `DEFAULT_BEARER_TOKEN` | The public web bearer token shared by all x.com web clients. |
| `ARTICLE_DRAFT_CREATE_QUERY_ID` | Default GraphQL queryId for `ArticleEntityDraftCreate` (X rotates these — override when stale). |
| `ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID` | Default GraphQL queryId for `ArticleEntityUpdateCoverMedia`. |
| `DEFAULT_ARTICLE_FEATURES` / `DEFAULT_COVER_MEDIA_FEATURES` | Feature-flag objects the two mutations require (note: they differ — don't mix them). |
| `DEFAULT_ARTICLE_FIELD_TOGGLES` | `fieldToggles` for draft creation (the cover mutation takes none). |

Exported types: `ContentState`, `ContentBlock`, `BlockType`, `EntityMapEntry`, `EntityValue`, `EntityRange`, `InlineStyleRange`, `XCredentials`, `XArticleClientOptions`, `FetchLike`, `PublishArticleParams`, `PublishArticleResult`, `ImageFetcher`, `CoverFetcher`, `AssetMeta`, `StyleCheckOptions`, `UploadMediaCategory`, and the request/response body types (see `src/types.ts`).

### Conversion rules (summary)

| Markdown | `content_state` |
|---|---|
| Paragraph | `unstyled` block |
| `#` (first one) | Article title (`title` field, not in body) |
| `##` / `###`+ | `header-one` / `header-two` (X only has two heading levels in the body) |
| `> quote` | `blockquote` block per paragraph |
| `-` / `1.` items | `unordered-list-item` / `ordered-list-item` per item |
| `**b**` `*i*` `~~s~~` | `inline_style_ranges` (`Bold` / `Italic` / `Strikethrough` — the only styles X accepts) |
| `` `inline code` `` | Plain text (X has no inline code style) |
| `[text](url)` | `LINK` entity |
| `![alt](src)` | `atomic` block + `MEDIA` entity (needs an uploaded `media_id`) |
| Fenced code, tables | `atomic` block + `MARKDOWN` entity (rendered as a plaintext code box) |
| `---` | `atomic` block + `DIVIDER` entity |

Full rules, entity-key conventions, and UTF-16 offset semantics: [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md).

## Style checker

`checkMarkdownStyle` flags only constructs the converter would actually render badly or drop — no false alarms for things that convert fine. It returns `{ friendly, issues, counts }` where `friendly` is `true` iff there are no errors and no warnings.

| Rule | Severity | Why |
|---|---|---|
| `table` | warning | No native tables on X; degrades to a code box showing raw pipes. |
| `nested-list` | warning | Nested list items are silently dropped (only one level survives). |
| `html-block` | warning | HTML blocks are discarded entirely — content loss. |
| `code-block` | info | Rendered as a plaintext code box (no highlighting); usually acceptable. |
| `heading-depth` | info | `h4`+ is clamped to SubHeading (same as `###`). |
| `extra-h1` | info | Only the first H1 becomes the title; later H1s render as Headings. |
| `footnote` | warning | `[^n]` isn't parsed; shows up as literal text. |
| `task-list` | info | Checkboxes are lost; items render as a plain list. |
| `image-remote` | warning | Remote images aren't auto-downloaded; your uploader must fetch them itself. |
| `image-missing` | error | No bytes available for the src — image will be skipped on upload. |
| `image-too-large` | warning | Over the size limit (default 5 MB); X may reject the upload. |
| `empty-doc` | error | X requires a non-empty body. |

Pass `StyleCheckOptions.assetMap` (`src → { bytesLen, mime, resolved }`) so the image rules can distinguish missing/remote/oversized, and `maxImageBytes` to change the size limit.

When the user won't fix the flagged constructs, `toPlaintextMarkdown(markdown)` is the fallback: tables become paragraphs of cell text, code/HTML blocks lose their fences/tags, nested lists are flattened — everything else (headings, emphasis, links, images) is preserved verbatim. The output is still Markdown; feed it to `markdownToContentState` as usual.

## Using with the kaitox relay

In the Kaitox platform this package runs inside the Chrome extension; upload clients (CLI, Obsidian, your own service) don't call X directly. Instead they POST a draft bundle — raw Markdown plus image bytes — to a local relay, and the extension picks it up on `x.com/compose/articles` and publishes with the page's own session. The bundle deliberately carries raw Markdown rather than a prebuilt `content_state`, because image `media_id`s only exist after upload from the logged-in page.

- Wire types and HTTP client for the relay: [`@kaitox/relay-protocol`](https://www.npmjs.com/package/@kaitox/relay-protocol)
- Building your own extension or upload client against the relay: [`docs/integrate-browser-extension.md`](../../docs/integrate-browser-extension.md)

## Known limitations & compliance

- **Draft creation only.** Publishing the draft (the final "publish" mutation) is not covered; the user finishes in the X editor.
- **`queryId` rotation.** X rotates GraphQL queryIds without notice. Both are overridable via `XArticleClientOptions`; when they go stale, extract fresh ones from the x.com frontend bundle.
- **`x-client-transaction-id`.** Not generated by this package. Fine same-origin; may be required for server-side/cross-origin calls.
- **`restId` extraction is best-effort.** It targets the observed response shape with fallbacks; verify against live responses.
- **Media constraints.** Upload with `media_category=tweet_image`, but reference `DraftTweetImage` in the body's `MEDIA` entities — two different strings. `media_id` is a string (`media_id_string`), never the numeric form.
- **Compliance.** These are X's private, undocumented web endpoints. This library acts as the user, on the user's own account, with the user's own session — it is unofficial, can break at any time, and is subject to X's automation policies and rate limits. Don't run it at high frequency, don't mass-automate across accounts, and use it at your own risk.

## License

[MIT](LICENSE) © kaitox
