# Kaitox Architecture

Contributor/maintainer documentation for the Kaitox monorepo. For user-facing
setup see the [root README](../README.md); for the X Article wire details see
[x-article-publish-protocol.md](./x-article-publish-protocol.md).

Kaitox is a personal toolkit: a family of products — the `kaitox` CLI, an
Obsidian plugin, a Chrome extension (MV3), and agent skills under `skills/` —
on shared local infrastructure (the relay and its wire protocol). Features cut
across products; publishing Markdown as X (Twitter) Article drafts is the
first feature, and more features slot in later via the `kind` discriminator
on draft bundles.

The data flow for the X feature:

```
CLI / Obsidian / your service          local relay              Chrome extension (MV3)
        │                          http://127.0.0.1:8765        on x.com/compose/articles
        │  POST /x-article/drafts          │                            │
        │  raw Markdown + image bytes      │                            │
        │  (base64, single JSON)           │                            │
        ├─────────────────────────────────▶│  ~/.kaitox/outbox/<id>/    │
        │                                  │    bundle.json             │
        │                                  │    assets/<fileName>       │
        │                                  │◀──── polls every 5s ──────┤
        │                                  │  GET /x-article/drafts     │
        │                                  │  GET assets (bytes)        │
        │                                  │                            │ on click: uploads images +
        │                                  │◀─ PATCH /x-article/… ─────┤ creates the Article draft
        │                                  │      done/failed           │ with the page's own session
```

The bundle deliberately carries **raw Markdown, not a prebuilt
`content_state`** — image `media_id`s only exist after the extension uploads
the bytes from the logged-in x.com page, so the Markdown → `content_state`
conversion has to happen there.

> **Compliance note.** The publish step drives the user's own logged-in
> browser session against X's private web endpoints. This is unofficial, may
> break whenever X rotates queryIds, and must not be used for mass
> automation. Keep this framing in any docs that tell users to publish.

## 1. Repo layout

```
kaitox/
├── packages/
│   ├── relay-protocol/      # @kaitox/relay-protocol — zero-dep wire contract:
│   │                        #   DraftBundle types, RelayClient, HttpRelayClient, base64 helpers
│   ├── x-article/           # @kaitox/x-article — X engine: Markdown → content_state,
│   │                        #   XArticleClient, publishXArticle, style checker, plaintext fallback
│   ├── relay/               # @kaitox/relay — local relay server on 127.0.0.1,
│   │                        #   re-encodes oversized images at ingest, bin: kaitox-relay (start|dev|stop|status|restart)
│   └── cli/                 # @kaitox/cli — bin: kaitox (kaitox x push|list|status, kaitox relay ...)
├── apps/
│   ├── extension/           # Chrome extension (MV3), private — polls the relay on
│   │                        #   x.com/compose/articles and uploads drafts on click
│   └── obsidian/            # Obsidian plugin, private — pushes the current note to the relay
├── skills/
│   └── x-article/SKILL.md   # agent skill: teaches coding agents to drive kaitox x push
├── test/
│   ├── integration.mjs             # end-to-end suite: in-process relay + mocked X API
│   └── relay-protocol.smoke.mjs    # protocol-only smoke, uses relay-protocol like a third party
├── docs/
│   ├── ARCHITECTURE.md             # this file
│   ├── integrate-local-service.md      # push drafts from your own service
│   ├── integrate-browser-extension.md  # build your own relay consumer/uploader
│   └── x-article-publish-protocol.md  # X private-API wire protocol notes
├── .changeset/              # changesets config (apps are ignored, packages release together)
└── .github/workflows/       # ci.yml (build + all tests, Node 20/22), release.yml (changesets publish)
```

All four `packages/*` are publishable to npm (ESM-only, Node >= 18, MIT;
versions are managed by changesets — see each package.json; first publish
pending). `apps/*` are private and never published.

## 2. Layering rule

**State as law:**

- `@kaitox/relay-protocol` imports **nothing** from the workspace.
- `@kaitox/x-article` depends on `relay-protocol` for wire types only
  (currently `StyleIssue`/`StyleReport` in
  [`packages/x-article/src/styleCheck.ts`](../packages/x-article/src/styleCheck.ts)).
- `@kaitox/relay` depends on `relay-protocol`.
- `@kaitox/cli` depends on all three.
- `apps/*` are leaves (they depend on `relay-protocol` + `x-article`, nothing
  depends on them).

```
                 ┌────────────────────────┐
                 │ @kaitox/relay-protocol │   imports nothing from the workspace
                 └────────▲──────▲────────┘
                          │      │
            ┌─────────────┘      └─────────────┐
   ┌────────┴─────────┐               ┌────────┴──────┐
   │ @kaitox/x-article │               │ @kaitox/relay │
   └────────▲─────────┘               └────────▲──────┘
            │                                  │
            └───────────────┬──────────────────┘
                    ┌───────┴──────┐
                    │ @kaitox/cli  │   depends on all three
                    └──────────────┘

   apps/extension, apps/obsidian ──▶ relay-protocol + x-article   (leaves)
```

Why: it prevents dependency cycles, and it keeps the protocol consumable
standalone — a third-party pusher installs `@kaitox/relay-protocol` alone and
gets the full wire contract with zero transitive dependencies. This is also
why the protocol smoke test lives at the repo root
([`test/relay-protocol.smoke.mjs`](../test/relay-protocol.smoke.mjs)) instead
of inside the package: the package must never grow even a devDependency back
onto `@kaitox/relay`.

The root `build`/`typecheck` scripts in [`package.json`](../package.json)
enumerate the packages in dependency order (`relay-protocol` → `x-article` →
`relay` → `cli`); keep that order when adding packages.

## 3. Hard invariants

Break any of these and drafts silently stop uploading. Each is listed with the
code sites that define, produce, and consume it.

### 3.1 `assets[].src` must exactly equal the output of `collectImageSources(markdown)`

- Contract: [`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts)
  (`DraftAsset.src` doc comment — "这是最关键的不变量").
- Producers: [`packages/cli/src/bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts)
  and [`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts) iterate
  `collectImageSources(markdown)` and store each resolved `src` **verbatim**.
- Consumers: [`packages/x-article/src/publishArticle.ts`](../packages/x-article/src/publishArticle.ts)
  re-runs `collectImageSources` on the bundle's Markdown, and
  [`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts)
  resolves each reported `src` back to a bundle asset by **exact string
  equality** (`draft.assets.find((a) => a.src === src)`) before fetching the
  bytes from the relay.

Never normalize, decode, or rewrite the src on one side only — a mismatched
asset is orphaned and the image gets skipped. `collectImageSources` lives in
[`packages/x-article/src/contentState.ts`](../packages/x-article/src/contentState.ts).

### 3.2 The `'__cover__'` sentinel

Cover images are not part of the article body: `bundle.cover` uses the
sentinel `src: '__cover__'`, is **not** in `bundle.assets`, and is **not**
referenced from the Markdown. Its bytes still travel in the wire `assets`
array and land on disk as `assets/<cover.fileName>` like any other asset.

- Produced: both producers ([`packages/cli/src/bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts)
  and [`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts)) call
  `makeCoverAsset()` from
  [`packages/x-article/src/pushHelpers.ts`](../packages/x-article/src/pushHelpers.ts)
  — the single place that emits
  `{ key: 'cover', src: '__cover__', fileName: 'cover-…', mime, bytes }`.
- Wire packing: `HttpRelayClient.postDraft` in
  [`packages/relay-protocol/src/relayClient.ts`](../packages/relay-protocol/src/relayClient.ts)
  appends the cover bytes to `wireAssets`.
- Consumed: [`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts)
  fetches the bytes via `getAsset(draft.id, cover.fileName)`; `publishXArticle`
  uploads the cover **after** the draft exists and sets it with the separate
  `ArticleEntityUpdateCoverMedia` mutation.

### 3.3 Kind-namespaced routes + `PostDraftWireBody` shape

All draft routes live under `/:kind/drafts...`, where the path segment is the
**verbatim `kind` string** — the relay treats it as an opaque parameter
(stores, filters, and matches it; never interprets it), so third-party kinds
get their own namespace with zero relay changes:

```
GET    /health                               infrastructure (token-exempt)
GET    /setting                              relay settings view — never returns the token value
PATCH  /setting                              body: { token?: string | null }
POST   /:kind/drafts                         body: PostDraftWireBody; kind stamped from the path
GET    /:kind/drafts                         server-side filtered by kind
GET    /:kind/drafts/:id
GET    /:kind/drafts/:id/assets/:fileName    raw binary
PUT    /:kind/drafts/:id/cover               body: SetCoverWireBody
PATCH  /:kind/drafts/:id                     body: { status, restId?, error? }
DELETE /:kind/drafts/:id
/drafts*                                     410 Gone (pre-v0.5 root routes; migration hint)
```

Kind path segments must match `/^[a-z0-9][a-z0-9-]*$/` and must not be a
reserved word (`health`, `setting`, `drafts`) — see `isValidKindSegment` in
[`packages/relay-protocol/src/validate.ts`](../packages/relay-protocol/src/validate.ts).

`POST /:kind/drafts` is a **single JSON document** with base64 assets:

```ts
// packages/relay-protocol/src/relayClient.ts
interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}
```

This is deliberate: the relay decodes base64 to binary at write time and needs
no multipart parser — it stays on pure Node builtins. The asset **download**
direction (`GET /:kind/drafts/:id/assets/:fileName`) returns raw binary because
that is the hot, bandwidth-sensitive path for the extension.

Request bodies are validated at the boundary by the zero-dep wire validators
exported from `relay-protocol` (`validatePostDraftWireBody` and friends in
[`validate.ts`](../packages/relay-protocol/src/validate.ts) — the executable
form of this contract); the relay rejects malformed bodies with
`400 { error, issues }` where each issue carries a JSONPath-style location.
The validators are deliberately lenient: unknown fields and unknown (higher)
`schemaVersion`s pass through, and the open strings `kind`/`source` are not
constrained. Routing lives in
[`packages/relay/src/server.ts`](../packages/relay/src/server.ts), storage in
[`packages/relay/src/storage.ts`](../packages/relay/src/storage.ts).

### 3.4 `kind` absent = `'x-article'`

- Type: `DraftKind` in [`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts).
  v0.2 bundles on disk predate the field, so absence must keep meaning
  `'x-article'` forever.
- **Read side: always use the canonical accessor `draftKind(bundle)`**
  (exported from `relay-protocol`) instead of open-coding
  `b.kind ?? 'x-article'`.
- Since the kind-namespaced routes (3.3), **new bundles always have `kind`**:
  the relay stamps it from the path segment on `POST /:kind/drafts`
  ([`packages/relay/src/storage.ts`](../packages/relay/src/storage.ts)), and a
  body whose `bundle.kind` disagrees with the route is rejected with 400.
  Absence only remains possible on legacy disk bundles, which `draftKind()`
  classifies as `'x-article'` (so they appear under `/x-article/drafts`).
- The relay still **never interprets** the kind value — it stores, filters,
  and matches it as an opaque string.
- Consumers no longer filter client-side: `HttpRelayClient` is kind-scoped
  (constructor option, default `'x-article'`) and the server filters
  `GET /:kind/drafts`.

### 3.5 Default port 8765: one constant + the static extension manifest

The single source of truth is `DEFAULT_RELAY_PORT` / `DEFAULT_RELAY_BASE` in
[`packages/relay-protocol/src/relayClient.ts`](../packages/relay-protocol/src/relayClient.ts).
Every runtime consumer imports it: the relay's `DEFAULT_PORT`
([`packages/relay/src/config.ts`](../packages/relay/src/config.ts), overridable
via `KAITOX_RELAY_PORT`), the extension
([`apps/extension/src/xsession.ts`](../apps/extension/src/xsession.ts)
re-exports it), and the Obsidian plugin
([`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts)).

The one remaining duplicate is
[`apps/extension/manifest.json`](../apps/extension/manifest.json)
(`host_permissions`: `http://127.0.0.1:8765/*`, `http://localhost:8765/*`) —
it must stay static JSON that Chrome and store tooling can read verbatim.
The extension build ([`apps/extension/esbuild.mjs`](../apps/extension/esbuild.mjs))
**fails if the manifest and the constant disagree**, so changing the default
port means changing the constant and the manifest; the build catches a miss.
The host is always `127.0.0.1` — the relay never binds a public interface.

### 3.6 UTF-16 offsets in `content_state`

`offset`/`length` in inline styles and entity ranges are JS string indices —
**UTF-16 code units** — so a CJK character counts as 1, and characters outside
the BMP (emoji) count as 2. Defined in
[`packages/x-article/src/types.ts`](../packages/x-article/src/types.ts) and
[`packages/x-article/src/contentState.ts`](../packages/x-article/src/contentState.ts);
truth-tested (including a CJK bold-offset case) in
[`packages/x-article/test/validate.mjs`](../packages/x-article/test/validate.mjs).
Do not count Unicode code points or grapheme clusters.

### 3.7 `schemaVersion` policy

`DraftBundle.schemaVersion` is a plain `number`; the current value is the
`SCHEMA_VERSION` constant in
[`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts)
(read via `bundleSchemaVersion(b)` — absent on v0.2 disk bundles means 1).
The rules:

- **Additive changes never bump** the version (the wire validators tolerate
  unknown fields for exactly this reason).
- **Incompatible changes bump `SCHEMA_VERSION`** — and only then do
  migration/upgrader functions get written (none exist today; don't add dead
  machinery early).
- **Consumers must refuse versions greater than they know** with a clear
  error rather than misparse.
- **The relay stores any version blindly** — refusing is the consumer's job;
  the relay stays content-agnostic.

## 4. Adding a feature (worked example: `linkedin`)

The toolkit is designed so a new feature touches almost nothing that
exists. Suppose you want `kaitox linkedin push`:

1. **New engine package `packages/linkedin`** — the analogue of
   `packages/x-article`: converts Markdown into whatever the target needs and
   talks to the target's API. It may depend on `@kaitox/relay-protocol` for
   wire types only (never on `relay` or `cli`). Add it to the root
   `build`/`typecheck` chains in [`package.json`](../package.json) in
   dependency order, and to the `npm pack --dry-run` loop in
   [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) if it will be
   published.
2. **Push side reuses `relay-protocol` unchanged** — build a kind-scoped
   client and post:
   `new HttpRelayClient(base, { kind: 'linkedin' }).postDraft({ title, markdown, mode, source, assets, ... })`.
   Raw Markdown plus image bytes, same shape as today; the draft lands under
   `/linkedin/drafts`.
3. **Relay: no changes.** The kind namespace comes from the URL path segment
   and the relay treats it as an opaque string (invariants 3.3/3.4). Every
   route already works for the new kind — the only constraint is the path
   segment rule (`/^[a-z0-9][a-z0-9-]*$/`, not a reserved word).
4. **CLI:** add `packages/cli/src/commands/linkedin.ts` exporting
   `runLinkedin(args: string[])`, then add **one entry** to the `FEATURES`
   dispatch table in [`packages/cli/src/kaitox.ts`](../packages/cli/src/kaitox.ts):

   ```ts
   const FEATURES: Record<string, Command> = {
     x: { run: runX, summary: 'X (Twitter) Article publishing — push / list / status' },
     linkedin: { run: runLinkedin, summary: 'LinkedIn drafts — push / list / status' },
   };
   ```

   That yields `kaitox linkedin push|list|status ...`, and the help output is
   generated from the table — nothing else to update.
5. **Consumer:** whatever delivers the draft (a browser extension, a script)
   polls `GET /linkedin/drafts` — server-side filtered, no client-side kind
   filter needed. Multiple features coexist on one relay, each in its own
   route namespace.

Exact extension points, in summary:

- `FEATURES` table in `packages/cli/src/kaitox.ts` (one line; help is
  generated from it).
- New `packages/cli/src/commands/<feature>.ts`.
- New engine package `packages/<feature>`.
- `kind` on the `HttpRelayClient` constructor (no type change needed —
  `DraftKind` is open: `'x-article' | (string & {})`; the route namespace
  follows automatically).
- A consumer polling `GET /<kind>/drafts`.
- A skill under `skills/<feature>/SKILL.md` if agents should drive the
  feature (plus a catalog row in [`skills/README.md`](../skills/README.md)).
- A changeset for the release (section 6).

## 5. Testing

Three suites, all runnable offline (the X API is always mocked):

| Suite | Location | Covers | Run |
| --- | --- | --- | --- |
| Wire validator test | [`packages/relay-protocol/test/validate.mjs`](../packages/relay-protocol/test/validate.mjs) | The zero-dep wire validators (issue paths for malformed bodies, forward-compat leniency, kind path-segment rules); imports only the package's own dist — never `@kaitox/relay` | `npm test` (root; runs `-w @kaitox/relay-protocol` first) |
| Conversion truth test | [`packages/x-article/test/validate.mjs`](../packages/x-article/test/validate.mjs) | `markdownToContentState` against expected ground truth (headings, inline styles, CJK UTF-16 offsets, `collectImageSources`, `sanitizeContentState`, `deriveTitle`) | `npm test` (root; delegates to `-w @kaitox/x-article`) |
| Integration | [`test/integration.mjs`](../test/integration.mjs) | End-to-end with an in-process relay: relay CRUD incl. cover bytes, path-traversal guard, custom-`kind` round-trip + cross-kind isolation, boundary validation (400 + issue paths, 410 on legacy routes), `GET`/`PATCH /setting` + live token rotation, `done` → `sent` move; the extension upload pipeline with the X API mocked (correct `content_state`, cover uploaded after draft creation via `ArticleEntityUpdateCoverMedia`); `checkMarkdownStyle` + plaintext-fallback invariants | `npm run test:integration` |
| Protocol smoke | [`test/relay-protocol.smoke.mjs`](../test/relay-protocol.smoke.mjs) | Only `@kaitox/relay-protocol`'s public exports (kind-scoped `HttpRelayClient`, `RelayHttpError`, base64 helpers) against an in-process relay, exactly as a third-party integration would use them; third-party `kind`/`source` pass-through and namespace isolation | `npm run test:protocol` |

Everything at once (build first, then all three):

```bash
npm run test:all
```

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs build,
typecheck, all three suites on Node 20 and 22, builds both apps, and runs
`npm pack --dry-run` for each publishable package to catch `files`/exports
mistakes.

Manual CLI smoke (isolated home + port so your real `~/.kaitox` stays clean):

```bash
npm run build
export KAITOX_HOME=$(mktemp -d) KAITOX_RELAY_PORT=8799
node packages/cli/dist/kaitox.js --version
node packages/cli/dist/kaitox.js relay --daemon
node packages/cli/dist/kaitox.js x push README.md --title "Smoke test"
node packages/cli/dist/kaitox.js x list
node packages/cli/dist/kaitox.js relay status
node packages/cli/dist/kaitox.js relay stop
```

(`kaitox x push` auto-starts the relay if it is not running, so the explicit
`relay --daemon` step is optional.)

## 6. Releasing

Releases use [changesets](https://github.com/changesets/changesets). The four
`packages/*` are versioned together as needed; `@kaitox/extension` and
`@kaitox/obsidian` are ignored in
[`.changeset/config.json`](../.changeset/config.json) and never published.

Flow:

1. On your feature branch: `npx changeset` — pick the affected packages and a
   bump level, write the changelog entry, commit the generated
   `.changeset/*.md` file with your change.
2. Version bump: `npx changeset version` (root script: `npm run version`).
   This rewrites package versions and changelogs, and bumps internal
   dependency ranges (`updateInternalDependencies: "patch"`).
3. Publish: `npm run release` — builds, runs `test:all`, then
   `changeset publish` with `access: public`.

In CI, [`.github/workflows/release.yml`](../.github/workflows/release.yml)
automates steps 2–3 via `changesets/action`: on push to `main` it opens (or
updates) a "Version Packages" PR, and publishes when that PR merges. The
workflow is **inert today** — it requires:

- the GitHub repo to exist at `https://github.com/kuangjiajia/kaitox-toolkit` (pending
  creation), and
- an `NPM_TOKEN` repository secret with publish rights, and
- the npm org **`kaitox`** to exist, since all packages live under the
  `@kaitox` scope (each package also sets `publishConfig.access: public`).

## 7. Language & naming policy

- **Published surfaces are English**: package READMEs, docs under `docs/`,
  CLI `--help` output, npm package descriptions, and manifests.
- **Every README ships a Chinese mirror**: each `README.md` has a
  `README.zh-CN.md` next to it, linked via a switcher line at the top of both
  (`English | [简体中文](README.zh-CN.md)` / `[English](README.md) | 简体中文`).
  Keep the two in sync when editing either.
- **Legacy Chinese code comments stay as-is** — do not bulk-translate them;
  they carry design context (see `packages/relay-protocol/src/bundle.ts`).
- **App UI strings are currently Chinese** (extension panel, Obsidian
  settings). That is acceptable while `apps/*` are private; revisit before any
  public distribution.
- **New code comments are written in English.**
- **Casing**: "Kaitox" (capital K) in prose, brand contexts, manifests, and
  package descriptions; lowercase "kaitox" only for machine names — the CLI
  command, npm names under the `@kaitox` scope, directory names, `~/.kaitox`,
  and environment variables.
