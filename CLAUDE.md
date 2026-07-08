# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kaitox is a personal toolkit (CLI, Obsidian plugin, Chrome extension, agent skills) sharing local infrastructure. First and only feature so far: publish local Markdown as X (Twitter) Article drafts. The deep contributor reference is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — read it before non-trivial changes; this file is the fast orientation.

## Commands

npm workspaces monorepo, ESM-only, Node >= 18. Run from the repo root.

```bash
npm install
npm run build            # 4 packages in dependency order: relay-protocol → x-article → relay → cli
npm run build:extension  # → apps/extension/dist/ (load unpacked in Chrome)
npm run build:obsidian   # → apps/obsidian/dist/  (copy into a vault's .obsidian/plugins/kaitox/)
npm run typecheck
npm test                 # unit suites: @kaitox/relay-protocol + @kaitox/x-article
npm run test:integration # end-to-end: in-process relay + mocked X API
npm run test:protocol    # relay-protocol public exports as a third party would use them
npm run test:all         # build, then all of the above
```

Tests are plain Node scripts, not a framework. To run **one suite** directly, build first, then invoke the file:

```bash
npm run build && node packages/x-article/test/validate.mjs     # conversion truth test
npm run build && node test/integration.mjs                     # integration suite
```

Manual CLI smoke against an isolated home + port (keeps your real `~/.kaitox` clean):

```bash
export KAITOX_HOME=$(mktemp -d) KAITOX_RELAY_PORT=8799
node packages/cli/dist/kaitox.js x push README.md --title "Smoke test"
```

## Architecture

Four publishable packages (`packages/*`, on npm) + two private apps (`apps/*`, GitHub Releases only). The data flow: a **pusher** (CLI / Obsidian / any script) POSTs a draft bundle to the **local relay** on `127.0.0.1:8765`; the **Chrome extension** polls the relay from `x.com/compose/articles` and, on click, uploads images and creates the Article draft inside the user's own logged-in session. No official API, no keys — the extension drives X's private web endpoints.

Dependency layering (never create a cycle; the root `build`/`typecheck` scripts encode this order):

- **`@kaitox/relay-protocol`** — zero-dependency wire contract: `DraftBundle` types, `RelayClient`/`HttpRelayClient`, base64 + validators. Imports nothing from the workspace so third parties can consume it alone.
- **`@kaitox/x-article`** — the X engine: Markdown → Draft.js `content_state`, `XArticleClient`, `publishXArticle`, style checker, preview renderer. Depends on relay-protocol for wire types only.
- **`@kaitox/relay`** — the local server (`bin: kaitox-relay`); stores bundles on disk, re-encodes oversized images at ingest.
- **`@kaitox/cli`** — `bin: kaitox`; depends on all three.
- **`apps/extension`, `apps/obsidian`** — leaves; depend on relay-protocol + x-article.

The bundle carries **raw Markdown, not prebuilt `content_state`** — image `media_id`s only exist after the extension uploads bytes from the logged-in page, so Markdown→content_state conversion must happen there.

Features are namespaced by a `kind` discriminator (default `'x-article'`). The relay treats `kind` as an opaque URL path segment (`/:kind/drafts...`) — it stores/filters/matches but never interprets it, so a new feature (e.g. `linkedin`) needs **zero relay changes**. Adding a feature = new `packages/<feature>` engine + one row in the `FEATURES` table in [`packages/cli/src/kaitox.ts`](packages/cli/src/kaitox.ts) + a consumer polling `/<kind>/drafts`. Full worked example in ARCHITECTURE.md §4.

## Invariants that silently break uploads if violated

These are detailed with every code site in ARCHITECTURE.md §3 — the load-bearing ones:

- **`assets[].src` must equal `collectImageSources(markdown)` output verbatim.** The extension resolves each reported src back to a bundle asset by exact string equality. Never normalize/decode/rewrite src on one side only, or the image is orphaned and skipped.
- **Cover uses the `'__cover__'` sentinel**, is not in `bundle.assets` and not referenced from Markdown; its bytes still travel and land on disk. Only `makeCoverAsset()` emits it. Cover is set after draft creation via a separate `ArticleEntityUpdateCoverMedia` mutation.
- **`content_state` offsets/lengths are UTF-16 code units** (CJK = 1, emoji = 2) — not code points or graphemes.
- **`kind` absent = `'x-article'` forever** (legacy disk bundles). Read it via the `draftKind(bundle)` accessor, never open-code `?? 'x-article'`.
- **Default port 8765 has one source of truth** (`DEFAULT_RELAY_PORT` in relay-protocol) — except `apps/extension/manifest.json`, which must stay static JSON; the extension build fails if the manifest and the constant disagree.
- **`schemaVersion`:** additive changes never bump it (validators tolerate unknown fields); incompatible changes bump `SCHEMA_VERSION`; consumers refuse versions higher than they know; the relay stores any version blindly.

## Conventions

- **Bilingual docs are required.** Every package README and every file under `docs/` ships as `*.md` (English, canonical/source of truth) beside `*.zh-CN.md` (Chinese mirror), linked by a switcher line at the top. Keep both in sync when editing either. CLI `--help`, npm descriptions, and manifests stay English-only.
- **New code comments in English.** Legacy Chinese comments stay as-is — they carry design context; do not bulk-translate.
- **Casing:** "Kaitox" (capital K) in prose/brand/manifests; lowercase "kaitox" only for machine names (CLI command, `@kaitox` npm scope, directory names, `~/.kaitox`, env vars).
- **Releases use changesets.** `npx changeset` on your branch to record a bump; the four `packages/*` version together; `@kaitox/extension` and `@kaitox/obsidian` are ignored and never published. `npm run release` builds + `test:all` + `changeset publish`.
- CI runs build, typecheck, all three suites on Node 20 & 22, builds both apps, and `npm pack --dry-run` on each publishable package.
