---
name: kaitox-x-article
description: Style-check a local Markdown file, bundle it (with images and cover), and sync it to the local relay as an X (Twitter) Article draft. Use when the user wants to turn a .md file into an X long-form draft, or says things like "sync to X drafts / upload to a Twitter article / push to kaitox / publish as an X Article".
---

# Sync Markdown to an X (Twitter) Article draft

Use the `kaitox` CLI to style-check a local Markdown file, bundle it together with its images, and deliver it to the local relay. The user then opens the X drafts page in their browser and clicks "Upload draft" in the kaitox Chrome extension panel — that is when the images and formatting are actually written into X.

**You (the agent) own only the upload-side half**: install the CLI, run the check, explain any style problems, and deliver on the user's terms. Writing the images and body into the X draft is done by the Chrome extension inside the user's already-logged-in x.com session — you neither should nor can call X's APIs on the user's behalf.

## Prerequisite: make sure `kaitox` is available (install the npm package by default)

1. Probe first: `kaitox --version`. If it prints a version, use it directly.
2. Otherwise install the global package (it provides the `kaitox` command and bundles `@kaitox/x-article`):
   ```
   npm i -g @kaitox/cli
   ```
3. If a global install fails or you lack permission, use npx (replace every `kaitox` below with `npx @kaitox/cli@latest`):
   ```
   npx @kaitox/cli@latest x push <file.md>
   ```
4. When working inside this repo, you can fall back to the local build: `node packages/cli/dist/kaitox.js` (run `npm run build` first).

Requires Node ≥ 18.

## Steps

### 1. Establish the article path and cover (user-provided or auto-detected)

- **The `.md` file**: use the path if the user gave one. If not, look in the current directory and the conversation context for a `.md` file; if there is exactly one, use it — if there are several or it is unclear, **ask the user**. Don't guess.
- **Cover image (optional — a push works without one)**. Auto-detect in this order, and ask only if none is found:
  1. If the `.md` has a frontmatter `cover:` field, the CLI picks it up automatically — you don't pass any flag.
  2. Otherwise look in the `.md`'s directory for `cover.png / cover.jpg / cover.jpeg / cover.webp`; if found, pass `--cover <that file>` and tell the user which image you used.
  3. If there is none, ask the user whether to set a cover and where the image is. If they explicitly don't want one, omit `--cover`.

  The cover does not appear in the body; the extension uploads it separately and sets it as the article cover after creating the draft. `--cover` accepts a local path or an http(s) URL (relative paths resolve against the current directory first, then the `.md`'s directory).

### 2. Run the style check first (this step will not upload unfriendly content on its own)

```
kaitox x push <file.md> [--cover <img>] [--title "Title"]
```

You run in a non-interactive environment (no TTY), so there are two outcomes:

- **Style is friendly** → the command delivers the draft to the relay and prints a draft id. Skip to step 4.
- **Style is not friendly** → the command prints a **style report**, then **exits with an error without uploading**. Go to step 3.

### 3. Not friendly: alert the user first, then decide how to push

**Don't push yet.** Restate each error / warning from the report in plain language: which line, what the problem is, and how to fix it. Then let the user pick one of three options (offer them with AskUserQuestion — don't decide for the user):

- **Go fix it (recommended)**: the user edits the Markdown themselves — tables, nested lists, footnotes, and code blocks are best fixed by hand. After editing, go back to step 2 and rerun.
- **Plaintext fallback**: `kaitox x push <file.md> --plaintext [--cover <img>]` — automatically degrades tables / code / HTML / nested lists to safe plain text; the rest (headings, bold, links, images) is preserved.
- **Upload as-is**: `kaitox x push <file.md> --force [--cover <img>]` — no edits, uploaded as rich text (unfriendly constructs may render poorly).

Only run the chosen command after the user decides — that is the actual push.

### 4. After a successful delivery

Tell the user:

- the draft id, title, mode (rich / plaintext), image count, and whether a cover was set;
- **Next step**: open `https://x.com/compose/articles` in the browser and click "Upload draft" in the kaitox extension panel. If the Chrome extension setting `跳转到页面立即自动上传` is enabled, open the auto-upload URL printed by `kaitox x push` instead; it includes the draft id and starts the upload immediately. The images and formatting are written into the X draft only at that browser step.

## Other commands

- `kaitox x list` — list pending drafts (with each one's error/warning counts).
- `kaitox x status <id>` — show a draft's upload status / article rest_id.
- `kaitox relay status | --daemon | stop | restart` — the relay is usually auto-started by `kaitox x push`; you rarely need to manage it manually.

## Points to remind the user of

- This drives the user's **own account** through their **already-logged-in x.com session** in their browser — it's an automation script. Don't run it at high frequency, and don't batch across accounts.
- Remote images (http/https) are downloaded into the draft bundle by `kaitox x push`, so this machine must be able to reach those image URLs.
- Local/relative body images resolve against the `.md`'s directory; a wrong path is flagged as image-missing and skipped on upload (the rest of the content is unaffected).
- A cover that can't be resolved is warned about and skipped — no cover is set, and the body is unaffected.
