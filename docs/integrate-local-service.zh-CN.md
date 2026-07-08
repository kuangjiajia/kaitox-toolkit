[English](integrate-local-service.md) | 简体中文

# 从你自己的本地服务向 kaitox 推送草稿

Kaitox 的 relay 就是一个普通的本地 HTTP 服务器。Kaitox CLI 和 Obsidian 插件只是它的两个客户端而已——任何能向 `http://127.0.0.1:8765` 说 HTTP 的东西，都可以用同样的方式把草稿排入队列。本指南演示如何从你自己的 Node 服务、脚本或任何其他技术栈推送 X（Twitter）Article 草稿。

**什么时候会用到它**

- 你的笔记应用或知识库想要一个「发送到 X 草稿」按钮。
- 你的静态站点流水线希望每构建一篇新文章，就为它排入一条 X Article 草稿。
- 某个内部工具产出 Markdown 报告，偶尔有人会把它发布到 X 上。

**它是如何拼装到一起的**

```text
your service ──POST /x-article/drafts──▶ local relay (127.0.0.1:8765)
                                             │  stores ~/.kaitox/x-article/outbox/<id>/
                                             ▼
                          Chrome extension on x.com/compose/articles
                          polls every 5s → on click, uploads images and
                          creates the Article draft in YOUR logged-in session
```

草稿路由按 `kind` 划分命名空间（`/:kind/drafts...`）：路径段就是那个原样的 kind
字符串，relay 把它当作不透明的值来处理，每个功能都拥有自己的命名空间。
`HttpRelayClient` 会替你处理好这一切（它是按 kind 作用域的，默认 `'x-article'`）。

你推送的草稿包携带的是**原始 Markdown 加上图片字节**，而不是预先构建好的 X `content_state`。这是刻意为之的：图片的 `media_id` 只有在扩展从已登录的 x.com 页面上传图片之后才存在，所以转换必须发生在那一端。完整的流水线记录在 [x-article-publish-protocol.md](./x-article-publish-protocol.zh-CN.md) 中。

> **合规说明。** 发布过程驱动的是用户*自己*已登录的浏览器会话，针对的是 X 的私有 Web 端点。这是非官方的，随时可能在 X 轮换其 GraphQL queryId 时失效，风险由你自行承担。不要用它来批量自动化发帖。

## 前置条件

- Node 演练需要 Node.js >= 18（全局 `fetch`；这些包是 ESM-only 的）。
- relay 在本地运行：

  ```bash
  npx @kaitox/relay start
  # or, if you have the CLI installed:
  kaitox relay --daemon
  ```

- 消费端方面：已安装 Kaitox Chrome 扩展，并在登录 X 的状态下打开一个停留在 `https://x.com/compose/articles` 的标签页。你的服务只负责把草稿*排队*；把它们变成 X Article 草稿的是扩展。

配置旋钮：relay 只绑定 `127.0.0.1`；端口来自 `KAITOX_RELAY_PORT`（默认 `8765`）；状态存放在 `KAITOX_HOME` 下（默认 `~/.kaitox`）。

## 演练（Node）

### 1. 安装协议包

```bash
npm i @kaitox/relay-protocol @kaitox/x-article
```

[`@kaitox/relay-protocol`](../packages/relay-protocol/README.zh-CN.md) 是零依赖的线上契约，外加一个基于 fetch 的 `HttpRelayClient`。[`@kaitox/x-article`](../packages/x-article/README.zh-CN.md) 只有在需要 `collectImageSources` 时才用得上（可选地还有 `deriveTitle`、`checkMarkdownStyle`、`toPlaintextMarkdown`）。

### 2. 从一个 Markdown 字符串构建草稿包

> [!IMPORTANT]
> **你绝不能打破的那一条不变量：** `assets[].src` 必须*完全*等于 `@kaitox/x-article` 中 `collectImageSources(markdown)` 返回的字符串——扩展那一端会用同一个函数以相同的顺序做解析，两端纯粹靠那个原始 `src` 字符串对齐。不要对 src 做规范化、URL 编码、解析或裁剪。请通过调用 `collectImageSources`（或者逐字节复刻它的解析逻辑）来得出你的 asset 列表。`src` 不匹配的 asset 会被悄无声息地永远不放进文章里。

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
 * 把 `markdown` 中的每一个图片引用变成一个 DraftAssetInput
 * （key、src、fileName、mime、bytes）。本地路径相对于
 * `baseDir` 解析。
 */
export async function buildAssets(markdown, baseDir) {
  const srcs = collectImageSources(markdown); // 唯一正确的枚举方式
  const taken = new Set();
  const assets = [];
  for (const src of srcs) {
    // 用最适合你应用的方式读取字节；这里：相对于 baseDir 的本地文件。
    const path = resolve(baseDir, decodeURIComponent(src));
    const bytes = new Uint8Array(await readFile(path));

    // fileName 只是 relay 在磁盘上的名字——它必须在每个草稿包内唯一，
    // 且不含路径分隔符。它并不需要与 src 匹配。
    let fileName = basename(src).replace(/[^a-zA-Z0-9._-]/g, '_') || 'image.bin';
    while (taken.has(fileName)) fileName = `x-${fileName}`;
    taken.add(fileName);

    assets.push({ key: `img-${assets.length}`, src, fileName, mime: mimeOf(path), bytes });
  }
  return assets;
}
```

远程图片（`https://...` 的 src）必须由*你*这一端预先下载进 `bytes`——扩展自己从不去抓取图片 URL。如果你想用纯文本兜底模式，先运行 `toPlaintextMarkdown(markdown)`，把*结果*作为草稿包的 markdown 并带上 `mode: 'plaintext'` 推送，然后从那份最终文本派生 asset，这样 src 才仍然对得齐。

这一切的参考实现（包括远程下载和 frontmatter 处理）就是 CLI 的 [`bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts)。

### 3. 发布草稿

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

`postDraft` 会生成草稿 id、把字节做 base64 编码，并发送单个 JSON 请求体——没有 multipart。成功后 relay 会把草稿包存放在 `~/.kaitox/<kind>/outbox/<id>/` 下（如 `~/.kaitox/x-article/outbox/<id>/`），状态为 `pending`。

### 4. 轮询结果

草稿的生命周期是 `pending → uploading → done | failed`（扩展在工作过程中会 PATCH 状态）。轮询 `getDraft`：

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

注意：当一条草稿到达 `done` 时，relay 会把它从 `~/.kaitox/<kind>/outbox/` 移动到 `~/.kaitox/<kind>/sent/`。`GET /:kind/drafts/:id` 和 `GET /:kind/drafts` 列表仍然会包含它（状态为 `status: 'done'`）。

### 5. 可选：封面图

封面不会出现在 Markdown 正文里。它使用哨兵 src `'__cover__'`，它的字节在同一个线上 `assets` 数组中以 `cover.fileName` 为键随行——当你设置了 `input.cover` 时，`HttpRelayClient` 会自动处理这件事：

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

你还可以选择附加一个 `styleReport`（来自 `@kaitox/x-article` 的 `checkMarkdownStyle`），这样 `kaitox x list` 就会为你的草稿显示告警计数。

## 原始 HTTP 变体（任意语言）

对于非 Node 的技术栈，直接 POST `PostDraftWireBody` JSON。你必须自己生成草稿 id（UUID 是理想选择；relay 会把 id 净化为 `[a-zA-Z0-9_-]`）。确切的形状：

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

规则回顾：`bundle.assets[].src` 必须与 `collectImageSources(bundle.markdown)` 的输出完全一致；顶层的 `assets` 数组携带实际的字节（base64），以 `fileName` 为键，其中也包含封面的字节；`cover` 是可选的；`bundle.kind` 是可选的，但若存在则必须等于路由的 kind 路径段（无论如何 relay 都会把路径里的 kind 盖印到存储的草稿包上）；`bundle.status` / `restId` / `error` 必须省略——这些由 relay 掌管。格式错误的请求体会被以 `400 { error, issues }` 拒绝，其中每个 issue 都带有一个 JSONPath 风格的位置。

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

完整的 REST 接口面：`GET /health`、`GET /setting`、`PATCH /setting`（`{token?}`）、`POST /:kind/drafts`、`GET /:kind/drafts`、`GET /:kind/drafts/:id`、`GET /:kind/drafts/:id/assets/:fileName`（二进制）、`PUT /:kind/drafts/:id/cover`、`PATCH /:kind/drafts/:id`（`{status, restId?, error?}`）、`DELETE /:kind/drafts/:id`。kind 路径段必须匹配 `/^[a-z0-9][a-z0-9-]*$/` 且不能是保留字（`health`、`setting`、`drafts`）。v0.5 之前的根路由（`/drafts...`）会返回 `410 Gone` 并附带迁移提示。

服务端客户端不会遇到 CORS（没有 `Origin` 头的请求总是被允许）。任意来源的浏览器页面*会*被拦截——允许列表只覆盖 x.com/twitter.com、`chrome-extension://` 和 Obsidian。

## 鉴权

默认情况下 relay 接受任何本地请求。要求每次安装使用一个专属 token，可以创建 `~/.kaitox/config.json`：

```json
{ "token": "some-long-random-string" }
```

或者通过 `PATCH /setting` 在运行中的 relay 上设置它（立即生效，无需重启；如果已经配置了 token，请求必须出示它）：

```bash
curl -sS -X PATCH http://127.0.0.1:8765/setting \
  -H 'content-type: application/json' \
  --data '{"token":"some-long-random-string"}'
# → {"port":8765,"version":"...","tokenConfigured":true}
```

然后在除 `GET /health` 之外的每一个请求上发送这个头：

```js
const relay = new HttpRelayClient('http://127.0.0.1:8765', { token: 'some-long-random-string' });
```

```bash
curl -sS http://127.0.0.1:8765/x-article/drafts -H 'x-kaitox-token: some-long-random-string'
```

缺失或错误的 token → `401 {"error":"unauthorized"}`。`GET /setting` 会报告 `tokenConfigured` 但绝不会报告 token 值本身；带 `{"token":null}` 的 `PATCH /setting` 会清除它。

## 自定义 kind：把 relay 用于你自己的功能

X Articles 只是第一个 `kind`。relay 把 kind 路径段当作一个不透明字符串，因此 `kind: 'my-feature'` 的草稿包会获得自己的路由命名空间（`/my-feature/drafts`），relay 一点都不用改——而且 Kaitox 扩展永远看不到它们，因为它只轮询 `/x-article/drafts`。

生产者和消费端都使用一个按 kind 作用域的客户端：

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

挑一个满足路径段规则的 kind：`/^[a-z0-9][a-z0-9-]*$/`，且不是保留字之一（`health`、`setting`、`drafts`）。跨 kind 访问是不可见的：以某个 kind 发布的草稿在任何其他 kind 下都会 404。

## 排障

| 症状 | 原因 / 修复 |
| --- | --- |
| `ECONNREFUSED 127.0.0.1:8765` | relay 没有运行。`kaitox relay status`（或 `npx @kaitox/relay status`），然后 `kaitox relay --daemon` / `npx @kaitox/relay start`。如果你设置了 `KAITOX_RELAY_PORT`，请确保你的客户端指向同一个端口。 |
| `401 unauthorized` | `~/.kaitox/config.json` 里设置了 `token`，但你的请求缺少匹配的 `x-kaitox-token` 头。如果你在 relay 运行时手工编辑了配置文件，请重启它——或者使用立即生效的 `PATCH /setting`。`GET /health` 从不需要 token，所以健康检查通过并不能证明你的 token 有效。 |
| `410 Gone` on `/drafts` | 你在用 v0.5 之前的根路由。草稿路由现在按 kind 划分命名空间：`/x-article/drafts`（或你自己的 kind）。 |
| `400 {"error":"invalid draft bundle","issues":[...]}` | 线上请求体校验失败；每个 issue 都带有一个 JSONPath 风格的位置（例如 `$.bundle.assets[0].mime`）。修正列出的字段即可。 |
| `400 invalid kind path segment` | URL 里的 kind 必须匹配 `/^[a-z0-9][a-z0-9-]*$/` 且不能是 `health`/`setting`/`drafts`。 |
| 草稿永远卡在 `pending` | 没有任何东西在消费它。对于 `x-article`：必须已安装 Chrome 扩展、必须有一个停留在 `https://x.com/compose/articles` 的标签页（它每 5 秒轮询一次）、你必须已登录 X，且发布是在你于扩展 UI 中点击该草稿时才开始——这是刻意的、并非完全自动。对于自定义 kind：是你自己的消费端没有在运行。 |
| 草稿 `done` 了但文章里缺了一张图 | 那张图的 `assets[].src` 没有与 `collectImageSources(markdown)` 的输出完全一致。重新检查第 2 步——不允许任何规范化。 |
| asset 抓取时报 `400 {"error":"非法文件名"}`，或 asset 没有被写入 | `fileName` 含有路径分隔符，或解析成了 `.`/`..`。请使用裸的、唯一的文件名。 |
| 浏览器页面无法访问 relay（CORS 错误） | 只有 x.com/twitter.com、`chrome-extension://` 和 Obsidian 来源在允许列表里。改从你的服务器/CLI 进程推送（无 `Origin` 的请求是被允许的）。 |

## 另见

- [x-article-publish-protocol.md](./x-article-publish-protocol.zh-CN.md) —— 完整的端到端发布协议，以及草稿包为何携带原始 Markdown。
- [`@kaitox/relay-protocol`](../packages/relay-protocol/README.zh-CN.md) —— 线上类型（`DraftBundle`、`PostDraftWireBody`、……）与 `HttpRelayClient`。
- [`@kaitox/relay`](../packages/relay/README.zh-CN.md) —— relay 服务器本身。
- [`@kaitox/x-article`](../packages/x-article/README.zh-CN.md) —— `collectImageSources`、`deriveTitle`、`checkMarkdownStyle`、`toPlaintextMarkdown`。
