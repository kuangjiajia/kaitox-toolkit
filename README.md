English | [简体中文](README.zh-CN.md)

# Kaitox

Kaitox is my personal toolkit — a growing set of small efficiency tools that share one piece of local infrastructure. Each tool reaches you through whichever surface fits: a coding agent, an Obsidian plugin, a Chrome extension, or the `kaitox` CLI.

## Features

| Feature | Status | What it does |
|---|---|---|
| [**X Article publishing**](docs/Features/x-article.md) | ✅ Available now | Publish local Markdown as X (Twitter) Article drafts — images, formatting, and cover included. |
| More to come | 🌱 On the way | Additional personal efficiency tools, each sharing the same local relay. |

## Install

Each piece comes from where it fits best: **agent skills** live in this repo, the **Chrome extension** and **Obsidian plugin** ship as [GitHub Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases), and the `kaitox` CLI is on npm. Install only the pieces a feature calls for.

**Requirements:** Node.js ≥ 18. The X Article feature also needs an X account you stay logged into and a Chromium browser (Chrome / Edge / Brave) for the upload step.

### Agent skills

Skills teach a coding agent (Claude Code, Codex, and compatible hosts) to drive Kaitox for you. From a checkout of this repo:

```bash
# Claude Code — copy the directory; it auto-activates from its description
cp -r skills/kaitox-x-article ~/.claude/skills/                 # one skill
for d in skills/*/; do cp -r "${d%/}" ~/.claude/skills/; done   # all skills
# swap ~/.claude/skills/ → .claude/skills/ to install per-project instead

# Codex — copy SKILL.md into your prompts folder; it becomes a /command
cp skills/kaitox-x-article/SKILL.md ~/.codex/prompts/kaitox-x-article.md               # one skill
for d in skills/*/; do cp "$d/SKILL.md" ~/.codex/prompts/"$(basename "$d")".md; done   # all skills
```

Other hosts that discover `SKILL.md` files can be pointed straight at this repo's `skills/` directory. More: [`skills/README.md`](skills/README.md).

> **Heads up:** the Chrome extension and Obsidian plugin are still under review in the Chrome Web Store and the Obsidian community directory. Until they're approved, install both manually from GitHub Releases as below.

### Chrome extension

From the [Releases page](https://github.com/kuangjiajia/kaitox-toolkit/releases), open the **Kaitox Chrome extension** release, download `kaitox-extension-<version>.zip`, and unzip it. Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the unzipped folder.

### Obsidian plugin

From the same [Releases page](https://github.com/kuangjiajia/kaitox-toolkit/releases), open the **Kaitox Obsidian plugin** release and drop its `main.js` and `manifest.json` into your vault's `.obsidian/plugins/kaitox/`, then enable it in Settings (desktop only).

### CLI

```bash
npm i -g @kaitox/cli
```

Optional — the agent skill installs it for you when it's missing. Command and flag reference: [CLI README](packages/cli/README.md).

Installed? Using the X Article feature is two moves — sync, then upload. Full walkthrough: **[Publish to X](docs/Features/x-article.md)**.

## How it works

Every Kaitox tool has the same shape: a pusher packages work and hands it to a local relay on `127.0.0.1`; a consumer picks it up and does the rest. The relay is loopback-only — nothing leaves your machine — and features are namespaced so they never collide, so a new tool slots in without touching the last.

Full architecture and design decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Under the hood

Three npm packages (ESM-only, Node >= 18):

| Package | Role |
|---|---|
| [`@kaitox/relay`](packages/relay/README.md) | The local relay server (bin: `kaitox-relay`) — the shared foundation every feature reuses. |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.md) | Zero-dependency wire contract + HTTP client for talking to the relay. |
| [`@kaitox/x-article`](packages/x-article/README.md) | The X engine (Markdown → article, style check, preview, X client) — specific to the X Article feature. |

## Build on it

Any program that can POST JSON to `127.0.0.1` can push drafts, and new features slot in via the bundle's `kind` discriminator:

- [`docs/integrate-local-service.md`](docs/integrate-local-service.md) — push drafts from your own script or service.
- [`docs/integrate-browser-extension.md`](docs/integrate-browser-extension.md) — build your own uploader on `@kaitox/x-article`.
- [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md) — the full X wire protocol.

## Status & caveats

The `@kaitox/*` packages are on npm; the Chrome extension and Obsidian plugin are still under review for the Chrome Web Store and the Obsidian community directory, so for now they're installed manually from [GitHub Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases). Building from source and contributing: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## License

[MIT](LICENSE)
