[English](integrate-browser-extension.md) | 简体中文

# 在你自己的浏览器扩展中消费 kaitox 草稿并发布 X Article

本指南介绍如何构建一个 Chrome 扩展（Manifest V3），让它从本地的 Kaitox relay 消费草稿包（draft
bundle），并将其转换成 X（Twitter）Article 草稿——这正是 [`apps/extension/`](../apps/extension/)
中的参考扩展所做的事情。

你需要两个已发布的包：

| 包 | 用途 |
| --- | --- |
| [`@kaitox/relay-protocol`](../packages/relay-protocol/README.zh-CN.md) | `HttpRelayClient`——与本地 relay（`http://127.0.0.1:8765`）通信（列出/获取/ack/删除草稿，拉取图片字节） |
| [`@kaitox/x-article`](../packages/x-article/README.zh-CN.md) | `publishXArticle`——Markdown → `content_state`、媒体上传（INIT/APPEND/FINALIZE）、`ArticleEntityDraftCreate`、可选封面 |

关于 relay 的线上格式和 REST 接口，以及 X 私有端点的细节，参见
[X Article 发布协议参考](./x-article-publish-protocol.zh-CN.md)。

## 概述：为什么上传要在页面内运行

整个发布步骤都运行在 **`https://x.com/compose/articles` 上的 content script** 里，
处于页面自身的 origin 中。这是一个刻意的设计决策：

- **同源 fetch 会自动携带会话，无需额外成本。** 对 `https://x.com/i/api/graphql/...`
  和 `https://upload.x.com/i/media/upload.json` 发起、并带上 `credentials: 'include'` 的请求，
  会自动发送用户已登录的 cookie。你的扩展从不接触、存储或传输密码或认证 token。
- **CSRF token 就在手边。** X 要求把 `ct0` cookie 的值作为 `x-csrf-token`
  头传回。`ct0` 不是 HttpOnly 的，所以 content script 可以从 `document.cookie` 读到它。
- **Media ID 只有在从已登录页面上传之后才存在。** 这正是为什么草稿包
  携带的是 **原始 Markdown 加图片字节**，而不是预先构建好的 `content_state`：
  `content_state` 需要 `media_id`，而这些 ID 只能通过从已登录会话上传图片才能取得。
  你的扩展在用户点击那一刻完成最后的转换。

分工如下：

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

关键不变量：`bundle.assets[].src` 与 `collectImageSources(bundle.markdown)` 的输出
逐字节相等。你正是靠它把每一个 Markdown 图片映射回它的字节。封面图片**不会**出现在
`assets` 中，也不会出现在 Markdown 中；它们单独随 `bundle.cover` 一起传递（其字节像其他任何
asset 一样，存储在 `cover.fileName` 之下）。

## 必需的 manifest 片段

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

说明：

- content script **必须**匹配到 `https://x.com/compose/articles*`——也就是文章
  编辑器/列表页。已登录会话就在这里，创建出来的草稿也在这里打开
  （`/compose/articles/edit/<restId>`）。
- `host_permissions` 覆盖了 GraphQL 主机（`x.com`）、媒体上传主机（`upload.x.com`）、
  旧域名（`twitter.com`）以及本地 relay（`http://127.0.0.1:8765/*`）。
- content script 对 relay 的 fetch 是带 `Origin: https://x.com` 的 CORS 请求；
  relay 内置的白名单允许 `x.com`、`twitter.com`、`mobile.twitter.com`、任意
  `chrome-extension://` origin 以及 `app://obsidian.md`，因此无需代理。来自你 service worker
  （`chrome-extension://` origin）的 fetch 同样被允许。
- `storage` 和 `alarms` 是**可选的**：如果你想要用户可覆盖的设置
  （relay URL、token、queryId——推荐，见第 5 步），就用 `storage`；如果你想要后台
  角标计数器，就用 `alarms`。

## 逐步演练

### 1. 安装与打包

```bash
npm i @kaitox/x-article @kaitox/relay-protocol
```

这两个包都是**仅 ESM**（Node >= 18 / 现代浏览器）。Chrome content script 是
经典脚本，而非模块，所以**必须使用打包器**——用 esbuild 或 Vite 编译成一个自包含的
IIFE。用 esbuild：

```bash
npx esbuild src/content.ts --bundle --format=iife --target=chrome110 --outfile=dist/content.js
```

或者写成一个构建脚本（这与 [`apps/extension/esbuild.mjs`](../apps/extension/esbuild.mjs) 一致）：

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

通过 `chrome://extensions` 把 `dist/` 作为未打包扩展加载。

### 2. 创建 relay 客户端

`HttpRelayClient` 接收一个注入的 `fetch`。在 content script 中，把它绑定到 `window`——
一个未绑定的 `fetch` 引用在通过字段调用时会抛出 `Illegal invocation`。

```ts
// relay.ts
import { HttpRelayClient, DEFAULT_RELAY_BASE } from '@kaitox/relay-protocol';

export function makeRelayClient(token?: string): HttpRelayClient {
  // 默认按 kind 限定为 'x-article'：所有请求都发往 /x-article/drafts...，
  // 因此 relay 只会向这个客户端展示 X Article 草稿。
  return new HttpRelayClient(DEFAULT_RELAY_BASE, {
    fetchImpl: window.fetch.bind(window),
    token, // 来自 ~/.kaitox/config.json 的可选 per-install token，作为 x-kaitox-token 发送
  });
}
```

如果用户在 `~/.kaitox/config.json` 中配置了 token，那么除 `GET /health` 外的每一个 relay
请求都需要它；让用户把它粘贴进你的扩展设置，并在这里传入。

### 3. 轮询待处理草稿

轮询 `listDrafts()`（参考扩展使用 5 秒间隔），并过滤出尚未完成的草稿。kind 路由发生在
服务端：客户端按 kind 限定，`GET /x-article/drafts` 只返回 X Article 草稿（包括在 `kind`
字段出现之前写入的旧草稿包），因此不需要客户端侧的 kind 过滤：

```ts
// poll.ts
import type { DraftListItem } from '@kaitox/relay-protocol';
import { makeRelayClient } from './relay.js';

const POLL_MS = 5000;
const client = makeRelayClient();

async function fetchPending(): Promise<DraftListItem[]> {
  await client.health(); // 如果 relay 未运行则抛出
  const items = await client.listDrafts();
  return items.filter((d) => d.status !== 'done');
}

setInterval(async () => {
  try {
    const pending = await fetchPending();
    renderYourUi(pending); // 你的角标 / 列表 / 按钮
  } catch {
    // Relay 离线。提示用户运行 `kaitox relay`（`kaitox x push` 也会启动它）。
  }
}, POLL_MS);
```

`DraftListItem` 是一个轻量投影（`id`、`kind?`、`title`、`source`、`createdAt`、
`mode`、`status`、`counts?`、`assetCount`）——不含 Markdown，不含字节。只有当用户真正
点击上传时，才去获取完整的草稿包。

### 4. 上传单个草稿

单个草稿的完整生命周期，与
[`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts) 以及
[`apps/extension/src/panel.tsx`](../apps/extension/src/panel.tsx) 中的
`doUpload` 流程一致：

1. `ack(id, { status: 'uploading' })`——让其他消费端/UI 看到它正在被处理。
2. `getDraft(id)`——获取完整的 `DraftBundle`（Markdown + asset 元数据）。
3. `publishXArticle(...)`，配合一个自定义的 `fetchImage`，把每个 Markdown 图片
   `src` 解析到它对应的草稿包 asset，并从 relay 拉取字节。
4. 成功时：`ack(id, { status: 'done', restId })`。失败时：
   `ack(id, { status: 'failed', error })`。

```ts
// uploader.ts
import { publishXArticle } from '@kaitox/x-article';
import type { ImageFetcher, CoverFetcher } from '@kaitox/x-article';
import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';

/** 读取 ct0 cookie（非 HttpOnly）——X 需要它作为 x-csrf-token 头传回。 */
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

  // 正文图片：markdown src -> 草稿包 asset（按 src 匹配）-> relay 字节。
  // bundle.assets[].src 始终等于 collectImageSources(markdown) 的输出，所以
  // publishXArticle 请求的每一个 src 都恰好有唯一一个匹配的 asset。
  const fetchImage: ImageFetcher = async (src: string) => {
    const asset = draft.assets.find((a) => a.src === src);
    if (!asset) throw new Error(`No asset in bundle for image src: ${src}`);
    const bytes = await client.getAsset(draft.id, asset.fileName);
    return { bytes, mimeType: asset.mime };
  };

  // 封面（可选）。publishXArticle 只有在草稿已存在
  // 且已取得 rest_id 之后才会调用它；封面字节像任何 asset 一样存放在 cover.fileName 之下。
  const cover = draft.cover;
  const fetchCover: CoverFetcher | undefined = cover
    ? async () => ({
        bytes: await client.getAsset(draft.id, cover.fileName),
        mimeType: cover.mime,
      })
    : undefined;

  const result = await publishXArticle({
    markdown: draft.markdown, // 已由上传端按 mode 处理过；原样使用
    title: draft.title,
    // bearerToken '' -> 回退到 DEFAULT_BEARER_TOKEN（公共的 web-client
    // bearer，被所有 x.com web 会话共享）。ct0 会成为 x-csrf-token 头。
    credentials: { bearerToken: '', csrfToken: ct0 },
    clientOptions: {
      fetchImpl: window.fetch.bind(window),
      credentialsMode: 'include', // 同源：浏览器会附上登录 cookie
    },
    fetchImage,
    fetchCover,
  });

  return { restId: result.restId, skippedImages: result.skippedImages };
}
```

以及用 relay ack 包裹它的点击处理器：

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
    // 在编辑器中打开刚创建好的草稿。
    if (result.restId) {
      location.assign(`/compose/articles/edit/${result.restId}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // .catch(() => {}) 这样一个已失效的 relay 不会掩盖原始错误。
    await client.ack(id, { status: 'failed', error: msg }).catch(() => {});
    throw err;
  }
}
```

值得了解的行为：

- **单张图片失败不会中断整篇文章。** `publishXArticle` 会跳过它、
  将其从正文中省略，并在 `result.skippedImages` 中报告。
- **`restId` 可能为 `undefined`**，如果 X 的响应结构发生变化、无法从中提取出 ID；
  草稿仍然会被创建——把用户引导到他们的文章列表即可。
- **封面永远不会进入正文。** 它在草稿创建之后才上传，并通过一个单独的
  `ArticleEntityUpdateCoverMedia` mutation 挂上去；封面失败不会影响已创建的草稿。
- 防范双击（参考扩展会维护一个由草稿 ID 组成的 `busy` 集合）。

### 5. 处理 queryId 轮换

X 的 GraphQL mutation 是以 `queryId` 寻址的，而 X 会不加通知地轮换它们。
`@kaitox/x-article` 将当前已知可用的值导出为常量：

```ts
import {
  ARTICLE_DRAFT_CREATE_QUERY_ID,        // ArticleEntityDraftCreate
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,  // ArticleEntityUpdateCoverMedia
} from '@kaitox/x-article';
```

当 X 轮换它们时，草稿创建会开始失败，直到该包更新。别让你的用户
干等一个发布版本：把 queryId 做成**用户可覆盖**的，就像参考扩展用
`chrome.storage.sync` 所做的那样
（见 [`apps/extension/src/xsession.ts`](../apps/extension/src/xsession.ts)）：

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

/** 解析顺序：用户覆盖值（chrome.storage.sync）-> 内置常量。 */
export async function getSettings(): Promise<Settings> {
  let stored: Record<string, any> = {};
  try {
    stored = await chrome.storage.sync.get(['queryId', 'coverQueryId']);
  } catch {
    /* storage 不可用 -> 使用常量 */
  }
  return {
    queryId: stored.queryId || ARTICLE_DRAFT_CREATE_QUERY_ID,
    coverQueryId: stored.coverQueryId || ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
  };
}
```

通过 `clientOptions` 把解析出来的值喂给 `publishXArticle`：

```ts
const { queryId, coverQueryId } = await getSettings();

const result = await publishXArticle({
  // ...与第 4 步相同...
  clientOptions: {
    fetchImpl: window.fetch.bind(window),
    credentialsMode: 'include',
    articleDraftCreateQueryId: queryId,
    updateCoverMediaQueryId: coverQueryId,
  },
});
```

在轮换发生后寻找一个新的 queryId：在 `x.com/compose/articles` 上打开
DevTools → Network，手动保存任意一篇文章草稿，然后查看请求 URL
`https://x.com/i/api/graphql/<queryId>/ArticleEntityDraftCreate`（对
`ArticleEntityUpdateCoverMedia` 也是同样的思路）。把那个值填进你的设置界面。

## 参考实现

[`apps/extension/`](../apps/extension/) 是上述所有内容的权威、可运行实现（私有，未发布到 npm）：

- [`manifest.json`](../apps/extension/manifest.json)——本指南片段所提炼自的那份 MV3 manifest。
- [`src/uploader.ts`](../apps/extension/src/uploader.ts)——精确的 `fetchImage`/`fetchCover`/`publishXArticle` 接线。
- [`src/xsession.ts`](../apps/extension/src/xsession.ts)——`ct0` 读取、relay 客户端构造、带 queryId 覆盖的设置。
- [`src/panel.tsx`](../apps/extension/src/panel.tsx)——5 秒轮询、`status` 过滤（kind 路由由按 kind 限定的客户端在服务端完成）、上传前后的 ack 生命周期、busy 防护、带确认的删除。
- [`src/background.ts`](../apps/extension/src/background.ts)——使用 `alarms` 的可选 service-worker 角标计数器（周期 1 分钟；service worker 无法每 5 秒轮询一次——Chrome 会挂起它们）。
- [`esbuild.mjs`](../apps/extension/esbuild.mjs)——IIFE 打包配置。

## 合规警告

它驱动的是**用户自己已登录的浏览器会话**，针对 X 的**私有 web
端点**（`/i/api/graphql/...`、`upload.x.com`）。这是非官方的：X 可能随时更改或
破坏这些端点（queryId 轮换是最常见的破坏方式），而自动化一个用户会话
可能与 X 的服务条款相冲突。风险自负，仅将其用于用户自己的手动、低频发布
——不要进行大规模自动化。
