English | [简体中文](x-article-publish-protocol.zh-CN.md)

# X Article publish protocol: Markdown → content_state

> Goal: to lay out the complete pipeline for "one-click publish Markdown as an X (Twitter) long-form Article,"
> and to provide a directly reusable TypeScript reference implementation (see `packages/x-article/src/` in the repo). For similar "import/publish into some rich-text platform" jobs later, you can follow this same layering.
>
> This document records the private endpoints, request parameters, and data model used when the x.com web client publishes an Article draft;
> every field is grounded in real requests, and verified item by item by the tests in `packages/x-article/`.

---

## 0. In one sentence

This tool doesn't call any official open API. Instead it **borrows the session you're already logged into x.com with in your browser** and directly hits the **private endpoints** that the x.com web client uses itself, to do two things:

1. **Upload every image in the body via X's chunked upload endpoint**, getting back a `media_id`;
2. **Convert the Markdown into the X Article editor's internal data structure (Draft.js `content_state`)**, and POST it together with the `media_id` to GraphQL's `ArticleEntityDraftCreate`, producing a **draft**.

The hard part isn't the network requests; it's the **content-model conversion** in step 2 — which is also the most reusable part.

---

## 1. End-to-end flow

```
Markdown source
   │
   │  ① Scan out every image src
   ▼
[ each image ]───②──► X chunked upload  INIT ─► APPEND ─► FINALIZE ─► media_id_string
   │                 (upload.x.com/i/media/upload.json)
   │  ③ Markdown + {src → media_id}
   ▼
content_state (Draft.js blocks + entity_map)
   │
   │  ④ POST to create the draft
   ▼
x.com/i/api/graphql/<queryId>/ArticleEntityDraftCreate
   │
   ▼
Article draft (rest_id) → open x.com/compose/articles/edit/<id> for the user to keep editing / publishing
```

The real chronological order of requests in one full publish:

```
POST upload.json?command=INIT   total_bytes=41904  media_type=image/webp  media_category=tweet_image
POST upload.json?command=APPEND media_id=…  segment_index=0    (multipart/form-data, field name media)
POST upload.json?command=FINALIZE media_id=…
… repeat INIT/APPEND/FINALIZE for each image …
POST i/api/graphql/g1l5N8BxGewYuCy5USe_bQ/ArticleEntityDraftCreate   (application/json, the body goes here)
```

> Note: the x.com page itself also fires a lot of `abs.twimg.com` JS/font requests, `viewer_context.json` telemetry, and CORS-preflight `OPTIONS` — all of that is the page's own behavior, unrelated to the upload logic; just ignore it.

---

## 2. Auth: essentially "acting on your behalf with your logged-in session"

All private endpoints rely on the same set of request headers. The values all come from your logged-in x.com browser session.

| Header | Value | Notes |
|---|---|---|
| `authorization` | `Bearer AAAA…FA33AGWWjCpTnA` | **Public** web bearer, shared by all web clients, unchanged for a long time. See the constant below. |
| `x-csrf-token` | `<ct0>` | CSRF; **equals the `ct0` in the cookie**. |
| `x-twitter-auth-type` | `OAuth2Session` | Fixed. |
| `x-twitter-active-user` | `yes` | Fixed. |
| `x-twitter-client-language` | `en` | Client language. |
| Cookie | `auth_token=…; ct0=…; …` | The real source of identity. Same-origin browser fetch carries it automatically with `credentials:'include'`; a server-side call must set the `cookie` header manually. |
| `x-client-transaction-id` | (can be omitted for the create step) | X validates it for most GraphQL calls, but it can be omitted when sending same-origin requests from within the x.com page context. **May be mandatory for cross-origin / server-side calls**, see the "Pitfalls" in §7. |

Public bearer (built into the reference implementation as the default):

```
AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
```

> ⚠️ You only need to prepare two things: **`ct0`** and the **full cookie string** (especially `auth_token`). Just use the built-in default bearer.

---

## 3. Media upload: three-phase chunked INIT / APPEND / FINALIZE

Run it once per image; the endpoint is always `POST https://upload.x.com/i/media/upload.json`, with query params distinguishing the phases.

### ① INIT — request a media slot
```
POST upload.json?command=INIT
     &total_bytes=<byte count>
     &media_type=<image/webp | image/png | image/jpeg | image/gif>
     &media_category=tweet_image
```
- Empty body.
- Take **`media_id_string`** from the returned JSON (be sure to use the string version, not the numeric `media_id` which loses precision).

A few real INIT params (confirming media_type varies per image):
```
command=INIT&total_bytes=41904 &media_type=image/webp&media_category=tweet_image
command=INIT&total_bytes=46552 &media_type=image/webp&media_category=tweet_image
command=INIT&total_bytes=173214&media_type=image/png &media_category=tweet_image
command=INIT&total_bytes=62806 &media_type=image/webp&media_category=tweet_image
```

### ② APPEND — upload data chunks
```
POST upload.json?command=APPEND&media_id=<id>&segment_index=0
Content-Type: multipart/form-data; boundary=…
  field name: media   value: image binary (Blob)
```
- Single-chunk cap is ~5MB; exceed it and use multiple `segment_index=0,1,2…`. An image usually fits in one chunk.
- **Don't write `Content-Type` manually**; let `fetch`/`FormData` generate the boundary automatically.

### ③ FINALIZE — wrap up
```
POST upload.json?command=FINALIZE&media_id=<id>
```
- Images complete instantly. Video/GIF returns `processing_info`, requiring further polling of `command=STATUS` until `state==succeeded` (the reference implementation's `waitForProcessing` handles this).

> Watch one **easy-to-get-wrong point**: on upload `media_category` is **`tweet_image`**, but when the body `content_state` references this image, `media_category` is **`DraftTweetImage`**. The two fields serve two different endpoints; don't mix them up.

---

## 4. Core data model: X Article's `content_state`

The X Article body uses **Draft.js's `RawDraftContentState`**, but X made two changes:

1. `entity_map` is an **array** (each element carries an explicit `key`), not Draft.js's native object.
2. Field names are snake_case: `entity_ranges` / `inline_style_ranges` / `entity_map`.

Structure:

```jsonc
{
  "blocks": [ /* block-level blocks; their order is the article top to bottom */ ],
  "entity_map": [ /* "entities" like images/dividers/code/links, referenced by blocks via key */ ]
}
```

### 4.1 block (block-level)

```jsonc
{
  "key": "ckq8u",                 // random 5 chars, only needs to be unique within the document
  "text": "……",                  // plain text
  "type": "unstyled",             // see table below
  "data": {},
  "entity_ranges": [              // associate a span of text with an entity (e.g. a link, or an atomic block-level entity)
    { "key": 0, "offset": 0, "length": 1 }
  ],
  "inline_style_ranges": [        // inline styles
    { "offset": 27, "length": 19, "style": "Bold" }
  ]
}
```

> **Pitfall: don't send the `depth` field.** Draft.js's native block has `depth` (for list indentation), but X's `ArticleEntityDraftCreate` GraphQL **input is strongly typed and has no `depth` field**. Including it gets rejected:
> `GRAPHQL_VALIDATION_FAILED … path:["variable","content_state","blocks",0,"depth"]`.
> This converter flattens nested lists (depth is always 0, carrying no information), so it simply doesn't emit the field.

**Full set of block `type`s:**

| type | Corresponding Markdown |
|---|---|
| `unstyled` | Normal paragraph |
| `header-one` / `header-two` | Heading / SubHeading in the editor. This converter's convention: `#` = main title (goes to the title field, not the body), `##` → `header-one`, `###` and deeper → `header-two` |
| `blockquote` | `>` quote |
| `unordered-list-item` | `-` list item (**one block per item**) |
| `ordered-list-item` | `1.` list item (verified valid) |
| `atomic` | **Block-level entity host**: image / divider / code. `text` is fixed at `" "` (a single space), and has exactly one `entity_range = {offset:0, length:1}` |

> **Pitfall: `header-three` and `code-block` pass GraphQL validation but fail the backend.** Verified 2026-07: these two
> types don't trigger GRAPHQL_VALIDATION_FAILED, but creating the draft fails the whole request with
> `OperationalError: Internal: Unspecified, path:["articleentity_create_draft"]` (the error message points at nothing at all).
> The X Article body supports only two heading levels; code blocks must go through atomic + MARKDOWN entities.
> To debug this kind of "validation passed but Operational failure," use bisect-and-replay: replay slices of blocks (renumbering entities by reference),
> find the block type/trait common to all failing slices, then confirm with a single-block probe.

**`inline_style_ranges.style`:** the full verified enum = `Bold` / `Italic` / `Strikethrough` (probe-verified 2026-07).
> **Pitfall: there is no inline-code style.** `Code` / `CODE` / `InlineCode` / `Underline` all get rejected:
> `GRAPHQL_VALIDATION_FAILED … path:["variable","content_state","blocks",i,"inline_style_ranges",j,"style"]`.
> The X Article editor itself has no inline-code / underline buttons. This converter downgrades inline `` `code` `` to plain text.
> Probe method: build a request with "blocks[0] carrying the style under test + blocks[1] carrying an illegal `depth`" — if the error path lands on
> `blocks[1].depth`, the style under test is valid; and the request is guaranteed to fail, so it won't actually create a draft.
**Key: `offset`/`length` use JS string indices (UTF-16 code units), CJK characters count as 1.** Verified: in the first paragraph `offset:27,length:19` precisely frames "Harness Engineering".

### 4.2 entity_map (entities)

Four types:

```jsonc
// Image: upload first to get media_id, then reference it
{ "key": 3, "value": { "type": "MEDIA", "mutability": "Immutable",
    "data": { "media_items": [
      { "local_media_id": 3, "media_id": "2073636721275641856", "media_category": "DraftTweetImage" }
    ] } } }

// Divider ---
{ "key": 2, "value": { "type": "DIVIDER", "mutability": "Immutable", "data": {} } }

// Code block / ASCII diagram / table: stuff the raw markdown into the markdown field, X renders it as markdown
// (a table shows as a native table). Note mutability MUST be Mutable (from the X editor's actual payload, captured 2026-07):
// Immutable passes GraphQL validation, but the render side drops the content. The markdown field needs leading/trailing newlines.
{ "key": 0, "value": { "type": "MARKDOWN", "mutability": "Mutable",
    "data": { "markdown": "\n```plaintext\nHarness Engineering …\n```\n" } } }

// Link: referenced by a normal/list block's entity_range, overriding the displayed text
{ "key": 30, "value": { "type": "LINK", "mutability": "Mutable",
    "data": { "url": "https://x.com/AnatoliKopadze/status/2069475753184329889" } } }
```

**Three conventions you must follow (otherwise X rejects it or renders it wrong):**

1. **Entity `key`s start at 0 and increment in the top-to-bottom order they appear in the document.** Block-level entities (MEDIA/DIVIDER/MARKDOWN) and inline entities (LINK) **share the same counter**.
2. **MEDIA's `local_media_id` === that entity's own `key`.**
3. **The atomic block and the entity it carries**: the atomic block's sole `entity_range.key` points at the MEDIA/DIVIDER/MARKDOWN in entity_map.

---

## 5. Markdown → content_state mapping rules (the most reusable part)

| Markdown | Produces |
|---|---|
| Paragraph | `unstyled` block |
| `#` (the first one) | Article main title (title field, not in the body; extra `#`s in the text are treated as `##`) |
| `##` / `###` and deeper | `header-one` (Heading) / `header-two` (SubHeading; the backend has no `header-three`) |
| `> quote` | `blockquote` block (one block per paragraph inside the quote) |
| `- item` / `1. item` | `unordered-list-item` / `ordered-list-item` (one block per item) |
| `**bold**` `*italic*` `~~strike~~` | `inline_style_ranges`: `Bold` / `Italic` / `Strikethrough` |
| `` `inline code` `` | Plain text (X has no inline-code style; the `Code` enum is verified rejected) |
| `[text](url)` | New `LINK` entity + `entity_range` covering the "text" |
| `![alt](src)` | **Upload the image first** → new `MEDIA` entity + one `atomic` block |
| ` ```code``` ` | New `MARKDOWN` entity (`data.markdown` = the full fenced string, wrapped in newlines) + one `atomic` block |
| `---` | New `DIVIDER` entity + one `atomic` block |
| Table | `MARKDOWN` entity (raw markdown, wrapped in newlines) — X renders it natively as a table |

One implementation detail: code blocks / ASCII diagrams are uniformly wrapped into a ` ```plaintext ` MARKDOWN entity (the X Article editor renders all code blocks as `plaintext`).

> For the algorithm, see `packages/x-article/src/contentState.ts`: a single top-to-bottom pass that maintains `blocks`, `entity_map`, and an incrementing entity-key counter at the same time; inline handling recurses over nested `strong/em/link` and computes offsets from cumulative text length.

---

## 6. Creating the draft: ArticleEntityDraftCreate

```
POST https://x.com/i/api/graphql/g1l5N8BxGewYuCy5USe_bQ/ArticleEntityDraftCreate
Content-Type: application/json
(+ the auth headers from §2)
```

Request-body skeleton (`content_state` is the output of §4/§5):

```jsonc
{
  "variables": {
    "content_state": { "blocks": [ … ], "entity_map": [ … ] },
    "title": "一篇文章说清楚 Harness Engineering 与 Loop Engineering 的区别"
  },
  "features": {
    "profile_label_improvements_pcf_label_in_post_enabled": false,
    "responsive_web_profile_redirect_enabled": true,
    "rweb_tipjar_consumption_enabled": true,
    "verified_phone_label_enabled": false,
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled": false,
    "responsive_web_graphql_timeline_navigation_enabled": true
  },
  "fieldToggles": { "withPayments": false, "withAuxiliaryUserLabels": false },
  "queryId": "g1l5N8BxGewYuCy5USe_bQ"
}
```

- The `g1l5N8BxGewYuCy5USe_bQ` in the URL path is the `queryId`; the two must match.
- This step **only creates a draft**. You'll then see `ArticleEntityResultByRestId` (fetching the just-created article) and `ArticleEntitiesSlice` (the draft list) — both are editor-load behaviors. **The actual "publish" is a different mutation**, see §7.

---

## 6.5 Setting the cover: ArticleEntityUpdateCoverMedia

The cover / header image is a **separate step**, called after the draft is built (needs the draft's `rest_id`). Flow: first run the cover image through the §3 media upload (`media_category=tweet_image`) to get a `media_id`, then call this mutation.

```
POST https://x.com/i/api/graphql/AbzX20PDk6TTzqmN67hiPQ/ArticleEntityUpdateCoverMedia
Content-Type: application/json
(+ the auth headers from §2)
```

Request body:

```jsonc
{
  "variables": {
    "articleEntityId": "2073786172036268032",     // the rest_id returned by draft creation
    "coverMedia": {
      "media_id": "2073790268667478016",           // the media_id_string obtained from uploading the cover image
      "media_category": "DraftTweetImage"           // same as when referencing body images
    }
  },
  "features": { /* see the notes below */ },
  "queryId": "AbzX20PDk6TTzqmN67hiPQ"
}
```

The response echoes `cover_media` (including `media_key`, `original_img_url`, etc.), which you can use to confirm the setting succeeded.

**Two pitfalls that differ from `ArticleEntityDraftCreate`:**
1. **No `fieldToggles`** field — don't copy the draft-create structure and add it.
2. **Three `features` flags have opposite values**: `profile_label_improvements_pcf_label_in_post_enabled` is `true` here (`false` in draft-create), `responsive_web_profile_redirect_enabled` is `false` here (`true` in draft-create), `rweb_tipjar_consumption_enabled` is `false` here (`true` in draft-create). In the reference implementation these are `DEFAULT_ARTICLE_FEATURES` and `DEFAULT_COVER_MEDIA_FEATURES` respectively.

`queryId` rotates here too (the reference implementation's `ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID` can override it).

---

## 7. Limitations, pitfalls, and things to watch when building similar logic

**Boundaries of the current implementation:**
- Covers only **draft creation**, not the mutation name and parameters for the **publish** step.
- `restId` parsing is a "lenient probe"; correct it against actual responses once wired to a real environment.

**The pitfalls you're most likely to hit when building similar features:**
1. **`queryId` rotates.** X changes `g1l5N8BxGewYuCy5USe_bQ` from time to time. Make it configurable (the reference implementation already supports overriding); when it breaks, re-fetch it from the x.com frontend bundle.
2. **`x-client-transaction-id`.** Omittable within a same-origin page, but X often validates it for server-side / cross-origin calls. It's computed dynamically by a piece of obfuscated code in the x.com frontend based on the request method + path; to truly call from outside the page, you must implement that algorithm yourself or send the request from within the page context.
3. **`media_category` differs in two places**: `tweet_image` on upload, `DraftTweetImage` when referenced in the body.
4. **Use the string `media_id`** (`media_id_string`), not the numeric version.
5. **Offsets use UTF-16 code units**: don't count by "number of characters" or bytes; emoji (surrogate pairs) will misalign you with X.
6. **Entity keys increment globally and continuously**, block-level and inline sharing one counter; MEDIA's `local_media_id` must equal its key.
7. **Compliance**: this is fundamentally automation that operates the user's own account with the user's own logged-in session. Don't run at high frequency, don't mass-batch across accounts, and mind X's automation policy and rate limits.

**Layering advice for reusers** (applies later to "post a normal tweet / post a thread / import into another rich-text editor"):

```
Auth & HTTP        →  packages/x-article/src/xArticleClient.ts   (swapping endpoints only touches this layer)
Content-model conversion  →  packages/x-article/src/contentState.ts     (swapping the target editor means rewriting the mapping; this layer is the most valuable)
End-to-end orchestration  →  packages/x-article/src/publishArticle.ts   (collect resources → upload → convert → submit; the skeleton stays the same)
Data types            →  packages/x-article/src/types.ts
```

---

## 8. Using the reference implementation

```bash
cd packages/x-article
npm install
npm run typecheck        # type-check
npm run build            # compile to dist/
```

```ts
import { publishXArticle } from '@kaitox/x-article';

const { restId, contentState, mediaMap, skippedImages } = await publishXArticle({
  markdown,                                  // your Markdown
  // omit title to auto-derive it from the first heading
  credentials: {
    bearerToken: '',                         // leave empty to use the built-in default public bearer
    csrfToken: '<your ct0>',
    cookie: '<full cookie string>',          // required for server-side calls
  },
  clientOptions: { credentialsMode: 'omit' } // server-side: don't rely on the browser to auto-send cookies
});
```

- If you only want "Markdown → content_state" without publishing: just use `markdownToContentState(md, { src: media_id })`.
- To run inside a browser-extension content script: use the default `'include'` for `credentialsMode`; `cookie`/`csrfToken` can be read from the page, and same-origin fetch carries the logged-in session automatically.

> Conversion correctness is covered by `npm test` (`packages/x-article/test/validate.mjs`): 35 assertions compared one by one against expected ground truth, including that CJK bold `offset:27,length:19`.
