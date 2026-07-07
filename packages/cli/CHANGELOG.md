# @kaitox/cli

## 0.4.0

### Minor Changes

- 4043dc2: Harden `restart` and expose it through the main CLI. `kaitox relay restart` (new) and `kaitox-relay restart` now kill whatever holds the relay port — graceful pidfile SIGTERM first, then a port sweep via `lsof`/`netstat` that catches orphan processes whose pidfile is missing or stale (SIGTERM, then SIGKILL after a grace period) — before starting the daemon again. `@kaitox/relay` exports the sweep as `killPortOccupants()`.

### Patch Changes

- Kind-namespaced relay routes, wire validators, and a hardened protocol surface.

  **Breaking (pre-first-publish):** draft routes moved from `/drafts...` to `/:kind/drafts...` — the path segment is the verbatim `kind` string, treated as opaque by the relay (stored, filtered, matched; never interpreted), so third-party kinds get their own namespace with zero relay changes. Old root routes return `410 Gone` with a migration hint. Kind segments must match `/^[a-z0-9][a-z0-9-]*$/` and not be a reserved word (`health`, `setting`, `drafts`).

  - `HttpRelayClient` is now kind-scoped (`new HttpRelayClient(base, { kind })`, default `'x-article'`); all methods hit `/:kind/drafts...`. Non-2xx responses throw the new `RelayHttpError` (with `method`/`url`/`status`/`body`) so consumers can branch programmatically.
  - New zero-dep wire validators exported from `@kaitox/relay-protocol` (`validatePostDraftWireBody`, `validateSetCoverWireBody`, `validateAckPatch`, `validateSettingPatch`, `isValidKindSegment`): the relay now rejects malformed bodies with `400 { error, issues }` (JSONPath-style issue locations) instead of persisting garbage, and JSON syntax errors return 400 instead of 500. Deliberately lenient: unknown fields, higher `schemaVersion`s, and custom `kind`/`source` values pass through.
  - New relay settings endpoints: `GET /setting` (`{ port, version, tokenConfigured }` — never the token value) and `PATCH /setting` (`{ token?: string | null }`, takes effect immediately without restart).
  - `POST /:kind/drafts` stamps `kind` from the path — new bundles always carry `kind`; a body whose `bundle.kind` disagrees with the route is rejected. `GET /:kind/drafts` filters server-side (legacy no-kind bundles classify as `x-article` via the new canonical accessor `draftKind()`); cross-kind access to a draft 404s.
  - New exports: `draftKind()`, `DEFAULT_DRAFT_KIND`, `SCHEMA_VERSION`, `bundleSchemaVersion()`, `DEFAULT_RELAY_PORT`, `DEFAULT_RELAY_BASE`. `DraftBundle.schemaVersion` widened from the literal `1` to `number` (policy: additive changes never bump; consumers must refuse unknown higher versions; the relay stores any version blindly).

- Shared push-side helpers and compile-time exhaustiveness for the content model.

  - New `pushHelpers` module (exported from the package root): `parseFrontmatter`, `safeFileName`, `guessMimeFromName`, `baseName`, and `makeCoverAsset` — the single producer of the `'__cover__'` sentinel + `cover-` file-name convention. The CLI's `bundleBuilder` and the Obsidian plugin now share these instead of maintaining diverged copies; as a side effect, `kaitox x push` now honors a frontmatter `cover:` field when `--cover` is not given (previously Obsidian-only).
  - Content-model exhaustiveness: new `BLOCK_TYPES` / `INLINE_STYLES` / `ENTITY_TYPES` coverage maps and an `assertNever` helper; the preview renderer's silent `default: return ''` branches are gone — adding a union member now fails compilation (and a new truth test) until every consumer site is updated, instead of silently dropping content. `sanitizeContentState`'s inline-style whitelist is derived from the coverage map so it can no longer drift.

- Updated dependencies
- Updated dependencies [4043dc2]
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [4043dc2]
- Updated dependencies [4043dc2]
- Updated dependencies [4043dc2]
  - @kaitox/relay-protocol@0.5.0
  - @kaitox/relay@0.5.0
  - @kaitox/x-article@0.5.0

## 0.3.1

### Patch Changes

- Reposition Kaitox as a personal toolkit: the CLI, Obsidian plugin, Chrome extension, and agent skills are each one product of the toolkit, and X (Twitter) Article publishing is the first feature that cuts across them. READMEs, package descriptions, manifests, CLI help text, and architecture docs are reworded accordingly. The agent skill moved from `packages/cli/skills/` to the repo-root `skills/` directory (it no longer ships inside the `@kaitox/cli` npm tarball). Every README now ships in both English and Chinese (`README.md` + `README.zh-CN.md`), and the two apps gained READMEs of their own.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.4.0
  - @kaitox/relay@0.4.0
  - @kaitox/x-article@0.4.0
