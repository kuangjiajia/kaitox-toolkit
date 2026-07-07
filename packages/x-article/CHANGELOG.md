# @kaitox/x-article

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
