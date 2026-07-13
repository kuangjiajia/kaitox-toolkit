# @kaitox/relay

## 0.6.1

### Patch Changes

- 3ba09ce: Add X Article auto-upload handoff URL messaging and keep package versions aligned.
- Updated dependencies [3ba09ce]
  - @kaitox/relay-protocol@0.5.2

## 0.6.0

### Minor Changes

- Kind-namespaced relay storage: draft bundles now live under `~/.kaitox/<kind>/{outbox,sent}` (e.g. `~/.kaitox/x-article/outbox`) instead of a shared `~/.kaitox/{outbox,sent}`. Storage APIs take an explicit `kind` and cross-namespace isolation comes from the directory layout itself. Docs and READMEs refreshed across all packages (extension screenshots, install flow, skill rename to `kaitox-x-article`).

### Patch Changes

- Updated dependencies
  - @kaitox/relay-protocol@0.5.1

## 0.5.0

### Minor Changes

- Re-cropping a cover now starts from the original image instead of the previous crop.

  Previously the crop result destructively overwrote the only stored cover bytes, so every subsequent "crop" could only zoom further into the last crop. The draft bundle now keeps the pre-crop source alongside the cropped cover:

  - `DraftBundle` gains optional `coverOriginal?: DraftAsset` (additive; no `schemaVersion` bump).
  - `SetCoverInput` / `SetCoverWireBody` gain optional `original` (same `{fileName, mime, bytes/base64}` shape as the cover). When present, the relay persists it as `assets/cover-original-<name>` and updates `bundle.coverOriginal`; when absent (a re-crop), the existing original is kept untouched. Old relays ignore the field; old clients are unaffected.
  - Relay cleanup of replaced cover files now uses a referenced-set check covering both the cover and the original, so swapping covers also removes the stale original.
  - The browser extension sends the original alongside the cropped result when a new image is picked, and the detail page's "裁切" button feeds `coverOriginal` (falling back to the current cover for drafts created before this change or pushed via CLI/Obsidian) into the crop modal.

  The original never enters `assets[]` and is never uploaded to X — it exists only as the re-crop source.

- Kind-namespaced relay routes, wire validators, and a hardened protocol surface.

  **Breaking (pre-first-publish):** draft routes moved from `/drafts...` to `/:kind/drafts...` — the path segment is the verbatim `kind` string, treated as opaque by the relay (stored, filtered, matched; never interpreted), so third-party kinds get their own namespace with zero relay changes. Old root routes return `410 Gone` with a migration hint. Kind segments must match `/^[a-z0-9][a-z0-9-]*$/` and not be a reserved word (`health`, `setting`, `drafts`).

  - `HttpRelayClient` is now kind-scoped (`new HttpRelayClient(base, { kind })`, default `'x-article'`); all methods hit `/:kind/drafts...`. Non-2xx responses throw the new `RelayHttpError` (with `method`/`url`/`status`/`body`) so consumers can branch programmatically.
  - New zero-dep wire validators exported from `@kaitox/relay-protocol` (`validatePostDraftWireBody`, `validateSetCoverWireBody`, `validateAckPatch`, `validateSettingPatch`, `isValidKindSegment`): the relay now rejects malformed bodies with `400 { error, issues }` (JSONPath-style issue locations) instead of persisting garbage, and JSON syntax errors return 400 instead of 500. Deliberately lenient: unknown fields, higher `schemaVersion`s, and custom `kind`/`source` values pass through.
  - New relay settings endpoints: `GET /setting` (`{ port, version, tokenConfigured }` — never the token value) and `PATCH /setting` (`{ token?: string | null }`, takes effect immediately without restart).
  - `POST /:kind/drafts` stamps `kind` from the path — new bundles always carry `kind`; a body whose `bundle.kind` disagrees with the route is rejected. `GET /:kind/drafts` filters server-side (legacy no-kind bundles classify as `x-article` via the new canonical accessor `draftKind()`); cross-kind access to a draft 404s.
  - New exports: `draftKind()`, `DEFAULT_DRAFT_KIND`, `SCHEMA_VERSION`, `bundleSchemaVersion()`, `DEFAULT_RELAY_PORT`, `DEFAULT_RELAY_BASE`. `DraftBundle.schemaVersion` widened from the literal `1` to `number` (policy: additive changes never bump; consumers must refuse unknown higher versions; the relay stores any version blindly).

- 4043dc2: Transparently re-encode oversized images at ingest. X's media upload rejects images over 5MB (`maxFileSizeExceeded`); the relay now fits them silently when drafts are saved (`POST /drafts`) or covers are set (`PUT /drafts/:id/cover`): opaque images become JPEG (white background, quality 90), images with transparency become WebP, stepping the dimensions down until the result fits. GIF/SVG and in-limit images pass through untouched, and any processing failure falls back to the original bytes. Bundle asset metadata (`mime`, `bytesLen`) reflects the stored bytes. Adds `sharp` as a dependency — the relay is no longer zero-dep.
- 4043dc2: Harden `restart` and expose it through the main CLI. `kaitox relay restart` (new) and `kaitox-relay restart` now kill whatever holds the relay port — graceful pidfile SIGTERM first, then a port sweep via `lsof`/`netstat` that catches orphan processes whose pidfile is missing or stale (SIGTERM, then SIGKILL after a grace period) — before starting the daemon again. `@kaitox/relay` exports the sweep as `killPortOccupants()`.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.5.0

## 0.4.0

### Minor Changes

- Add cover upload: new `PUT /drafts/:id/cover` relay endpoint and `RelayClient.setCover()` (with `SetCoverInput` / `SetCoverWireBody` types). The Chrome extension's draft box uses it to set or replace a draft's cover image from the detail panel; the relay persists the bytes under `assets/cover-<fileName>` and updates `bundle.cover`.

### Patch Changes

- Fix `GET /drafts` losing uploaded drafts: `listDrafts()` now also scans the `sent/` directory, so drafts acked as `done` stay in the list (with `status: 'done'`) instead of vanishing. This is what the Chrome extension's 已上传 tab relies on; badge-style consumers that only want actionable drafts should keep filtering by `status !== 'done'`.
- Reposition Kaitox as a personal toolkit: the CLI, Obsidian plugin, Chrome extension, and agent skills are each one product of the toolkit, and X (Twitter) Article publishing is the first feature that cuts across them. READMEs, package descriptions, manifests, CLI help text, and architecture docs are reworded accordingly. The agent skill moved from `packages/cli/skills/` to the repo-root `skills/` directory (it no longer ships inside the `@kaitox/cli` npm tarball). Every README now ships in both English and Chinese (`README.md` + `README.zh-CN.md`), and the two apps gained READMEs of their own.
- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.4.0
