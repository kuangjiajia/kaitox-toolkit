English | [简体中文](README.zh-CN.md)

# @kaitox/obsidian

The Obsidian product of the [Kaitox](../../README.md) personal toolkit (private, not published). Current feature: sync the active note as an **X (Twitter) Article draft** straight from your vault.

## How it works

The plugin is an upload client of the Kaitox pipeline — it checks and packages; the actual upload happens in your browser:

1. Read the active note; parse `title:` and `cover:` from the frontmatter.
2. Resolve every image into bytes — `![[wikilink]]` embeds, standard `![alt](src)` with vault-relative paths, and remote `http(s)` URLs — rewriting them to stable file names (duplicate references reuse one asset). Unresolved images are left as-is and reported in a notice.
3. Run the X-friendliness style check (`checkMarkdownStyle` from [`@kaitox/x-article`](../../packages/x-article/README.md)). Friendly notes upload immediately; otherwise a modal lists every issue (severity, line, suggestion) and asks: **fix it** / **plaintext fallback** / **upload as-is**. Closing the modal cancels.
4. POST the draft bundle (raw Markdown + image bytes, plus the style report and note metadata) to the local relay at `http://127.0.0.1:8765` via [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.md).
5. The [Chrome extension](../extension) picks the draft up on `x.com/compose/articles` inside your logged-in session — click "上传草稿" (upload draft) there to finish.

In plaintext mode the Markdown is degraded once at upload time (`toPlaintextMarkdown`); image references and assets are kept unchanged.

## Install

From the repo root:

```bash
npm run build:obsidian   # bundles the plugin → apps/obsidian/dist/
```

Copy `apps/obsidian/dist/` into your vault at `.obsidian/plugins/kaitox/` and enable the plugin in Settings → Community plugins.

**Desktop only** (`isDesktopOnly: true`): the plugin talks to the local relay on `127.0.0.1`, which mobile Obsidian cannot reach.

## Usage

Trigger the sync either way:

- Command palette: **同步当前笔记为 X Article 草稿** (sync current note as X Article draft)
- Ribbon action: the paper-plane icon ("kaitox：同步到 X 草稿")

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

After a successful post you get a notice; open <https://x.com/compose/articles> and click "上传草稿" in the Kaitox panel. If the post fails, make sure the local relay is running (`kaitox relay --daemon` or just `kaitox x push` once, which auto-starts it).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| relay 地址 (relay base URL) | `http://127.0.0.1:8765` | Address of the local kaitox relay. |
| relay token (optional) | empty | If your relay enforces a token (`~/.kaitox/config.json`), set the same value here; it is sent as the `x-kaitox-token` header. |

## Compliance

Same caveat as the [root README](../../README.md#known-limitations): the pipeline drives your own logged-in x.com session against X's private web endpoints. It is unofficial, may break at any time, and is automation of your own account — use at your own risk, keep the frequency low, and mind X's automation policy.

## Related

- [Root README](../../README.md) — the Kaitox toolkit and the full draft pipeline.
- [`@kaitox/x-article`](../../packages/x-article/README.md) — style check, plaintext fallback, title derivation.
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.md) — the wire contract used to post drafts.
- [`apps/extension`](../extension) — the Chrome extension that uploads the draft.
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) · [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md)
