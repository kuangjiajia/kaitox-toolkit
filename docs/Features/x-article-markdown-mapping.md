English | [简体中文](x-article-markdown-mapping.zh-CN.md)

# Markdown → X Article: format support

What survives the trip when Kaitox turns your Markdown into an X (Twitter) Article. This is the reference for _"will this element make it across?"_

An X Article is **not** Markdown — the editor stores a Draft.js document (blocks + entities), not text. The converter maps each Markdown construct to the nearest X primitive: most map cleanly, a few degrade, a handful are dropped. Everything below is produced by [`markdownToContentState`](../../packages/x-article/README.md) in `@kaitox/x-article` and mirrored by its style checker — the same engine every surface (agent skill, CLI, Obsidian, extension) runs, so the result is identical no matter how you push.

## Legend

| | Meaning |
|---|---|
| ✅ **Supported** | Maps cleanly, nothing lost. |
| 🟡 **Degraded** | Uploads, but some fidelity is lost (see Notes). The style checker flags these `info` / `warning`. |
| ❌ **Dropped** | Content is lost or shown broken. The style checker flags these `warning` / `error`. |

## Block elements

| Markdown | Becomes in X | | Notes |
|---|---|---|---|
| Paragraph | Paragraph | ✅ | |
| First `# H1` | **Article title** | ✅ | Consumed as the title — never shown in the body. Setext (`===`) H1 works too. |
| 2nd+ `# H1` | Heading | 🟡 | Only the first H1 is the title; any extra H1 renders as `##`. Keep one per article. |
| `## H2` | Heading | ✅ | |
| `### H3` | SubHeading | ✅ | |
| `#### H4` and deeper | SubHeading | 🟡 | Clamped — the X body has only two heading levels. |
| `> Blockquote` | Blockquote | ✅ | One block per paragraph inside the quote. |
| `- ` / `* ` bullet list | Bulleted list | ✅ | One block per item. |
| `1. ` numbered list | Numbered list | ✅ | One block per item. |
| Nested list item | _(flattened away)_ | 🟡 | Sub-items are **silently dropped**. Flatten to one level. |
| `- [ ]` task list | Bulleted list | 🟡 | The checkbox is lost; text stays. |
| ` ``` ` fenced code | Code box | ✅ | Plain text — no syntax highlighting. |
| ` ```mermaid ` fenced | Diagram **image** | ✅ | Rendered to a PNG at upload time (needs the browser extension). A mermaid syntax error fails the upload — confirm the diagram draws first. |
| Table | Table | ✅ | Rendered natively by X. |
| `---` horizontal rule | Divider | ✅ | |
| `![alt](src)` | Image | ✅ | Needs the image bytes → uploaded for a `media_id`. A missing / unresolved `src` is skipped (rest of the article still uploads). |
| An x.com/twitter status URL **alone on its line** | Embedded quote tweet | ✅ | Only when the link occupies its own line. The same URL mid-sentence stays a plain link. |
| Raw HTML block (`<div>…`) | _(dropped)_ | ❌ | The whole block is discarded. Rewrite it as Markdown. |

## Inline / text formatting

| Markdown | Becomes in X | | Notes |
|---|---|---|---|
| `**bold**` | **Bold** | ✅ | |
| `*italic*` / `_italic_` | _Italic_ | ✅ | |
| `~~strikethrough~~` | ~~Strikethrough~~ | ✅ | |
| `[text](url)` | Link | ✅ | |
| `[text][ref]` + definition | Link | ✅ | Reference-style links resolve. |
| Bare URL `https://…` | Link | ✅ | Auto-linked (GFM). |
| `` `inline code` `` | Plain text | 🟡 | X Article has no inline-code style — the text stays, the monospace styling is dropped. |
| Hard line break | Line break | ✅ | Two trailing spaces, a trailing `\`, or `<br>` → newline **within** the block. |
| Inline `<b>…</b>` HTML | Literal text | ❌ | Tags are shown verbatim, not rendered. |
| Footnote `[^1]` | Broken text | ❌ | Not parsed as a footnote — the marker leaks into the text. Inline the note or use a plain link. |
| Inline image mid-paragraph | Splits the paragraph | ✅ | The image becomes its own block (images are always block-level in X); the text around it splits into separate paragraphs. |

## Frontmatter

YAML frontmatter is read for two fields and then stripped — it never appears in the body.

| Field | Effect | |
|---|---|---|
| `title:` | Sets the Article title. Overrides the first `# H1`. | ✅ |
| `cover:` | A cover image (local / vault path); the pusher resolves it to bytes and sets it on the draft after creation. | ✅ |

Any other frontmatter key is ignored. **Title precedence:** frontmatter `title:` (or the CLI `--title` flag) › first `# H1` › the file name.

## Not supported, at a glance

- ❌ **Raw HTML** — block-level HTML is dropped; inline tags show as literal text.
- ❌ **Footnotes** (`[^1]`) — leak into the text as broken markers.
- 🟡 **Nested lists** — only the top level survives; sub-items vanish.
- 🟡 **Inline code** — rendered as plain text (no monospace).
- 🟡 **Task-list checkboxes**, **3rd+ heading levels**, **extra H1s** — degrade as noted above.

When you leave a 🟡/❌ construct in and choose the "plain text" fallback, only the truly lossy ones are rewritten (HTML stripped to text, nested lists flattened); tables and code fences are kept as-is because X renders them well.

## Notes & gotchas

- **Headings collapse to two levels.** `##` → Heading, `###` → SubHeading; `#` is the title (removed from the body); `####`+ clamp to SubHeading. X Article's body simply has no deeper level.
- **Embeds are "standalone-only."** A tweet link becomes an embedded quote only when it's alone on its line — matching X's own paste-to-embed behavior. One per line means one embed per line.
- **Images travel as bytes, not URLs.** The pusher packages local image bytes; the extension uploads them from your logged-in session to get a `media_id`. Remote (`http(s)`) images aren't fetched automatically — a custom uploader must pre-download them into the bundle.
- **Oversized images are usually fine.** The relay auto-recompresses oversized PNG / JPEG / WebP at ingest. Only non-compressible formats (GIF, SVG) over ~5 MB risk an X rejection.
- **Offsets are UTF-16 code units.** A CJK character counts as 1, most emoji as 2. This only matters if you build `content_state` yourself — the converter handles it.

---

Want to see the exact `content_state` a given file produces? The conversion truth test lives at [`packages/x-article/test/validate.mjs`](../../packages/x-article/test/validate.mjs). Full walkthrough of the feature: [**X Article publishing**](x-article.md).
