English | [简体中文](README.zh-CN.md)

# kaitox

A **local publishing platform**: CLI + local relay + Obsidian plugin + Chrome extension. The first feature is publishing local Markdown as **X (Twitter) Article drafts** — pick a `.md` file, style-check it, push it to a local relay, then click "上传草稿" (upload draft) in the browser extension on the X draft page. Images and formatting land in the Article draft in one go. More publishing targets will slot in later via the bundle's `kind` discriminator.

It does not use the official public API. Instead, the extension drives the **web endpoints of your own logged-in x.com session**. The full data model and protocol are documented in [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md).

## Why this design

The Chrome extension runs **inside the logged-in x.com page**, so the extension does the image uploads and draft creation — same-origin requests carry cookies automatically (`credentials: 'include'`, `ct0` cookie as `x-csrf-token`), sidestepping both "manually injecting cookies" and the `x-client-transaction-id` problem. Consequently:

- Upload clients only **check + package** (raw Markdown + image bytes) and deliver the bundle to the local relay.
- The extension then, from within the page: **upload images to get `media_id`s → `markdownToContentState` → create the draft** — all same-origin.

The bundle deliberately carries **raw Markdown, not a prebuilt `content_state`**: image `media_id`s only exist after the images are uploaded from the logged-in page, so the conversion has to happen on the extension side.

```
Upload clients (CLI / Obsidian / your own service)
   │  read .md + collect local image bytes + style check (X-friendliness)
   │  unfriendly → suggest fixes; plaintext fallback if the user declines
   ▼  POST draft bundle (raw Markdown + image bytes, base64, one JSON)
Local relay  http://127.0.0.1:8765   ── stores ~/.kaitox/outbox/<id>/
   ▲  GET poll list / fetch bytes (CORS allowlist: x.com / Obsidian / extensions)
   │
Chrome extension (MV3 content script on x.com/compose/articles, polls every 5s)
   │  panel lists pending drafts; on "上传草稿":
   │   ① read ct0 from document.cookie   ② upload each image same-origin (INIT/APPEND/FINALIZE)
   │   ③ markdownToContentState(md, {src → media_id})   ④ ArticleEntityDraftCreate
   ▼  navigates to x.com/compose/articles/edit/<rest_id>
```

## Packages (npm workspaces)

All published packages are ESM-only, require Node >= 18, and version together (currently 0.3.0; npm publish pending).

| Package | Purpose |
|---|---|
| [`@kaitox/x-article`](packages/x-article/README.md) | The X engine: `markdownToContentState`, `collectImageSources`, `XArticleClient`, `publishXArticle`, style check + plaintext fallback, X constants. Runs in the browser (same-origin on x.com) and in Node. |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.md) | Zero-dependency wire contract: `DraftBundle` / `DraftAsset` / `StyleReport` types, `RelayClient` interface, `HttpRelayClient`, base64 helpers. |
| [`@kaitox/relay`](packages/relay/README.md) | Local relay server (bin `kaitox-relay`), stores draft bundles under `~/.kaitox/outbox/`, zero third-party deps. |
| [`@kaitox/cli`](packages/cli/README.md) | The `kaitox` command line: `kaitox x push/list/status`, `kaitox relay ...`. |

Private apps (not published):

| App | Purpose |
|---|---|
| `apps/extension` | Chrome MV3 extension — the uploader that runs on x.com/compose/articles. |
| `apps/obsidian` | Obsidian plugin — sync the current note as an X Article draft (resolves `![[wikilinks]]`, relative and remote images; `cover:` frontmatter). Desktop only. |

## Quick start

```bash
npm install
npm run build            # builds relay-protocol → x-article → relay → cli
npm test                 # x-article engine tests (35 assertions)
npm run test:integration # end-to-end: in-process relay + upload pipeline (31 assertions)
npm run test:protocol    # relay-protocol wire smoke test (10 assertions)
npm run test:all         # build + all of the above
npm run build:extension  # bundle the Chrome extension → apps/extension/dist/
npm run build:obsidian   # bundle the Obsidian plugin → apps/obsidian/dist/
```

### 1. Push a Markdown file with the CLI

```bash
kaitox x push path/to/post.md
#   Prints an X-friendliness report first; if unfriendly, asks:
#   fix it / plaintext fallback / upload as-is
#   --title T          override the title
#   --cover IMG        article cover (local path or http(s) URL; kept out of the body,
#                      set as cover after the draft is created)
#   --plaintext        degrade to plaintext mode
#   --force            upload as-is (rich) even when unfriendly
kaitox x list            # pending drafts on the relay
kaitox x status <id>     # status of one draft
```

The relay is started automatically by `push`. You can also manage it yourself: `kaitox relay --daemon` / `kaitox relay stop` / `kaitox relay status`. Until the packages are on npm, run the bin from the workspace (`node packages/cli/dist/kaitox.js ...`) or `npm link` it. The legacy top-level `kaitox push|list|status` still work but print a deprecation note and delegate to `kaitox x ...`.

Configuration: `KAITOX_HOME` (default `~/.kaitox`), `KAITOX_RELAY_PORT` (default `8765`); the relay binds to `127.0.0.1` only. An optional per-install token in `~/.kaitox/config.json` is enforced as the `x-kaitox-token` header (`GET /health` exempt).

### 2. Load the Chrome extension

`chrome://extensions` → enable "Developer mode" → "Load unpacked" → select `apps/extension/dist/`.
Then open <https://x.com/compose/articles>; the kaitox panel appears in the corner → click "上传草稿" (upload draft).

### 3. (Optional) Install the Obsidian plugin

Copy `apps/obsidian/dist/` into your vault at `.obsidian/plugins/kaitox/` and enable it in Settings. Use the command palette or ribbon action to sync the current note as an X Article draft. Set a cover via frontmatter: `cover: [[image.png]]` (relative paths and http(s) URLs also work). Desktop only — the plugin talks to the local relay.

## Integrate kaitox into your own tools

Any program that can POST JSON to `127.0.0.1` can be an upload client, and the relay's REST surface is small and stable:

- [`docs/integrate-local-service.md`](docs/integrate-local-service.md) — post draft bundles to the relay from your own script or service (with `@kaitox/relay-protocol` or plain HTTP).
- [`docs/integrate-browser-extension.md`](docs/integrate-browser-extension.md) — how the extension side works, and how to build your own uploader on `@kaitox/x-article`.

## Key invariants (keep these when changing code)

- `bundle.assets[].src` must exactly equal the output of `collectImageSources(markdown)` — both ends align on it.
- Cover images use the sentinel src `'__cover__'` and travel in the wire assets under `cover.fileName`; they never appear in the body.
- A bundle without `kind` means `'x-article'`. The relay stores and forwards `kind` without interpreting it — that is how future features slot in.
- The bundle carries raw Markdown, never a prebuilt `content_state` (media_ids only exist after upload from the logged-in page).
- Engine invariants (string `media_id`s, UTF-16 offsets, globally incrementing entity keys, `local_media_id === key`, `media_category=tweet_image`) are guaranteed by `@kaitox/x-article`; `packages/x-article/test/validate.mjs` is the regression baseline.

## Known limitations

- **queryId rotation**: X rotates the queryIds of `ArticleEntityDraftCreate` and friends. The extension resolves in order: manual override in its settings → built-in constants. When creation starts failing, update the queryId in the extension settings.
- **`extractRestId` fragility**: the response shape of draft creation changes with X; the `rest_id` extraction is a loose probe. If it comes back empty the extension stays on the drafts page and tells you to find the created draft in your article list.
- **Obsidian is desktop-only**: mobile Obsidian has no Node and cannot reach a local relay.
- **Compliance**: this drives your own logged-in browser session against X's private web endpoints. It is unofficial, may break at any time when X rotates queryIds, and is automation of your own account — use at your own risk, keep the frequency low, and do not mass-automate across accounts. Mind X's automation policy and rate limits.

## Learn more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — component map, lifecycle of a draft, design decisions.
- [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md) — the full data model, Markdown → `content_state` mapping rules, and pitfalls.

## License

[MIT](LICENSE)
