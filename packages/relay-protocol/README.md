# @kaitox/relay-protocol

The wire contract between kaitox upload clients and a kaitox relay, plus a portable HTTP client.

If you want your own local service to push drafts into kaitox — so they show up in the Chrome extension on `https://x.com/compose/articles`, or in any other kaitox consumer — this package is all you need. It is:

- **Zero-dependency.** Pure TypeScript types + `fetch` + built-in base64. Nothing else.
- **Portable.** `HttpRelayClient` runs unchanged in Node >= 18 and in browsers (any environment with a global `fetch`).
- **The layering root.** This package never imports from any other kaitox package; feature engines (e.g. [`@kaitox/x-article`](../x-article/README.md)) and the relay server both depend on it, never the other way around.

ESM-only. MIT.

## Install

```sh
npm install @kaitox/relay-protocol
```

You also need a relay running locally (default `http://127.0.0.1:8765`):

```sh
npm install -g @kaitox/relay
kaitox-relay start
```

See [`@kaitox/relay`](../relay/README.md) for daemon management, storage layout, and configuration.

## The DraftBundle model

A **draft bundle** is one unit of work: raw Markdown + image bytes + metadata, posted as a single JSON document. Two deliberate design choices:

1. **The bundle carries raw Markdown, not a prebuilt `content_state`.** For X Articles, image `media_id`s only exist after the images are uploaded from the logged-in x.com page — so rendering must happen at consume time, in the extension, not at push time.
2. **`assets[].src` must exactly equal the strings that `collectImageSources(markdown)` (from `@kaitox/x-article`) extracts from the Markdown.** That string identity is how the consumer maps each uploaded image back to its position in the document. If they drift, images silently drop. This is the single most important invariant in the protocol.

### `DraftBundle`

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | Literal. Bump only on breaking wire changes. |
| `id` | `string` | Assigned by the pusher (`HttpRelayClient` uses `crypto.randomUUID()` by default). |
| `kind?` | `DraftKind` | Feature discriminator. **Absent means `'x-article'`** (v0.2 bundles on disk predate the field). The relay stores and forwards it without interpreting it. |
| `title` | `string` | Draft title. |
| `markdown` | `string` | Raw Markdown source. |
| `mode` | `'rich' \| 'plaintext'` | Rich rendering vs. plaintext fallback. |
| `assets` | `DraftAsset[]` | Body images. `src` values must match `collectImageSources(markdown)` exactly (see invariant above). |
| `cover?` | `DraftAsset` | Optional cover image. Not part of the body: it uses the sentinel `src: '__cover__'`, appears neither in `markdown` nor in `assets`, and its bytes travel in the wire `assets` array under `cover.fileName`. Consumers upload it separately after creating the draft. |
| `styleReport?` | `StyleReport` | Optional pre-flight style check result (`{ friendly, issues, counts }`). |
| `createdAt` | `string` | ISO 8601 timestamp. |
| `source` | `DraftSource` | Which pusher produced it: `'cli' \| 'obsidian' \| 'unknown'` or any string of your own. |
| `sourceMeta?` | `Record<string, unknown>` | Free-form pusher metadata. |
| `status?` | `DraftStatus` | **Relay-maintained.** `'pending' \| 'uploading' \| 'done' \| 'failed'`. |
| `restId?` | `string` | **Relay-maintained.** Backfilled by the consumer on success (for X Articles, the article's `rest_id`). |
| `error?` | `string` | **Relay-maintained.** Failure message, set via `ack`. |

The three relay-maintained fields are excluded from what you POST — the wire body's bundle is typed `Omit<DraftBundle, 'status' | 'restId' | 'error'>`.

### `DraftAsset`

| Field | Type | Notes |
|---|---|---|
| `key` | `string` | Stable key, e.g. `"img-0"`. Used by Obsidian for wikilink rewriting; may simply equal `src`. |
| `src` | `string` | The exact src string as it appears in the Markdown. Must equal a `collectImageSources` output (or `'__cover__'` for the cover). |
| `fileName` | `string` | File name the relay stores the bytes under (`assets/<fileName>`) and that you fetch them back by. |
| `mime` | `string` | e.g. `image/png`. |
| `bytesLen` | `number` | Byte length, for display/validation. |
| `sha256?` | `string` | Optional integrity checksum. |

### `DraftListItem`

The lightweight shape returned by `GET /drafts` — no `markdown`, no bytes:

| Field | Type |
|---|---|
| `id` | `string` |
| `kind?` | `DraftKind` (absent = `'x-article'`) |
| `title` | `string` |
| `source` | `DraftSource` |
| `createdAt` | `string` |
| `mode` | `DraftMode` |
| `status` | `DraftStatus` |
| `counts?` | `{ error: number; warning: number; info: number }` |
| `assetCount` | `number` |

### Open string unions

`DraftKind` and `DraftSource` are declared as:

```ts
export type DraftKind = 'x-article' | (string & {});
export type DraftSource = 'cli' | 'obsidian' | 'unknown' | (string & {});
```

The `(string & {})` trick keeps editor autocomplete for the known literals while **accepting any string** — so third-party features and pushers never need a protocol change to introduce their own values.

## REST contract

Base URL: `http://127.0.0.1:8765` by default. The relay binds to `127.0.0.1` only; the port is configurable via `KAITOX_RELAY_PORT`, and storage lives under `KAITOX_HOME` (default `~/.kaitox`).

| Method | Path | Request body | Success | Errors |
|---|---|---|---|---|
| `GET` | `/health` | — | `200` `{ ok, version, port }` | — (token-exempt) |
| `POST` | `/drafts` | `PostDraftWireBody` (JSON) | `201` `{ id }` | `401` |
| `GET` | `/drafts` | — | `200` `DraftListItem[]` | `401` |
| `GET` | `/drafts/:id` | — | `200` `DraftBundle` | `401`, `404` |
| `GET` | `/drafts/:id/assets/:fileName` | — | `200` binary (`application/octet-stream`) | `400` (illegal file name), `401`, `404` |
| `PATCH` | `/drafts/:id` | `{ status, restId?, error? }` | `200` updated `DraftBundle` | `401`, `404` |
| `DELETE` | `/drafts/:id` | — | `200` `{ deleted: true }` | `401`, `404` `{ deleted: false }` |

`OPTIONS` preflight always answers `204`. Unhandled errors answer `500` `{ error }`.

The `POST /drafts` body is a single JSON document — no multipart, so the relay needs no parser beyond Node builtins:

```ts
export interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}
```

`wire.assets` carries the bytes for **both** body images and the cover (the cover's bytes are keyed by `bundle.cover.fileName`). Asset downloads go the other direction as raw binary, since that is the hotter, bandwidth-sensitive path.

### Auth: `x-kaitox-token`

Auth is off by default. If `~/.kaitox/config.json` contains a token:

```json
{ "token": "some-long-random-string" }
```

then every request except `GET /health` and `OPTIONS` must send it as the `x-kaitox-token` header, or it gets `401` `{ "error": "unauthorized" }`.

### CORS

Browser origins are allowlisted: `x.com`, `twitter.com`, `mobile.twitter.com`, any `chrome-extension://` origin, and `app://obsidian.md` (Obsidian desktop). Requests **without** an `Origin` header — CLI tools, curl, server-side code, i.e. anything that is not a cross-origin browser page — are always allowed. So a third-party *web page* on another origin cannot call the relay directly; push from a server or CLI process instead.

## HttpRelayClient

A `fetch`-based implementation of the `RelayClient` interface, usable from Node and browsers alike. A cloud relay (future) only has to implement the same interface to be a drop-in replacement.

```ts
new HttpRelayClient(baseUrl?, opts?)
```

- `baseUrl` — defaults to `http://127.0.0.1:8765` (trailing slashes are stripped).
- `opts.fetchImpl` — inject a `fetch` (defaults to the global; throws at construction if none exists).
- `opts.token` — per-install token, sent as `x-kaitox-token` on every request.
- `opts.makeId` — id factory, defaults to `crypto.randomUUID`.
- `opts.now` — timestamp factory, defaults to `() => new Date().toISOString()`.

| Method | Returns | Does |
|---|---|---|
| `health()` | `{ ok, version, port? }` | `GET /health` liveness probe. |
| `postDraft(input)` | `{ id }` | Stamps `id`/`createdAt`, base64-encodes all bytes (cover included), `POST /drafts`. |
| `listDrafts()` | `DraftListItem[]` | `GET /drafts`. |
| `getDraft(id)` | `DraftBundle` | `GET /drafts/:id`. |
| `getAsset(id, fileName)` | `Uint8Array` | `GET /drafts/:id/assets/:fileName` as binary. |
| `ack(id, patch)` | `void` | `PATCH /drafts/:id` with `{ status, restId?, error? }`. |
| `deleteDraft(id)` | `void` | `DELETE /drafts/:id`. |

Every method throws an `Error` with the HTTP status on any non-2xx response.

### Pushing a draft

`postDraft` takes a `PostDraftInput`: like the bundle, but each asset is a `DraftAssetInput` carrying in-memory `bytes: Uint8Array` instead of `bytesLen`, and `id`/`createdAt`/`schemaVersion` are filled in for you.

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import { collectImageSources } from '@kaitox/x-article';

const relay = new HttpRelayClient(); // http://127.0.0.1:8765

const mdPath = '/path/to/post.md';
const markdown = await readFile(mdPath, 'utf8');

// Use collectImageSources so assets[].src matches what consumers will
// extract from the same Markdown — the critical invariant.
const srcs = collectImageSources(markdown); // e.g. ['./images/diagram.png']

const assets = await Promise.all(
  srcs.map(async (src, i) => ({
    key: `img-${i}`,
    src, // exact string from the Markdown — do not normalize it
    fileName: `img-${i}.png`,
    mime: 'image/png',
    bytes: new Uint8Array(await readFile(resolve(dirname(mdPath), src))),
  })),
);

const { id } = await relay.postDraft({
  // kind omitted => 'x-article'
  title: 'My first article',
  markdown,
  mode: 'rich',
  source: 'my-service',
  assets,
  cover: {
    key: 'cover',
    src: '__cover__', // sentinel: cover is not part of the body
    fileName: 'cover-hero.jpg',
    mime: 'image/jpeg',
    bytes: new Uint8Array(await readFile('/path/to/hero.jpg')),
  },
});

console.log(`queued draft ${id}`);
```

The relay stores it under `~/.kaitox/outbox/<id>/` (`bundle.json` + `assets/<fileName>`). For `kind: 'x-article'` drafts, the kaitox Chrome extension polls the relay and, on click, creates the Article draft using the user's own logged-in x.com session.

> **Compliance note.** Publishing X Articles this way drives the user's own logged-in browser session against X's private web endpoints. It is unofficial, may break whenever X rotates queryIds, and should not be used for mass automation. Use at your own risk.

### Consuming drafts

The consumer side of the same contract — this is essentially what the Chrome extension does:

```ts
import { HttpRelayClient } from '@kaitox/relay-protocol';

const relay = new HttpRelayClient();

const pending = (await relay.listDrafts()).filter(
  (d) => d.status === 'pending' && (d.kind ?? 'x-article') === 'x-article',
);

for (const item of pending) {
  const bundle = await relay.getDraft(item.id);
  await relay.ack(bundle.id, { status: 'uploading' });
  try {
    for (const asset of bundle.assets) {
      const bytes = await relay.getAsset(bundle.id, asset.fileName);
      // upload bytes somewhere, map asset.src -> uploaded media id ...
    }
    // ... render bundle.markdown, create the draft, then:
    await relay.ack(bundle.id, { status: 'done', restId: '1234567890' });
  } catch (err) {
    await relay.ack(bundle.id, { status: 'failed', error: String(err) });
  }
}
```

Always treat a missing `kind` as `'x-article'` when filtering.

## base64 helpers

Bytes travel as base64 inside the `POST /drafts` JSON. Two helpers work in both runtimes — `Buffer` when available, chunked `btoa`/`atob` otherwise:

```ts
import { bytesToBase64, base64ToBytes } from '@kaitox/relay-protocol';

const b64 = bytesToBase64(new Uint8Array([1, 2, 3]));
const bytes = base64ToBytes(b64);
```

`HttpRelayClient.postDraft` calls `bytesToBase64` for you; you only need these when speaking the REST contract by hand.

## Extending kaitox with your own feature

The `kind` discriminator makes the relay a generic local draft queue:

1. **Push** with your own kind: `postDraft({ kind: 'my-feature', ... })`. Any string is valid — no protocol change needed.
2. **The relay stores and forwards `kind` untouched.** It never interprets it; your bundles sit in the same outbox alongside `x-article` drafts.
3. **Consume** by filtering: `listDrafts()` then keep items where `(d.kind ?? 'x-article') === 'my-feature'`, and drive the `pending → uploading → done | failed` lifecycle with `ack`.

Your feature gets persistence, a REST surface, CORS, optional token auth, and a shared client for free. See [Integrating your own local service](../../docs/integrate-local-service.md) for the full walkthrough, and [`@kaitox/relay`](../relay/README.md) for running the relay itself.

## License

MIT © [kaitox](https://kaitox.ai)
