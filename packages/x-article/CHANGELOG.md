# @kaitox/x-article

## 0.6.0

### Minor Changes

- Publish the shared mermaid rendering module (`MERMAID_INIT_CONFIG`, `renderMermaidSvg`, `renderMermaidSvgUrl`, `renderMermaidPng`, and the `MermaidRenderer` type). These were added for the Chrome extension and Obsidian plugin to render diagrams pixel-identically to the published article, but were never released — so consumers building against npm couldn't resolve them. This makes the Obsidian plugin's distribution repo buildable from published packages.

## 0.5.1

### Patch Changes

- Kind-namespaced relay storage: draft bundles now live under `~/.kaitox/<kind>/{outbox,sent}` (e.g. `~/.kaitox/x-article/outbox`) instead of a shared `~/.kaitox/{outbox,sent}`. Storage APIs take an explicit `kind` and cross-namespace isolation comes from the directory layout itself. Docs and READMEs refreshed across all packages (extension screenshots, install flow, skill rename to `kaitox-x-article`).
- Updated dependencies
  - @kaitox/relay-protocol@0.5.1

## 0.5.0

### Minor Changes

- 4043dc2: `checkMarkdownStyle` no longer reports `image-too-large` for oversized PNG/JPEG/WebP — the relay compresses those transparently at ingest, so the warning was a false alarm that blocked `kaitox x push` with a prompt. The rule now fires only for formats the relay passes through untouched (GIF, SVG, …), with the message and suggestion updated accordingly.
- `publishXArticle` gains an optional `onProgress` callback (new exported type `PublishProgress`).

  The orchestrator now reports pipeline progress for UI display: `{stage:'images', done, total}` once up front and after each body image completes (success or skip), then `{stage:'draft'}` before the draft-create mutation and `{stage:'cover'}` before cover upload. Purely additive; callback errors are swallowed and never affect the upload. The browser extension uses it to show live progress ("正在上传图片 2/5…", "正在创建草稿…", "正在设置封面…") in the draft detail panel while uploading.

- Shared push-side helpers and compile-time exhaustiveness for the content model.

  - New `pushHelpers` module (exported from the package root): `parseFrontmatter`, `safeFileName`, `guessMimeFromName`, `baseName`, and `makeCoverAsset` — the single producer of the `'__cover__'` sentinel + `cover-` file-name convention. The CLI's `bundleBuilder` and the Obsidian plugin now share these instead of maintaining diverged copies; as a side effect, `kaitox x push` now honors a frontmatter `cover:` field when `--cover` is not given (previously Obsidian-only).
  - Content-model exhaustiveness: new `BLOCK_TYPES` / `INLINE_STYLES` / `ENTITY_TYPES` coverage maps and an `assertNever` helper; the preview renderer's silent `default: return ''` branches are gone — adding a union member now fails compilation (and a new truth test) until every consumer site is updated, instead of silently dropping content. `sanitizeContentState`'s inline-style whitelist is derived from the coverage map so it can no longer drift.

### Patch Changes

- 4043dc2: Update `marked` from ^12.0.2 to ^18.0.5. No behavior change observed — the full conversion/preview/style-check test suite passes unchanged.
- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.5.0

## 0.4.0

### Minor Changes

- Fix tables (and code fences) being dropped by X's renderer: MARKDOWN entities are now `Mutable` with newline-wrapped content, matching X's own editor payload (captured 2026-07) — `Immutable` passed GraphQL validation but the rendered article silently lost the content. X natively renders table markdown as real tables, so `checkMarkdownStyle` downgrades the `table` rule from warning to info, the preview renderer shows tables as native `<table>` markup (new `xp-table` styles in `preview.css`, with inline markdown rendered inside cells), and `toPlaintextMarkdown` no longer flattens tables or strips code fences — it only degrades what the converter actually loses (HTML blocks, nested lists).
- Add `extractMermaidBlocks(markdown)`: replaces top-level ```mermaid fences with `![...](mermaid://diagram-N)`image references so uploaders can render diagrams to images and push them through the normal media pipeline (X has no native mermaid support). The Chrome extension now does this by default — mermaid.js (lazily loaded as a separate`mermaid-lib.js`bundle) renders each block to SVG, rasterizes to PNG for upload, and the preview modal shows the same diagrams.`checkMarkdownStyle`reports mermaid fences under a new`mermaid-block`info rule instead of`code-block`.
- Add a framework-free preview layer that renders the exact publish output: `buildPreviewModel()` / `segmentText()` / `groupBlocks()` (pure render model over `markdownToContentState`) and `renderPreviewHtml()` / `renderModelHtml()` (escaped HTML string, styled by the new `@kaitox/x-article/preview.css` export with `--xp-*` CSS-variable theming). Because the preview consumes the same content_state the publisher sends, every degradation (inline code → plain text, nested lists dropped, tables/code fences as raw markdown, unpackaged images skipped) previews exactly as it will publish. Cover images render at X's actual 5:2 aspect ratio. The Chrome extension's draft box gains a 预览 button that opens this preview in a reader-style modal (with a warning bar summarizing `styleReport` issues) and a 5:2 cover cropper applied before cover upload.

### Patch Changes

- Reposition Kaitox as a personal toolkit: the CLI, Obsidian plugin, Chrome extension, and agent skills are each one product of the toolkit, and X (Twitter) Article publishing is the first feature that cuts across them. READMEs, package descriptions, manifests, CLI help text, and architecture docs are reworded accordingly. The agent skill moved from `packages/cli/skills/` to the repo-root `skills/` directory (it no longer ships inside the `@kaitox/cli` npm tarball). Every README now ships in both English and Chinese (`README.md` + `README.zh-CN.md`), and the two apps gained READMEs of their own.
- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.4.0
