English | [简体中文](README.zh-CN.md)

# Kaitox

A personal toolkit — an agent skill, a Chrome extension, an Obsidian plugin, and the `kaitox` CLI — on shared local infrastructure. First feature: **publish local Markdown as X (Twitter) Article drafts**, images, formatting and cover included.

The easiest way to use it: install the agent skill, then just ask your coding agent (Claude Code / Codex) to sync a Markdown file — it drives everything for you.

## How it works

1. **Push** — an agent (via the Kaitox skill), the Obsidian plugin, the CLI, or your own script style-checks the Markdown, packages it with its image bytes, and delivers it to a local relay on `127.0.0.1`.
2. **Relay** — a loopback-only server stores pending drafts on disk. Nothing leaves your machine.
3. **Upload** — the Chrome extension picks the draft up on the X drafts page and creates the Article draft inside your own logged-in session.

No official API, no API keys: the extension drives the web endpoints of your own logged-in x.com session, so your normal browser login is all it needs. Full architecture and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Products

| Product | What it does | Details |
|---|---|---|
| **Agent skill** | Teaches Claude Code / Codex (and compatible agents) to run the whole publish loop for you — the recommended way | [`skills/`](skills/README.md) |
| **Chrome extension** | Uploads pending drafts from the X drafts page, in your own session | [`apps/extension`](apps/extension/README.md) |
| **Obsidian plugin** | Sync the current note as a draft: wikilinks, images, `cover:` frontmatter (desktop only) | [`apps/obsidian`](apps/obsidian/README.md) |
| **CLI** | Style-check, package and deliver a Markdown file to the relay from your terminal | [`packages/cli`](packages/cli/README.md) |

Under the hood, three npm packages (ESM-only, Node >= 18):

| Package | Role |
|---|---|
| [`@kaitox/x-article`](packages/x-article/README.md) | The X engine: Markdown → article conversion, style check, preview renderer, X client. Embeddable in your own tools. |
| [`@kaitox/relay`](packages/relay/README.md) | The local relay server (bin: `kaitox-relay`). |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.md) | Zero-dependency wire contract + HTTP client for talking to the relay. |

## Install

**Requirements:** Node.js ≥ 18, an X account you stay logged into, and Chrome (or any Chromium browser) for the upload step.

Two pieces: an agent **skill** to push drafts, and the **Chrome extension** that uploads them (the browser half that actually writes into X — nothing replaces it).

### 1. Install the agent skill

Drive Kaitox from Claude Code, Codex, or a compatible agent by installing the [`kaitox-x-article` skill](skills/README.md) — from a checkout of this repo:

```bash
# Claude Code — a skill directory that auto-activates from its description
cp -r skills/kaitox-x-article ~/.claude/skills/                        # or .claude/skills/ per project

# Codex — a prompt you invoke with /kaitox-x-article
cp skills/kaitox-x-article/SKILL.md ~/.codex/prompts/kaitox-x-article.md
```

That's the whole push-side setup: the skill **installs the `kaitox` CLI for you** when it's missing (`npm i -g @kaitox/cli`, or falls back to `npx`) and **starts the local relay on its own**. For other agent hosts, see [`skills/README.md`](skills/README.md).

> Rather drive it from the terminal without an agent? Install the CLI with `npm i -g @kaitox/cli` — command and flag reference, plus relay management, live in the [CLI README](packages/cli/README.md).

### 2. Install the Chrome extension

Download it from the Releases page:

<https://github.com/kuangjiajia/kaitox-toolkit/releases>

Open the **Kaitox Chrome extension** release, download `kaitox-extension-<version>.zip`, and unzip it. Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

![Load the unpacked extension](docs/images/01-load-extension.png)

Open <https://x.com/compose/articles> while logged in — with the relay running, the Kaitox panel appears in the corner.

![Kaitox panel on x.com/compose/articles](docs/images/02-panel.png)

(Optional) the [Obsidian plugin](apps/obsidian/README.md) pushes drafts straight from your vault: from the same [Releases page](https://github.com/kuangjiajia/kaitox-toolkit/releases), open the **Kaitox Obsidian plugin** release and drop its `main.js` and `manifest.json` into `.obsidian/plugins/kaitox/`, then enable it in Settings.

> The remaining `> 🖼️ …` captions below are still placeholders (commented-out image tags). Drop the screenshot at the given `docs/images/…` path and uncomment the line right below each caption. See [`docs/images/README.md`](docs/images/README.md).

## Using the X feature

Two moves: ask your agent to sync the Markdown, then upload from the browser.

### 1. Ask your agent to sync the Markdown

With the skill installed, tell your agent what to publish — for example:

> Sync `./post.md` to an X Article draft.

(In Codex, run `/kaitox-x-article`.) The agent style-checks the file, explains any X-friendliness issues in plain language, and lets you choose how to handle them — fix them, degrade to plaintext, or upload as-is — then delivers the draft to your local relay. It installs the CLI and starts the relay on its own if they aren't ready, so you never touch the terminal. You can also point it at a cover image or override the title in the same request.

> 🖼️ _Tutorial image — the agent syncing a Markdown file: style report and draft id._ — `docs/images/03-push.png`
<!-- ![Agent syncing a Markdown file to an X draft](docs/images/03-push.png) -->

### 2. Upload from the browser

Open <https://x.com/compose/articles>, find your draft in the Kaitox panel, and click **上传草稿** (upload draft). The extension uploads the images and creates the Article draft inside your own logged-in session, then opens it in the editor. Images and formatting land together — review and publish from X when you're ready.

> 🖼️ _Tutorial image — clicking 上传草稿 and the resulting Article draft in the X editor._ — `docs/images/04-upload-result.png`
<!-- ![Uploading a draft and the result in the X editor](docs/images/04-upload-result.png) -->

Prefer to run it yourself from the terminal? The full `kaitox x push` reference — flags, frontmatter, image-resolution rules, and `list` / `status` — is in the [CLI README](packages/cli/README.md).

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
