English | [简体中文](README.zh-CN.md)

# Kaitox

A personal toolkit — the `kaitox` CLI, an Obsidian plugin, a Chrome extension, and agent skills — on shared local infrastructure. First feature: **publish local Markdown as X (Twitter) Article drafts**, images, formatting and cover included.

```bash
kaitox x push post.md
```

Then open [x.com/compose/articles](https://x.com/compose/articles) and click "上传草稿" (upload draft) in the Kaitox panel. Done.

## How it works

1. **Push** — the CLI (or the Obsidian plugin, or your own script) style-checks the Markdown, packages it with its image bytes, and delivers it to a local relay on `127.0.0.1`.
2. **Relay** — a loopback-only server stores pending drafts on disk. Nothing leaves your machine.
3. **Upload** — the Chrome extension picks the draft up on the X drafts page and creates the Article draft inside your own logged-in session.

No official API, no API keys: the extension drives the web endpoints of your own logged-in x.com session, so your normal browser login is all it needs. Full architecture and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Products

| Product | What it does | Details |
|---|---|---|
| **CLI** | `kaitox x push / list / status` — check, package and deliver; manages the relay for you | [`packages/cli`](packages/cli/README.md) |
| **Obsidian plugin** | Sync the current note as a draft: wikilinks, images, `cover:` frontmatter (desktop only) | [`apps/obsidian`](apps/obsidian/README.md) |
| **Chrome extension** | Uploads pending drafts from the X drafts page, in your own session | [`apps/extension`](apps/extension/README.md) |
| **Agent skills** | Teach Claude Code (and compatible agents) to run the whole loop for you | [`skills/`](skills/README.md) |

Under the hood, three npm packages (ESM-only, Node >= 18):

| Package | Role |
|---|---|
| [`@kaitox/x-article`](packages/x-article/README.md) | The X engine: Markdown → article conversion, style check, preview renderer, X client. Embeddable in your own tools. |
| [`@kaitox/relay`](packages/relay/README.md) | The local relay server (bin: `kaitox-relay`). |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.md) | Zero-dependency wire contract + HTTP client for talking to the relay. |

## Install

**Requirements:** Node.js ≥ 18, an X account you stay logged into, and Chrome (or any Chromium browser) for the upload step.

Install the CLI from npm — it pulls in the local relay and gives you the `kaitox` command:

```bash
npm i -g @kaitox/cli
kaitox --version
```

Install the Chrome extension from the [latest release](https://github.com/kuangjiajia/kaitox-toolkit/releases): download `kaitox-extension-<version>.zip` and unzip it, then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

> 🖼️ _Tutorial image — loading the unpacked extension in `chrome://extensions`._ — `docs/images/01-load-extension.png`
<!-- ![Load the unpacked extension](docs/images/01-load-extension.png) -->

Open <https://x.com/compose/articles> while logged in; the Kaitox panel should appear in the corner.

> 🖼️ _Tutorial image — the Kaitox panel on the X drafts page._ — `docs/images/02-panel.png`
<!-- ![Kaitox panel on x.com/compose/articles](docs/images/02-panel.png) -->

(Optional) the [Obsidian plugin](apps/obsidian/README.md) pushes drafts straight from your vault: from the same [release](https://github.com/kuangjiajia/kaitox-toolkit/releases), drop `main.js` and `manifest.json` into `.obsidian/plugins/kaitox/` and enable it in Settings. The [agent skill](skills/README.md) lets a coding agent run the whole loop for you.

> Placeholders above are commented-out image tags. Drop the screenshot at the given `docs/images/…` path and uncomment the line right below each caption. See [`docs/images/README.md`](docs/images/README.md).

## Using the X feature

Turn any Markdown file into an X Article draft in two moves — push from the terminal, upload from the browser.

### 1. Push the Markdown

```bash
kaitox x push path/to/post.md
```

`push` style-checks the file, resolves its images to bytes, starts the local relay if it isn't running, and queues the draft on your machine. It prints an **X-friendliness report** first; if the content isn't X-friendly it asks whether to fix it, fall back to plaintext, or upload as-is.

> 🖼️ _Tutorial image — `kaitox x push` output with the style report and draft id._ — `docs/images/03-push.png`
<!-- ![kaitox x push output](docs/images/03-push.png) -->

Common flags:

| Flag | Effect |
|---|---|
| `--title "…"` | Override the article title (default: `title:` frontmatter → first heading → file name). |
| `--cover img.png` | Set the article cover — a local path or `http(s)` URL. Kept out of the body. |
| `--plaintext` | Degrade tables / code / HTML / nested lists to safe plain text. |
| `--force` | Upload as-is even when the style check flags issues. |

Check the queue and results:

```bash
kaitox x list          # pending drafts on the relay
kaitox x status <id>   # one draft's status + the article rest_id once created
```

### 2. Upload from the browser

Open <https://x.com/compose/articles>, find your draft in the Kaitox panel, and click **上传草稿** (upload draft). The extension uploads the images and creates the Article draft inside your own logged-in session, then opens it in the editor. Images and formatting land together — review and publish from X when you're ready.

> 🖼️ _Tutorial image — clicking 上传草稿 and the resulting Article draft in the X editor._ — `docs/images/04-upload-result.png`
<!-- ![Uploading a draft and the result in the X editor](docs/images/04-upload-result.png) -->

Full flag reference, frontmatter and image-resolution rules, and troubleshooting live in the [CLI README](packages/cli/README.md).

## Build on it

Any program that can POST JSON to `127.0.0.1` can push drafts, and new features slot in via the bundle's `kind` discriminator:

- [`docs/integrate-local-service.md`](docs/integrate-local-service.md) — push drafts from your own script or service.
- [`docs/integrate-browser-extension.md`](docs/integrate-browser-extension.md) — build your own uploader on `@kaitox/x-article`.
- [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md) — the full X wire protocol.

## Status & caveats

The `@kaitox/*` packages are on npm; the Chrome extension and Obsidian plugin are distributed as [GitHub Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases) (not in the Chrome Web Store or Obsidian community directory yet). Building from source and contributing: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Publishing drives X's private web endpoints with your own logged-in session: it is unofficial, may break when X rotates its internals, and is meant for publishing your own content at human pace — not mass automation. Per-product limitations are in each product README.

## License

[MIT](LICENSE)
