English | [简体中文](README.zh-CN.md)

# @kaitox/extension

The browser product of the [Kaitox](../../README.md) personal toolkit (private, not published). A Chrome MV3 extension that executes the browser-side steps of features inside your own logged-in session. Current feature: upload pending **X (Twitter) Article drafts** from the local relay on `x.com/compose/articles`.

## How it works

The extension is the publishing end of the Kaitox pipeline — upload clients (the CLI, the Obsidian plugin, or your own service) only check and package; the extension does the part that needs a logged-in page:

1. A content script runs on `x.com/compose/articles*` and injects an "上传草稿" (upload draft) button into the Articles page header, next to the compose button. X redraws its header constantly, so a `MutationObserver` plus a low-frequency timer re-insert the button whenever it gets wiped.
2. The button's dropdown polls the local relay every 5 seconds and lists pending drafts (title, source, rich/plaintext mode, style-issue counts). It only shows bundles of kind `'x-article'` — other kinds are left for other consumers.
3. On click, it reads `ct0` from `document.cookie` (the page is logged in, so same-origin requests carry cookies automatically), fetches the draft's image bytes from the relay, and runs `publishXArticle` from [`@kaitox/x-article`](../../packages/x-article/README.md): upload each image (`INIT`/`APPEND`/`FINALIZE`) → `markdownToContentState` → `ArticleEntityDraftCreate` → optionally set the cover via `ArticleEntityUpdateCoverMedia`.
4. On success it acks the draft as `done` on the relay and navigates to `x.com/compose/articles/edit/<rest_id>`. If the `rest_id` cannot be extracted from X's response, the draft is still created — check your article list. Failures are acked as `failed` and can be retried from the panel.
5. A service worker separately polls the relay once a minute and shows the pending-draft count on the extension's toolbar badge.

Drafts can also be deleted from the dropdown (with an in-place confirmation).

## Build & load

From the repo root:

```bash
npm run build:extension   # bundles the extension → apps/extension/dist/
```

Then `chrome://extensions` → enable "Developer mode" → "Load unpacked" → select `apps/extension/dist/`. Open <https://x.com/compose/articles>; the button appears in the page header. The button's tooltip shows the build timestamp, so you can confirm which build is live after reloading.

## Settings

There is no options page yet. Settings are read from `chrome.storage.sync` with these keys and defaults:

| Key | Default | Purpose |
|---|---|---|
| `relayBase` | `http://127.0.0.1:8765` | Base URL of the local Kaitox relay. |
| `relayToken` | unset | If your relay enforces a token (`~/.kaitox/config.json`), set the same value; sent as the `x-kaitox-token` header. |
| `queryId` | built-in constant | Override for the `ArticleEntityDraftCreate` GraphQL queryId. X rotates these — when draft creation starts failing, set a fresh one here. |
| `coverQueryId` | built-in constant | Override for the `ArticleEntityUpdateCoverMedia` queryId. |

To set one, run e.g. `chrome.storage.sync.set({ queryId: '...' })` from the extension's service-worker console (`chrome://extensions` → "Inspect views").

## Compliance

Same caveat as the [root README](../../README.md#known-limitations): the upload drives your own logged-in x.com session against X's private web endpoints. It is unofficial, may break whenever X rotates queryIds or response shapes, and is automation of your own account — use at your own risk, keep the frequency low, and mind X's automation policy.

## Related

- [Root README](../../README.md) — the Kaitox toolkit and the full draft pipeline.
- [`@kaitox/x-article`](../../packages/x-article/README.md) — the engine this extension runs (converter, client, orchestration).
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.md) — the wire contract used to poll the relay.
- [`apps/obsidian`](../obsidian) — the Obsidian plugin that pushes drafts from your vault.
- [`docs/integrate-browser-extension.md`](../../docs/integrate-browser-extension.md) — build your own uploader on the same relay.
- [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md) — the full X wire protocol.
