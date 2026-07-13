English | [简体中文](README.zh-CN.md)

# @kaitox/obsidian

The Obsidian product of the [Kaitox](../../README.md) personal toolkit (private, not published). Current feature: preview the active note as an **X (Twitter) Article** and push it to your drafts — straight from your vault.

## How it works

Kaitox for Obsidian is an upload client of the pipeline — it previews, checks, and packages; the actual publish happens in your browser. It opens a **publish-preview panel** (right sidebar) that mirrors the active note live:

1. **Channel switch** — pick the target (X Article today; WeChat is reserved as a `soon` slot). Adding a channel is a new engine plus one row — no relay changes (kinds are namespaced).
2. **Live preview** — the note is resolved (frontmatter `title:`/`cover:`, `![[wikilink]]` embeds, vault-relative `![alt](src)`, and remote `http(s)` images become bytes; duplicate references reuse one asset) and rendered exactly as it will look as an X Article, via the same conversion path as publishing (`renderPreviewHtml` from [`@kaitox/x-article`](../../packages/x-article/README.md)). What you see is what gets pushed.
3. **Style check** — a toolbar toggle (with an attention badge counting errors + warnings) lists every X-friendliness issue (`checkMarkdownStyle`): tables → plaintext, non-recompressible oversized images, external links shown as plaintext, plus what passes.
4. **Cover** — upload / replace / remove a cover inline; it ships separately from the body (sentinel src `__cover__`) and never appears in the article text. With no inline cover, the frontmatter `cover:` is used.
5. **Push to drafts** — POST the bundle (raw Markdown + image bytes + style report + note metadata) to the local relay at `http://127.0.0.1:8765` via [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.md). A green dot reflects relay connectivity. When the note isn't friendly, the push dialog offers a **plaintext fallback** (`toPlaintextMarkdown`, which degrades HTML blocks / nested lists but keeps images and assets unchanged).
6. **Finish in the browser** — the [Chrome extension](../extension) picks the draft up on `x.com/compose/articles` inside your logged-in session and creates the Article draft there. The success dialog links straight to the editor.

## Install

From [Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases), download `main.js` and `manifest.json` into your vault at `.obsidian/plugins/kaitox/` (create the folder), then enable **Kaitox** in Settings → Community plugins. The `kaitox-obsidian-<version>.zip` asset is the same two files in a ready-to-drop `kaitox/` folder.

**Desktop only** (`isDesktopOnly: true`): the plugin talks to the local relay on `127.0.0.1`, which mobile Obsidian cannot reach.

### Build from source

For development, build it yourself from the repo root, then copy `apps/obsidian/dist/` into `.obsidian/plugins/kaitox/`:

```bash
npm run build:obsidian   # bundles the plugin → apps/obsidian/dist/
```

## Usage

Open the panel, then push:

- Ribbon action: the paper-plane icon (**Kaitox：发布预览**) opens the publish-preview panel.
- Command palette: **打开发布预览面板** (open publish-preview panel), or **推送当前笔记到草稿箱** (push current note to drafts) to skip the panel and go straight to the push dialog.

Inside the panel, the toolbar carries the channel switch, the **样式检查** (style check) toggle, a settings gear, the relay status dot, and the **推送到草稿箱** (push to drafts) button.

Frontmatter keys the plugin reads:

```yaml
---
title: My article title      # optional; falls back to the first heading, then the file name
cover: "[[cover.png]]"       # optional; wikilink, vault-relative path, or http(s) URL
---
```

The cover is resolved to bytes and shipped separately from the body (sentinel src `__cover__`); it never appears in the article text.

Image resolution rules:

- `![[image.png]]` and `![[image.png|alt]]` — resolved through Obsidian's link resolver; `#heading` suffixes are stripped; non-image embeds are skipped and reported.
- `![alt](relative/path.png)` — resolved against the vault (URL-encoded paths are decoded).
- `![alt](https://...)` — fetched and bundled as bytes.

After a successful push, open <https://x.com/compose/articles> (the success dialog links there with the draft id). If the Chrome extension setting `跳转到页面立即自动上传` is enabled, that link starts the upload immediately and shows progress; otherwise, open the Kaitox panel and click upload. If the push fails, make sure the local relay is running (`kaitox relay --daemon` or just `kaitox x push` once, which auto-starts it) — the toolbar's status dot goes green when it's reachable.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| relay 地址 (relay base URL) | `http://127.0.0.1:8765` | Address of the local kaitox relay. |
| relay token (optional) | empty | If your relay enforces a token (`~/.kaitox/config.json`), set the same value here; it is sent as the `x-kaitox-token` header. |
| 推送后打开 X 文章编辑器 (open X composer after push) | on | After a successful push, open `x.com/compose/articles` automatically with the new draft id in the URL. |

## Compliance

The pipeline drives your own logged-in x.com session against X's private web endpoints. It is unofficial, may break at any time, and is automation of your own account — use at your own risk, keep the frequency low, and mind X's automation policy.

## Related

- [Root README](../../README.md) — the Kaitox toolkit and the full draft pipeline.
- [`@kaitox/x-article`](../../packages/x-article/README.md) — style check, plaintext fallback, title derivation.
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.md) — the wire contract used to post drafts.
- [`apps/extension`](../extension) — the Chrome extension that uploads the draft.
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) · [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md)
