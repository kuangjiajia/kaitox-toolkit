English | [简体中文](README.zh-CN.md)

# @kaitox/cli

The command-line product of [Kaitox](https://kaitox.ai), a personal toolkit. The current feature: style-check a local Markdown file, bundle it together with its image bytes, and deliver it to your local [Kaitox relay](../relay) as an **X (Twitter) Article draft**. The Kaitox Chrome extension then writes the draft into X from your own logged-in browser session.

The CLI never talks to X directly — it only talks to the relay on `127.0.0.1`. See [the publish protocol](../../docs/x-article-publish-protocol.md) for how the pieces fit together.

## Install

```bash
npm i -g @kaitox/cli
```

Requires Node.js >= 18. ESM-only. Installs a single binary: `kaitox`.

## Commands

> Note: help text is in English; interactive runtime messages (reports, prompts, status output) are currently in Chinese.

### `kaitox x push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]`

Style-checks the Markdown, resolves every referenced image to bytes, and posts the whole bundle to the local relay. If the relay is not running, `push` starts it in the background automatically.

What it does, in order:

1. Reads the file and strips YAML frontmatter (see [Frontmatter support](#frontmatter-support)).
2. Resolves all body images (see [Image resolution rules](#image-resolution-rules)).
3. Runs the style check and prints a report: errors / warnings / info, with line numbers and fix suggestions.
4. If the content is **not X-friendly** and you passed neither `--plaintext` nor `--force`:
   - **In a terminal (TTY):** an interactive three-way prompt — `[f]` cancel and go fix the Markdown yourself (the default), `[p]` degrade to plaintext mode and upload, `[u]` upload as-is in rich mode.
   - **Non-interactive (no TTY, e.g. CI or an agent):** the command fails with an error asking you to rerun with an explicit `--plaintext` or `--force`. It never uploads unfriendly content on its own.
5. Warns about any images (or cover) that could not be resolved — they are skipped, the push still goes through.
6. Delivers the bundle and prints the draft id, title, mode, image count, and next steps.

Flags:

| Flag | Effect |
| --- | --- |
| `--title T` | Override the article title. Precedence: `--title` > frontmatter `title:` > a title derived from the content > the file name. |
| `--cover IMG` | Set an article cover image. Accepts a local path or an `http(s)` URL. Relative paths are resolved against the **current working directory** first, falling back to the Markdown file's directory. The cover does not appear in the body; the extension uploads it separately and sets it as the article cover after creating the draft. If it cannot be resolved, `push` warns and continues without a cover. `--cover` requires a value. |
| `--plaintext` | Build in plaintext fallback mode from the start (skips the prompt). Unfriendly constructs — tables, code blocks, raw HTML, nested lists — are degraded to safe plain text; headings, bold, links and images are preserved. |
| `--force` | Upload as-is in rich mode even when the style check flags problems (skips the prompt). Unfriendly constructs may render poorly in the X editor. |

### `kaitox x list`

Lists pending drafts on the relay: short id (first 8 characters), status, mode, title, and the style-issue counts (`[<errors>E/<warnings>W]`). Requires the relay to be running (this command does not auto-start it).

### `kaitox x status <id>`

Shows one draft's title, status, the article `rest_id` once the extension has created it on X, and any upload error. Use the id printed by `kaitox x push`. Requires the relay to be running.

### `kaitox relay ...`

Relay lifecycle. You rarely need these — `kaitox x push` starts the relay on demand.

```bash
kaitox relay            # run in the foreground (Ctrl-C to stop)
kaitox relay --daemon   # start in the background (no-op if already running)
kaitox relay stop       # stop the background relay
kaitox relay restart    # kill whatever holds the port, then start again
kaitox relay status     # is it running, and on which URL
```

The relay listens on `http://127.0.0.1:8765` and stores drafts under `~/.kaitox/x-article/outbox/` (each feature gets its own `~/.kaitox/<kind>/` namespace). Override with `KAITOX_RELAY_PORT` and `KAITOX_HOME`. It binds to `127.0.0.1` only. See [@kaitox/relay](../relay) for details, including the optional per-install token.

### `kaitox --version`, `kaitox help`

```bash
kaitox --version   # or -v
kaitox help        # or -h / --help; also: kaitox x --help
```

## Frontmatter support

If the file starts with a YAML frontmatter block, it is stripped from the published body, and exactly **one** key is read:

```markdown
---
title: My article title
---
```

- `title:` — used as the article title unless `--title` overrides it. Surrounding quotes are stripped.
- `cover:` frontmatter is **not** supported — the cover image can only be set with the `--cover` flag.

Everything else in the frontmatter is ignored.

## Image resolution rules

`push` collects every image referenced in the Markdown body and resolves each source to bytes at push time:

- **`http(s)://` URLs** — downloaded by the CLI (your machine must be able to reach them). MIME type comes from the response `Content-Type`, falling back to the file extension.
- **`file://` URLs** — read from disk.
- **Absolute paths** — read directly.
- **Relative paths** — resolved against the Markdown file's directory (URL-encoded characters are decoded).

Sources that cannot be resolved are flagged as `image-missing` in the style report, listed in a warning at push time, and **skipped** during upload — the draft is still created without them.

The `--cover` image follows a slightly different rule: relative paths try the current working directory first, then fall back to the Markdown file's directory.

Bundle file names are sanitized and de-duplicated, so images with the same base name never overwrite each other.

## Agent skill

Agent skills are their own product of the Kaitox toolkit, living at the repo root under [`skills/`](../../skills/README.md). The [`kaitox-x-article` skill](../../skills/kaitox-x-article/SKILL.md) teaches Claude Code / Codex-style coding agents the full loop around this CLI: run `kaitox x push`, translate every style error/warning into plain language, offer the fix / `--plaintext` / `--force` choice to the user (agents run without a TTY, so the explicit flags matter), and hand off to the browser step. See [`skills/README.md`](../../skills/README.md) for how to install it.

## What happens after push

`push` only delivers the draft to the local relay, which stores it under `~/.kaitox/x-article/outbox/<id>/`. To actually create the draft on X:

1. Open <https://x.com/compose/articles> in a browser where the Kaitox Chrome extension is installed and you are logged in to X.
2. The extension polls the local relay every 5 seconds and shows pending drafts in its panel.
3. Click upload. If the extension setting `跳转到页面立即自动上传` is enabled, you can instead open the auto-upload URL printed by `kaitox x push`; it includes the draft id and starts this step immediately.
4. The extension uploads the images and creates the Article draft using the page's own logged-in session — the raw Markdown is converted to X's content format only at this point, because image `media_id`s exist only after upload from the logged-in page.
5. `kaitox x status <id>` reflects the result, including the article `rest_id`.

> **Compliance note:** this drives your own logged-in browser session against X's private web endpoints. It is unofficial, may break whenever X rotates its internal query ids, and is for publishing your own content at human pace — use at your own risk and do not mass-automate.

## License

MIT © [kaitox](https://kaitox.ai)
