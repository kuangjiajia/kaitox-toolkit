English | [简体中文](integrate-local-service.zh-CN.md)

# Push drafts to kaitox from your own local service

Kaitox's relay is a plain local HTTP server. The Kaitox CLI and Obsidian plugin are just two clients of it — anything that can speak HTTP to `http://127.0.0.1:8765` can queue drafts the same way. This guide shows how to push X (Twitter) Article drafts from your own Node service, script, or any other stack.

**When you'd do this**

- Your notes app or knowledge base wants a "send to X draft" button.
- Your static-site pipeline should queue an X Article draft for every new post it builds.
- An internal tool produces Markdown reports that someone occasionally publishes on X.

**How it fits together**

```text
your service ──POST /x-article/drafts──▶ local relay (127.0.0.1:8765)
                                             │  stores ~/.kaitox/outbox/<id>/
                                             ▼
                          Chrome extension on x.com/compose/articles
                          polls every 5s → on click, uploads images and
                          creates the Article draft in YOUR logged-in session
```

Draft routes are namespaced by `kind` (`/:kind/drafts...`): the path segment is
the verbatim kind string, the relay treats it as opaque, and each feature gets
its own namespace. `HttpRelayClient` handles this for you (it is kind-scoped,
default `'x-article'`).

The bundle you push carries **raw Markdown plus image bytes**, not a prebuilt X `content_state`. That is deliberate: image `media_id`s only exist after the extension uploads the images from the logged-in x.com page, so conversion has to happen there. The full pipeline is documented in [x-article-publish-protocol.md](./x-article-publish-protocol.md).

> **Compliance note.** Publishing drives the user's *own* logged-in browser session against X's private web endpoints. This is unofficial, may break whenever X rotates its GraphQL queryIds, and is at your own risk. Don't mass-automate posting with it.

## Prerequisites

- Node.js >= 18 for the Node walkthrough (global `fetch`; the packages are ESM-only).
- The relay running locally:

  ```bash
  npx @kaitox/relay start
  # or, if you have the CLI installed:
  kaitox relay --daemon
  ```

- For the consume side: the Kaitox Chrome extension installed, and a tab open on `https://x.com/compose/articles` while logged in to X. Your service only *queues* drafts; the extension is what turns them into X Article drafts.

Config knobs: the relay binds `127.0.0.1` only; port comes from `KAITOX_RELAY_PORT` (default `8765`); state lives under `KAITOX_HOME` (default `~/.kaitox`).

## Walkthrough (Node)

### 1. Install the protocol package

```bash
npm i @kaitox/relay-protocol @kaitox/x-article
```

[`@kaitox/relay-protocol`](../packages/relay-protocol/README.md) is the zero-dependency wire contract plus a fetch-based `HttpRelayClient`. [`@kaitox/x-article`](../packages/x-article/README.md) is only needed for `collectImageSources` (and optionally `deriveTitle`, `checkMarkdownStyle`, `toPlaintextMarkdown`).

### 2. Build a bundle from a Markdown string

> [!IMPORTANT]
> **The one invariant you must not break:** `assets[].src` must *exactly* equal the strings returned by `collectImageSources(markdown)` from `@kaitox/x-article` — same order of resolution happens on the extension side with the same function, and the two ends align purely on that raw `src` string. Do not normalize, URL-encode, resolve, or trim the src. Derive your asset list by calling `collectImageSources` (or by replicating its parsing byte-for-byte). An asset whose `src` doesn't match is silently never placed in the article.

```js
// buildAssets.mjs
import { readFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { collectImageSources } from '@kaitox/x-article';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const mimeOf = (p) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream';

/**
 * Turn every image reference in `markdown` into a DraftAssetInput
 * (key, src, fileName, mime, bytes). Local paths are resolved
 * relative to `baseDir`.
 */
export async function buildAssets(markdown, baseDir) {
  const srcs = collectImageSources(markdown); // the ONLY correct enumeration
  const taken = new Set();
  const assets = [];
  for (const src of srcs) {
    // Read the bytes however fits your app; here: local file relative to baseDir.
    const path = resolve(baseDir, decodeURIComponent(src));
    const bytes = new Uint8Array(await readFile(path));

    // fileName is just the relay's on-disk name — it must be unique per bundle
    // and contain no path separators. It does NOT need to match src.
    let fileName = basename(src).replace(/[^a-zA-Z0-9._-]/g, '_') || 'image.bin';
    while (taken.has(fileName)) fileName = `x-${fileName}`;
    taken.add(fileName);

    assets.push({ key: `img-${assets.length}`, src, fileName, mime: mimeOf(path), bytes });
  }
  return assets;
}
```

Remote images (`https://...` srcs) must be pre-downloaded by *your* side into `bytes` — the extension never fetches image URLs itself. If you want the plaintext fallback mode, run `toPlaintextMarkdown(markdown)` first, push the *result* as the bundle's markdown with `mode: 'plaintext'`, and derive assets from that final text so srcs still align.

The reference implementation of all of this (including remote download and frontmatter handling) is the CLI's [`bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts).

### 3. Post the draft

```js
// push.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import { deriveTitle } from '@kaitox/x-article';
import { buildAssets } from './buildAssets.mjs';

const mdPath = process.argv[2];
const markdown = await readFile(mdPath, 'utf8');
const assets = await buildAssets(markdown, dirname(resolve(mdPath)));

const relay = new HttpRelayClient(); // defaults to http://127.0.0.1:8765, kind-scoped to 'x-article'

const { id } = await relay.postDraft({
  title: deriveTitle(markdown) || basename(mdPath),
  markdown,
  mode: 'rich',                 // 'rich' | 'plaintext'
  source: 'my-service',         // free-form; recorded on the bundle for consumers
  sourceMeta: { path: resolve(mdPath) },
  assets,
});

console.log(`queued draft ${id}`);
```

`postDraft` generates the draft id, base64-encodes the bytes, and sends one JSON body — no multipart. On success the relay stores the bundle under `~/.kaitox/outbox/<id>/` with status `pending`.

### 4. Poll for the result

The draft lifecycle is `pending → uploading → done | failed` (the extension PATCHes the status as it works). Poll `getDraft`:

```js
async function waitForResult(relay, id, { intervalMs = 5000, timeoutMs = 600_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bundle = await relay.getDraft(id);
    if (bundle.status === 'done') return bundle;   // bundle.restId = the created article's rest_id
    if (bundle.status === 'failed') throw new Error(bundle.error ?? 'upload failed');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('timed out — was the draft consumed on x.com/compose/articles?');
}

const done = await waitForResult(relay, id);
console.log(`draft created, rest_id = ${done.restId}`);
```

Note: when a draft reaches `done` the relay moves it from `~/.kaitox/outbox/` to `~/.kaitox/sent/`. Both `GET /:kind/drafts/:id` and the `GET /:kind/drafts` listing still include it (with `status: 'done'`).

### 5. Optional: cover image

A cover doesn't appear in the Markdown body. It uses the sentinel src `'__cover__'`, and its bytes travel in the same wire `assets` array under `cover.fileName` — `HttpRelayClient` handles that automatically when you set `input.cover`:

```js
const coverBytes = new Uint8Array(await readFile('hero.jpg'));

const { id } = await relay.postDraft({
  // ...same as above...
  assets,
  cover: {
    key: 'cover',
    src: '__cover__',           // fixed sentinel — never a real path
    fileName: 'cover-hero.jpg', // must not collide with any body asset fileName
    mime: 'image/jpeg',
    bytes: coverBytes,
  },
});
```

Optionally you can also attach a `styleReport` (from `checkMarkdownStyle` in `@kaitox/x-article`) so `kaitox x list` shows warning counts for your drafts.

## Raw HTTP variant (any language)

For non-Node stacks, POST the `PostDraftWireBody` JSON directly. You must generate the draft id yourself (a UUID is ideal; the relay sanitizes ids to `[a-zA-Z0-9_-]`). Exact shape:

```json
{
  "bundle": {
    "schemaVersion": 1,
    "id": "3f6c2f4e-9a1b-4c8d-b7e2-0d5f6a7b8c9d",
    "kind": "x-article",
    "title": "Hello from my service",
    "markdown": "# Hello\n\nSome text.\n\n![diagram](./diagram.png)\n",
    "mode": "rich",
    "assets": [
      {
        "key": "img-0",
        "src": "./diagram.png",
        "fileName": "diagram.png",
        "mime": "image/png",
        "bytesLen": 48213
      }
    ],
    "cover": {
      "key": "cover",
      "src": "__cover__",
      "fileName": "cover-hero.jpg",
      "mime": "image/jpeg",
      "bytesLen": 91520
    },
    "createdAt": "2026-07-06T12:00:00.000Z",
    "source": "my-service",
    "sourceMeta": { "pipeline": "blog-build" }
  },
  "assets": [
    { "fileName": "diagram.png", "mime": "image/png", "base64": "iVBORw0KGgo..." },
    { "fileName": "cover-hero.jpg", "mime": "image/jpeg", "base64": "/9j/4AAQSkZJRg..." }
  ]
}
```

Rules recap: `bundle.assets[].src` must equal `collectImageSources(bundle.markdown)` output exactly; the top-level `assets` array carries the actual bytes (base64) keyed by `fileName`, including the cover's bytes; `cover` is optional; `bundle.kind` is optional but if present must equal the route's kind segment (the relay stamps the path kind onto the stored bundle either way); `bundle.status` / `restId` / `error` must be omitted — the relay owns those. Malformed bodies are rejected with `400 { error, issues }` where each issue has a JSONPath-style location.

```bash
# Build the base64 payloads (tr strips GNU coreutils' line wrapping):
B64_DIAGRAM=$(base64 < diagram.png | tr -d '\n')
B64_COVER=$(base64 < hero.jpg | tr -d '\n')
# ...substitute them into draft.json, then:

curl -sS -X POST http://127.0.0.1:8765/x-article/drafts \
  -H 'content-type: application/json' \
  --data @draft.json
# → 201 {"id":"3f6c2f4e-9a1b-4c8d-b7e2-0d5f6a7b8c9d"}

# Poll:
curl -sS http://127.0.0.1:8765/x-article/drafts/3f6c2f4e-9a1b-4c8d-b7e2-0d5f6a7b8c9d | jq '{status, restId, error}'
```

Full REST surface: `GET /health`, `GET /setting`, `PATCH /setting` (`{token?}`), `POST /:kind/drafts`, `GET /:kind/drafts`, `GET /:kind/drafts/:id`, `GET /:kind/drafts/:id/assets/:fileName` (binary), `PUT /:kind/drafts/:id/cover`, `PATCH /:kind/drafts/:id` (`{status, restId?, error?}`), `DELETE /:kind/drafts/:id`. Kind segments must match `/^[a-z0-9][a-z0-9-]*$/` and not be a reserved word (`health`, `setting`, `drafts`). The pre-v0.5 root routes (`/drafts...`) return `410 Gone` with a migration hint.

Server-side clients don't hit CORS (requests with no `Origin` header are always allowed). Browser pages on arbitrary origins *will* be blocked — the allowlist covers only x.com/twitter.com, `chrome-extension://`, and Obsidian.

## Auth

By default the relay accepts any local request. To require a per-install token, create `~/.kaitox/config.json`:

```json
{ "token": "some-long-random-string" }
```

or set it on a running relay via `PATCH /setting` (takes effect immediately, no
restart; if a token is already configured, the request must present it):

```bash
curl -sS -X PATCH http://127.0.0.1:8765/setting \
  -H 'content-type: application/json' \
  --data '{"token":"some-long-random-string"}'
# → {"port":8765,"version":"...","tokenConfigured":true}
```

Then send the header on every request except `GET /health`:

```js
const relay = new HttpRelayClient('http://127.0.0.1:8765', { token: 'some-long-random-string' });
```

```bash
curl -sS http://127.0.0.1:8765/x-article/drafts -H 'x-kaitox-token: some-long-random-string'
```

Missing or wrong token → `401 {"error":"unauthorized"}`. `GET /setting` reports
`tokenConfigured` but never the token value itself; `PATCH /setting` with
`{"token":null}` clears it.

## Custom kinds: use the relay for your own features

X Articles are just the first `kind`. The relay treats the kind path segment as an opaque string, so `kind: 'my-feature'` bundles get their own route namespace (`/my-feature/drafts`) with zero relay changes — and the Kaitox extension never sees them, because it only polls `/x-article/drafts`.

Producer and consumer both use a kind-scoped client:

```js
import { HttpRelayClient } from '@kaitox/relay-protocol';

const relay = new HttpRelayClient('http://127.0.0.1:8765', { kind: 'my-feature' });

for (const item of await relay.listDrafts()) { // GET /my-feature/drafts — already filtered
  if (item.status !== 'pending') continue;

  const bundle = await relay.getDraft(item.id);
  await relay.ack(item.id, { status: 'uploading' });
  try {
    for (const asset of bundle.assets) {
      const bytes = await relay.getAsset(item.id, asset.fileName);
      // ...consume bundle.markdown + bytes however your feature wants...
    }
    // restId is named for X but is just a free-form result id.
    await relay.ack(item.id, { status: 'done', restId: 'whatever-you-produced' });
  } catch (err) {
    await relay.ack(item.id, { status: 'failed', error: String(err) });
  }
}
```

Pick a kind that satisfies the path-segment rule: `/^[a-z0-9][a-z0-9-]*$/`, not one of the reserved words (`health`, `setting`, `drafts`). Cross-kind access is invisible: a draft posted under one kind 404s under any other.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | Relay isn't running. `kaitox relay status` (or `npx @kaitox/relay status`), then `kaitox relay --daemon` / `npx @kaitox/relay start`. If you set `KAITOX_RELAY_PORT`, make sure your client targets the same port. |
| `401 unauthorized` | A `token` is set in `~/.kaitox/config.json` but your request lacks a matching `x-kaitox-token` header. If you edited the config file by hand while the relay was running, restart it — or use `PATCH /setting`, which takes effect immediately. `GET /health` never needs the token, so a passing health check doesn't prove your token works. |
| `410 Gone` on `/drafts` | You're using pre-v0.5 root routes. Draft routes are namespaced by kind now: `/x-article/drafts` (or your own kind). |
| `400 {"error":"invalid draft bundle","issues":[...]}` | The wire body failed validation; each issue carries a JSONPath-style location (e.g. `$.bundle.assets[0].mime`). Fix the listed fields. |
| `400 invalid kind path segment` | The kind in the URL must match `/^[a-z0-9][a-z0-9-]*$/` and not be `health`/`setting`/`drafts`. |
| Draft stuck in `pending` forever | Nothing is consuming it. For `x-article`: the Chrome extension must be installed, a tab must be open on `https://x.com/compose/articles` (it polls every 5s), you must be logged in to X, and publishing starts when you click the draft in the extension UI — it's intentionally not fully automatic. For custom kinds: your own consumer isn't running. |
| Draft `done` but an image is missing from the article | `assets[].src` didn't exactly match `collectImageSources(markdown)` output for that image. Re-check step 2 — no normalization allowed. |
| `400 {"error":"非法文件名"}` on asset fetch, or assets not written | `fileName` contained a path separator or resolved to `.`/`..`. Use bare, unique file names. |
| Browser page can't reach the relay (CORS error) | Only x.com/twitter.com, `chrome-extension://` and Obsidian origins are allowlisted. Push from your server/CLI process instead (no-`Origin` requests are allowed). |

## See also

- [x-article-publish-protocol.md](./x-article-publish-protocol.md) — the full end-to-end publishing protocol and why the bundle carries raw Markdown.
- [`@kaitox/relay-protocol`](../packages/relay-protocol/README.md) — wire types (`DraftBundle`, `PostDraftWireBody`, …) and `HttpRelayClient`.
- [`@kaitox/relay`](../packages/relay/README.md) — the relay server itself.
- [`@kaitox/x-article`](../packages/x-article/README.md) — `collectImageSources`, `deriveTitle`, `checkMarkdownStyle`, `toPlaintextMarkdown`.
