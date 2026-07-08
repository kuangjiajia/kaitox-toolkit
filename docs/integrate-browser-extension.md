English | [简体中文](integrate-browser-extension.zh-CN.md)

# Consume kaitox drafts and publish X Articles from your own browser extension

This guide shows how to build a Chrome extension (Manifest V3) that consumes draft
bundles from the local Kaitox relay and turns them into X (Twitter) Article drafts —
the same thing the reference extension in [`apps/extension/`](../apps/extension/) does.

You need two published packages:

| Package | What you use it for |
| --- | --- |
| [`@kaitox/relay-protocol`](../packages/relay-protocol/) | `HttpRelayClient` — talk to the local relay at `http://127.0.0.1:8765` (list/get/ack/delete drafts, fetch image bytes) |
| [`@kaitox/x-article`](../packages/x-article/) | `publishXArticle` — Markdown → `content_state`, media upload (INIT/APPEND/FINALIZE), `ArticleEntityDraftCreate`, optional cover |

For the wire format and REST surface of the relay, and the details of X's private
endpoints, see the [X Article publish protocol reference](./x-article-publish-protocol.md).

## Overview: why the upload runs in-page

The whole publish step runs inside a **content script on `https://x.com/compose/articles`**,
in the page's own origin. That is a deliberate design decision:

- **Same-origin fetch carries the session for free.** Requests to `https://x.com/i/api/graphql/...`
  and `https://upload.x.com/i/media/upload.json` made with `credentials: 'include'` automatically
  send the user's logged-in cookies. Your extension never sees, stores, or transmits passwords
  or auth tokens.
- **The CSRF token is right there.** X requires the `ct0` cookie value as an `x-csrf-token`
  header. `ct0` is not HttpOnly, so the content script reads it from `document.cookie`.
- **Media IDs only exist after upload from a logged-in page.** This is why the draft bundle
  carries **raw Markdown plus image bytes**, not a prebuilt `content_state`: the
  `content_state` needs `media_id`s, and those are only obtainable by uploading the images
  from the logged-in session. Your extension does the final conversion at click time.

The division of labor:

```
CLI / Obsidian / your service            local relay               your extension (content script on x.com)
        │  POST /x-article/drafts             │                              │
        ├────────────────────────────────────►│  stores ~/.kaitox/x-article/…│
        │  (raw Markdown + base64 images)     │                              │
        │                                     │◄─ GET /x-article/drafts ────┤ (poll ~5s; server-side
        │                                     │◄─ GET …/drafts/:id ─────────┤  filtered by kind)
        │                                     │◄─ GET …/drafts/:id/assets/..┤
        │                                     │                              ├─► upload images (same-origin)
        │                                     │                              ├─► ArticleEntityDraftCreate
        │                                     │◄─ PATCH …/drafts/:id (ack) ─┤
```

Key invariant: `bundle.assets[].src` is byte-for-byte equal to the output of
`collectImageSources(bundle.markdown)`. That is how you map each Markdown image back to
its bytes. Cover images do **not** appear in `assets` or in the Markdown; they ride
separately under `bundle.cover` (their bytes are stored under `cover.fileName` like any
other asset).

## Required manifest bits

```json
{
  "manifest_version": 3,
  "name": "My kaitox consumer",
  "version": "0.1.0",
  "host_permissions": [
    "*://x.com/*",
    "*://upload.x.com/*",
    "*://twitter.com/*",
    "http://127.0.0.1:8765/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://x.com/compose/articles*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "permissions": ["storage", "alarms"]
}
```

Notes:

- The content script **must** be matched to `https://x.com/compose/articles*` — the article
  composer/list page. That is where the logged-in session lives and where a created draft
  can be opened (`/compose/articles/edit/<restId>`).
- `host_permissions` cover the GraphQL host (`x.com`), the media upload host (`upload.x.com`),
  the legacy domain (`twitter.com`), and the local relay (`http://127.0.0.1:8765/*`).
- Content-script fetches to the relay are CORS requests with `Origin: https://x.com`;
  the relay's built-in allowlist permits `x.com`, `twitter.com`, `mobile.twitter.com`, any
  `chrome-extension://` origin, and `app://obsidian.md`, so no proxying is needed. Fetches
  from your service worker (`chrome-extension://` origin) are allowed too.
- `storage` and `alarms` are **optional**: `storage` if you want user-overridable settings
  (relay URL, token, queryIds — recommended, see step 5), `alarms` if you want a background
  badge counter.

## Walkthrough

### 1. Install and bundle

```bash
npm i @kaitox/x-article @kaitox/relay-protocol
```

Both packages are **ESM-only** (Node >= 18 / modern browsers). Chrome content scripts are
classic scripts, not modules, so **a bundler is required** — compile to a self-contained
IIFE with esbuild or Vite. With esbuild:

```bash
npx esbuild src/content.ts --bundle --format=iife --target=chrome110 --outfile=dist/content.js
```

Or as a build script (this mirrors [`apps/extension/esbuild.mjs`](../apps/extension/esbuild.mjs)):

```js
// esbuild.mjs
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome110',
});
```

Load `dist/` as an unpacked extension via `chrome://extensions`.

### 2. Create the relay client

`HttpRelayClient` takes an injected `fetch`. In a content script, bind it to `window` —
an unbound `fetch` reference throws `Illegal invocation` when called through a field.

```ts
// relay.ts
import { HttpRelayClient, DEFAULT_RELAY_BASE } from '@kaitox/relay-protocol';

export function makeRelayClient(token?: string): HttpRelayClient {
  // kind-scoped to 'x-article' by default: all requests go to /x-article/drafts...,
  // so the relay only ever shows this client X Article drafts.
  return new HttpRelayClient(DEFAULT_RELAY_BASE, {
    fetchImpl: window.fetch.bind(window),
    token, // optional per-install token from ~/.kaitox/config.json, sent as x-kaitox-token
  });
}
```

If the user configured a token in `~/.kaitox/config.json`, every relay request except
`GET /health` requires it; let users paste it into your extension settings and pass it here.

### 3. Poll for pending drafts

Poll `listDrafts()` (the reference extension uses a 5-second interval) and filter to
drafts that are not finished. Kind routing happens server-side: the client is
kind-scoped, `GET /x-article/drafts` only returns X Article drafts (including legacy
bundles written before the `kind` field existed), so no client-side kind filter is
needed:

```ts
// poll.ts
import type { DraftListItem } from '@kaitox/relay-protocol';
import { makeRelayClient } from './relay.js';

const POLL_MS = 5000;
const client = makeRelayClient();

async function fetchPending(): Promise<DraftListItem[]> {
  await client.health(); // throws if the relay is not running
  const items = await client.listDrafts();
  return items.filter((d) => d.status !== 'done');
}

setInterval(async () => {
  try {
    const pending = await fetchPending();
    renderYourUi(pending); // your badge / list / button
  } catch {
    // Relay offline. Tell the user to run `kaitox relay` (kaitox x push also starts it).
  }
}, POLL_MS);
```

`DraftListItem` is a light projection (`id`, `kind?`, `title`, `source`, `createdAt`,
`mode`, `status`, `counts?`, `assetCount`) — no Markdown, no bytes. Fetch the full
bundle only when the user actually clicks upload.

### 4. Upload one draft

The full lifecycle for a single draft, mirroring
[`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts) and the
`doUpload` flow in [`apps/extension/src/panel.tsx`](../apps/extension/src/panel.tsx):

1. `ack(id, { status: 'uploading' })` — so other consumers/UIs see it is being handled.
2. `getDraft(id)` — fetch the full `DraftBundle` (Markdown + asset metadata).
3. `publishXArticle(...)` with a custom `fetchImage` that resolves each Markdown image
   `src` to its bundle asset and pulls the bytes from the relay.
4. On success: `ack(id, { status: 'done', restId })`. On failure:
   `ack(id, { status: 'failed', error })`.

```ts
// uploader.ts
import { publishXArticle } from '@kaitox/x-article';
import type { ImageFetcher, CoverFetcher } from '@kaitox/x-article';
import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';

/** Read the ct0 cookie (not HttpOnly) — X wants it back as the x-csrf-token header. */
function readCt0(): string {
  const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export interface UploadResult {
  restId?: string;
  skippedImages: string[];
}

export async function uploadDraft(
  draft: DraftBundle,
  client: HttpRelayClient,
): Promise<UploadResult> {
  const ct0 = readCt0();
  if (!ct0) throw new Error('ct0 cookie not found — log in on x.com first.');

  // Body images: markdown src -> bundle asset (matched by src) -> relay bytes.
  // bundle.assets[].src always equals collectImageSources(markdown) output, so
  // every src publishXArticle asks for has exactly one matching asset.
  const fetchImage: ImageFetcher = async (src: string) => {
    const asset = draft.assets.find((a) => a.src === src);
    if (!asset) throw new Error(`No asset in bundle for image src: ${src}`);
    const bytes = await client.getAsset(draft.id, asset.fileName);
    return { bytes, mimeType: asset.mime };
  };

  // Cover (optional). publishXArticle only calls this after the draft exists
  // and a rest_id was obtained; the bytes live under cover.fileName like any asset.
  const cover = draft.cover;
  const fetchCover: CoverFetcher | undefined = cover
    ? async () => ({
        bytes: await client.getAsset(draft.id, cover.fileName),
        mimeType: cover.mime,
      })
    : undefined;

  const result = await publishXArticle({
    markdown: draft.markdown, // already mode-processed by the pusher; use as-is
    title: draft.title,
    // bearerToken '' -> falls back to DEFAULT_BEARER_TOKEN (the public web-client
    // bearer, shared by all x.com web sessions). ct0 becomes the x-csrf-token header.
    credentials: { bearerToken: '', csrfToken: ct0 },
    clientOptions: {
      fetchImpl: window.fetch.bind(window),
      credentialsMode: 'include', // same-origin: browser attaches the login cookies
    },
    fetchImage,
    fetchCover,
  });

  return { restId: result.restId, skippedImages: result.skippedImages };
}
```

And the click handler that wraps it with relay acks:

```ts
// content.ts (per-draft action)
import type { HttpRelayClient } from '@kaitox/relay-protocol';
import { uploadDraft } from './uploader.js';

async function processDraft(id: string, client: HttpRelayClient): Promise<void> {
  await client.ack(id, { status: 'uploading' });
  try {
    const draft = await client.getDraft(id);
    const result = await uploadDraft(draft, client);
    await client.ack(id, { status: 'done', restId: result.restId });

    if (result.skippedImages.length) {
      console.warn('Some images failed to upload and were skipped:', result.skippedImages);
    }
    // Open the freshly created draft in the composer.
    if (result.restId) {
      location.assign(`/compose/articles/edit/${result.restId}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // .catch(() => {}) so a dead relay doesn't mask the original error.
    await client.ack(id, { status: 'failed', error: msg }).catch(() => {});
    throw err;
  }
}
```

Behavior worth knowing:

- **A single failed image does not abort the article.** `publishXArticle` skips it,
  omits it from the body, and reports it in `result.skippedImages`.
- **`restId` can be `undefined`** if X's response shape changes and the ID cannot be
  extracted; the draft is still created — point the user to their article list.
- **The cover never enters the body.** It is uploaded after draft creation and attached
  via a separate `ArticleEntityUpdateCoverMedia` mutation; a cover failure leaves the
  created draft intact.
- Guard against double-clicks (the reference extension keeps a `busy` set of draft IDs).

### 5. Handle queryId rotation

X's GraphQL mutations are addressed by `queryId`s that X rotates without notice.
`@kaitox/x-article` exports the current known-good values as constants:

```ts
import {
  ARTICLE_DRAFT_CREATE_QUERY_ID,        // ArticleEntityDraftCreate
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,  // ArticleEntityUpdateCoverMedia
} from '@kaitox/x-article';
```

When X rotates them, draft creation starts failing until the package updates. Don't make
your users wait for a release: make the queryIds **user-overridable**, the way the
reference extension does with `chrome.storage.sync`
(see [`apps/extension/src/xsession.ts`](../apps/extension/src/xsession.ts)):

```ts
// settings.ts
import {
  ARTICLE_DRAFT_CREATE_QUERY_ID,
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
} from '@kaitox/x-article';

export interface Settings {
  queryId: string;
  coverQueryId: string;
}

/** Resolution order: user override (chrome.storage.sync) -> built-in constant. */
export async function getSettings(): Promise<Settings> {
  let stored: Record<string, any> = {};
  try {
    stored = await chrome.storage.sync.get(['queryId', 'coverQueryId']);
  } catch {
    /* storage unavailable -> constants */
  }
  return {
    queryId: stored.queryId || ARTICLE_DRAFT_CREATE_QUERY_ID,
    coverQueryId: stored.coverQueryId || ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
  };
}
```

Feed the resolved values into `publishXArticle` via `clientOptions`:

```ts
const { queryId, coverQueryId } = await getSettings();

const result = await publishXArticle({
  // ...as in step 4...
  clientOptions: {
    fetchImpl: window.fetch.bind(window),
    credentialsMode: 'include',
    articleDraftCreateQueryId: queryId,
    updateCoverMediaQueryId: coverQueryId,
  },
});
```

To find a fresh queryId after a rotation: open DevTools → Network on
`x.com/compose/articles`, save any article draft by hand, and look at the request URL
`https://x.com/i/api/graphql/<queryId>/ArticleEntityDraftCreate` (same idea for
`ArticleEntityUpdateCoverMedia`). Put that value into your settings UI.

## Reference implementation

[`apps/extension/`](../apps/extension/) is the canonical, working implementation of
everything above (private, not published to npm):

- [`manifest.json`](../apps/extension/manifest.json) — the MV3 manifest this guide's snippet is distilled from.
- [`src/uploader.ts`](../apps/extension/src/uploader.ts) — the exact `fetchImage`/`fetchCover`/`publishXArticle` wiring.
- [`src/xsession.ts`](../apps/extension/src/xsession.ts) — `ct0` reading, relay client construction, settings with queryId overrides.
- [`src/panel.tsx`](../apps/extension/src/panel.tsx) — 5s polling, `status` filtering (kind routing is server-side via the kind-scoped client), the ack lifecycle around uploads, busy-guarding, delete with confirmation.
- [`src/background.ts`](../apps/extension/src/background.ts) — optional service-worker badge counter using `alarms` (1-minute period; service workers can't poll every 5s — Chrome suspends them).
- [`esbuild.mjs`](../apps/extension/esbuild.mjs) — the IIFE bundling setup.

## Compliance warning

This drives the **user's own logged-in browser session** against X's **private web
endpoints** (`/i/api/graphql/...`, `upload.x.com`). It is unofficial: X can change or
break these endpoints at any time (queryId rotation is the most common breakage), and
automating a user session may conflict with X's terms of service. Use at your own risk,
keep it to the user's own manual, low-volume publishing — do not mass-automate.
