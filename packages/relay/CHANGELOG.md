# @kaitox/relay

## 0.4.0

### Minor Changes

- Add cover upload: new `PUT /drafts/:id/cover` relay endpoint and `RelayClient.setCover()` (with `SetCoverInput` / `SetCoverWireBody` types). The Chrome extension's draft box uses it to set or replace a draft's cover image from the detail panel; the relay persists the bytes under `assets/cover-<fileName>` and updates `bundle.cover`.

### Patch Changes

- Fix `GET /drafts` losing uploaded drafts: `listDrafts()` now also scans the `sent/` directory, so drafts acked as `done` stay in the list (with `status: 'done'`) instead of vanishing. This is what the Chrome extension's 已上传 tab relies on; badge-style consumers that only want actionable drafts should keep filtering by `status !== 'done'`.
- Reposition Kaitox as a personal toolkit: the CLI, Obsidian plugin, Chrome extension, and agent skills are each one product of the toolkit, and X (Twitter) Article publishing is the first feature that cuts across them. READMEs, package descriptions, manifests, CLI help text, and architecture docs are reworded accordingly. The agent skill moved from `packages/cli/skills/` to the repo-root `skills/` directory (it no longer ships inside the `@kaitox/cli` npm tarball). Every README now ships in both English and Chinese (`README.md` + `README.zh-CN.md`), and the two apps gained READMEs of their own.
- Updated dependencies
- Updated dependencies
  - @kaitox/relay-protocol@0.4.0
