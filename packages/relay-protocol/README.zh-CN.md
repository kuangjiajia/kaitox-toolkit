[English](README.md) | 简体中文

# @kaitox/relay-protocol

Kaitox 上传端与本地 relay 之间的线上契约，外加一个可移植的 HTTP 客户端。

如果你想让自己的本地服务把草稿推进 Kaitox——让它们出现在 `https://x.com/compose/articles` 页面的 Chrome 插件里，或任何其他 Kaitox 消费端——这个包就是你需要的全部。它是：

- **零依赖。** 纯 TypeScript 类型 + `fetch` + 内置 base64。别无其他。
- **可移植。** `HttpRelayClient` 在 Node >= 18 和浏览器（任何有全局 `fetch` 的环境）中无需修改即可运行。
- **分层的根。** 这个包从不导入任何其他 Kaitox 包；功能引擎（如 [`@kaitox/x-article`](../x-article/README.md)）和 relay 服务器都依赖它，永远不会反过来。

仅 ESM。MIT。

## 安装

```sh
npm install @kaitox/relay-protocol
```

你还需要一个在本地运行的 relay（默认 `http://127.0.0.1:8765`）：

```sh
npm install -g @kaitox/relay
kaitox-relay start
```

守护进程管理、存储目录结构与配置见 [`@kaitox/relay`](../relay/README.md)。

## DraftBundle 模型

**草稿包**是一个工作单元：原始 Markdown + 图片字节 + 元数据，作为单个 JSON 文档 POST 出去。两个刻意的设计选择：

1. **草稿包携带原始 Markdown，而不是预先构建的 `content_state`。** 对 X Article 而言，图片的 `media_id` 只有在已登录的 x.com 页面里上传之后才存在——所以渲染必须发生在消费时、在插件里，而不是推送时。
2. **`assets[].src` 必须与 `collectImageSources(markdown)`（来自 `@kaitox/x-article`）从 Markdown 中提取的字符串逐字相等。** 消费端正是靠这种字符串同一性把每张已上传的图片映射回它在文档中的位置。一旦两者漂移，图片会被静默丢弃。这是整个协议里最重要的一条不变量。

### `DraftBundle`

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | `number` | 当前值即 `SCHEMA_VERSION` 常量（`1`）；用 `bundleSchemaVersion(b)` 读取（v0.2 磁盘草稿包上缺省即 `1`）。只在破坏性线上变更时递增。 |
| `id` | `string` | 由推送方分配（`HttpRelayClient` 默认使用 `crypto.randomUUID()`）。 |
| `kind?` | `DraftKind` | 功能判别字段。**缺省即 `'x-article'`**（磁盘上的 v0.2 草稿包早于该字段出现）——请通过规范访问器 `draftKind(b)` 读取（默认值即 `DEFAULT_DRAFT_KIND`）。relay 在 POST 时会用 `/:kind/drafts` 路径段盖章写入它，之后只存储和转发，不做解释。 |
| `title` | `string` | 草稿标题。 |
| `markdown` | `string` | 原始 Markdown 源。 |
| `mode` | `'rich' \| 'plaintext'` | 富文本渲染或纯文本兜底。 |
| `assets` | `DraftAsset[]` | 正文图片。`src` 值必须与 `collectImageSources(markdown)` 的输出逐字相等（见上文不变量）。 |
| `cover?` | `DraftAsset` | 可选封面图。不属于正文：它使用哨兵 `src: '__cover__'`，既不出现在 `markdown` 也不出现在 `assets` 里，其字节在线上 `assets` 数组中以 `cover.fileName` 为键传递。消费端在建好草稿之后单独上传它。 |
| `styleReport?` | `StyleReport` | 可选的事前风格检查结果（`{ friendly, issues, counts }`）。 |
| `createdAt` | `string` | ISO 8601 时间戳。 |
| `source` | `DraftSource` | 产生它的推送方：`'cli' \| 'obsidian' \| 'unknown'`，或任何你自己的字符串。 |
| `sourceMeta?` | `Record<string, unknown>` | 推送方的自由格式元数据。 |
| `status?` | `DraftStatus` | **由 relay 维护。** `'pending' \| 'uploading' \| 'done' \| 'failed'`。 |
| `restId?` | `string` | **由 relay 维护。** 成功后由消费端回填（对 X Article 而言是文章的 `rest_id`）。 |
| `error?` | `string` | **由 relay 维护。** 失败信息，通过 `ack` 设置。 |

这三个由 relay 维护的字段不包含在你 POST 的内容里——线上请求体中的 bundle 类型为 `Omit<DraftBundle, 'status' | 'restId' | 'error'>`。

### `DraftAsset`

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | `string` | 稳定键，如 `"img-0"`。Obsidian 用它做 wikilink 重写；也可以直接等于 `src`。 |
| `src` | `string` | Markdown 中出现的原样 src 字符串。必须等于某个 `collectImageSources` 的输出（封面则为 `'__cover__'`）。 |
| `fileName` | `string` | relay 存储字节所用的文件名（`assets/<fileName>`），你取回字节时也用它。 |
| `mime` | `string` | 如 `image/png`。 |
| `bytesLen` | `number` | 字节长度，用于展示/校验。 |
| `sha256?` | `string` | 可选的完整性校验和。 |

### `DraftListItem`

`GET /:kind/drafts` 返回的轻量形态——没有 `markdown`，没有字节：

| 字段 | 类型 |
|---|---|
| `id` | `string` |
| `kind?` | `DraftKind`（缺省 = `'x-article'`） |
| `title` | `string` |
| `source` | `DraftSource` |
| `createdAt` | `string` |
| `mode` | `DraftMode` |
| `status` | `DraftStatus` |
| `counts?` | `{ error: number; warning: number; info: number }` |
| `assetCount` | `number` |

### 开放字符串联合

`DraftKind` 和 `DraftSource` 声明为：

```ts
export type DraftKind = 'x-article' | (string & {});
export type DraftSource = 'cli' | 'obsidian' | 'unknown' | (string & {});
```

`(string & {})` 这个技巧既保留了已知字面量的编辑器自动补全，又**接受任意字符串**——第三方功能和推送方引入自己的值时，永远不需要修改协议。

## REST 契约

Base URL 默认为 `http://127.0.0.1:8765`（以 `DEFAULT_RELAY_BASE` / `DEFAULT_RELAY_PORT` 导出）。relay 只绑定 `127.0.0.1`；端口可通过 `KAITOX_RELAY_PORT` 配置，存储位于 `KAITOX_HOME`（默认 `~/.kaitox`）之下。

草稿路由按 `kind` 命名空间化（`/:kind/drafts...`）：路径段就是**原样的 kind 字符串**，relay 把它当作不透明参数——只存储、过滤和匹配，从不解释。kind 路径段必须匹配 `/^[a-z0-9][a-z0-9-]*$/`，且不能是保留字（`health`、`setting`、`drafts`）；这条规则以 `isValidKindSegment` 导出（连同 `RESERVED_KIND_SEGMENTS`）。v0.5 之前的根路由（`/drafts*`）应答 `410 Gone` 并附迁移提示。

| 方法 | 路径 | 请求体 | 成功 | 错误 |
|---|---|---|---|---|
| `GET` | `/health` | — | `200` `{ ok, version, port }` | —（免 token） |
| `GET` | `/setting` | — | `200` `{ port, version, tokenConfigured }`——永不返回 token 值 | `401` |
| `PATCH` | `/setting` | `{ token?: string \| null }`（`null` 表示清除；即时生效，无需重启） | `200` `{ port, version, tokenConfigured }` | `400`、`401` |
| `POST` | `/:kind/drafts` | `PostDraftWireBody`（JSON） | `201` `{ id }`——`kind` 由路径段盖章写入 | `400`（请求体非法，或 `bundle.kind` 与路径不一致）、`401` |
| `GET` | `/:kind/drafts` | — | `200` `DraftListItem[]`，服务端按 kind 过滤（含 `sent/` 里已完成的草稿） | `401` |
| `GET` | `/:kind/drafts/:id` | — | `200` `DraftBundle`（先查 outbox，再查 sent） | `401`、`404`（跨 kind 访问同样 404） |
| `GET` | `/:kind/drafts/:id/assets/:fileName` | — | `200` 二进制（`application/octet-stream`） | `400`（非法文件名）、`401`、`404` |
| `PUT` | `/:kind/drafts/:id/cover` | `SetCoverWireBody`（JSON） | `200` 更新后的 `DraftBundle` | `400`、`401`、`404` |
| `PATCH` | `/:kind/drafts/:id` | `{ status, restId?, error? }` | `200` 更新后的 `DraftBundle`；`done` 会把它移到 `sent/` | `400`、`401`、`404` |
| `DELETE` | `/:kind/drafts/:id` | — | `200` `{ deleted: true }` | `401`、`404` `{ deleted: false }` |

`OPTIONS` 预检恒应答 `204`。未处理的错误应答 `500` `{ error }`。

畸形的请求体会被拒绝为 `400` `{ error, issues }`，每条 issue 携带 JSONPath 风格的 `path` 和一条 `message`。relay 所用的校验器就从本包导出——`validatePostDraftWireBody`、`validateSetCoverWireBody`、`validateAckPatch`、`validateSettingPatch`（类型为 `WireResult` / `WireIssue`）。它们零依赖且刻意宽松：未知字段直接放行，开放的 `kind`/`source` 字符串值不受约束。

`POST /:kind/drafts` 的请求体是单个 JSON 文档——没有 multipart，所以 relay 除 Node 内置模块外不需要任何解析器：

```ts
export interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}
```

`wire.assets` **同时**携带正文图片和封面的字节（封面的字节以 `bundle.cover.fileName` 为键）。`PUT /:kind/drafts/:id/cover` 通过 `SetCoverWireBody`（`{ fileName, mime, base64 }`）沿用同样的 base64 编码。资产下载则走相反方向，以原始二进制传输，因为那是更热、对带宽更敏感的路径。

### 鉴权：`x-kaitox-token`

鉴权默认关闭。如果 `~/.kaitox/config.json` 里有 token：

```json
{ "token": "some-long-random-string" }
```

那么除 `GET /health` 和 `OPTIONS` 之外的每个请求都必须以 `x-kaitox-token` 请求头发送它，否则得到 `401` `{ "error": "unauthorized" }`。

token 也可以在运行中的 relay 上管理：`GET /setting` 报告 `{ port, version, tokenConfigured }`（永不返回 token 值本身）；`PATCH /setting` 携带 `{ "token": "..." }` 设置它——`{ "token": null }` 清除——即时生效，无需重启。若已配置 token，这个 `PATCH` 和其他请求一样必须先出示它。

### CORS

浏览器 origin 采用白名单：`x.com`、`twitter.com`、`mobile.twitter.com`、任意 `chrome-extension://` origin，以及 `app://obsidian.md`（Obsidian 桌面端）。**不带** `Origin` 请求头的请求——CLI 工具、curl、服务端代码，也就是一切不是跨域浏览器页面的东西——总是放行。因此另一个 origin 上的第三方*网页*无法直接调用 relay；请改从服务器或 CLI 进程推送。

## HttpRelayClient

`RelayClient` 接口的一个基于 `fetch` 的实现，Node 和浏览器都能用。（未来的）云端 relay 只需实现同一接口，就能作为替代品直接换上。

```ts
new HttpRelayClient(baseUrl?, opts?)
```

- `baseUrl`——默认 `http://127.0.0.1:8765`（即 `DEFAULT_RELAY_BASE`；末尾斜杠会被去掉）。
- `opts.kind`——客户端的 **kind 作用域**（默认 `'x-article'`）：它决定每次草稿调用的 `/:kind/drafts` 路径段，以及推送草稿时盖章写入的 `kind`，如 `new HttpRelayClient(base, { kind: 'my-feature' })`。
- `opts.fetchImpl`——注入一个 `fetch`（默认用全局的；不存在时在构造阶段抛错）。
- `opts.token`——每机 token，随每个请求以 `x-kaitox-token` 发送。
- `opts.makeId`——id 工厂，默认 `crypto.randomUUID`。
- `opts.now`——时间戳工厂，默认 `() => new Date().toISOString()`。

所有草稿方法都按客户端的 kind 作用域访问 `/:kind/drafts...`：

| 方法 | 返回 | 作用 |
|---|---|---|
| `health()` | `{ ok, version, port? }` | `GET /health` 存活探测。 |
| `postDraft(input)` | `{ id }` | 填好 `id`/`createdAt`/`kind`，把所有字节（含封面）编码为 base64，`POST /:kind/drafts`。 |
| `listDrafts()` | `DraftListItem[]` | `GET /:kind/drafts`——服务端已按客户端的 kind 过滤。 |
| `getDraft(id)` | `DraftBundle` | `GET /:kind/drafts/:id`。 |
| `getAsset(id, fileName)` | `Uint8Array` | 以二进制获取 `GET /:kind/drafts/:id/assets/:fileName`。 |
| `setCover(id, cover)` | `void` | 以 `SetCoverWireBody` 调 `PUT /:kind/drafts/:id/cover`（设置或替换封面）。 |
| `ack(id, patch)` | `void` | 以 `{ status, restId?, error? }` 调 `PATCH /:kind/drafts/:id`。 |
| `deleteDraft(id)` | `void` | `DELETE /:kind/drafts/:id`。 |

任何非 2xx 响应都会使方法抛出 `RelayHttpError`，它携带 `method`、`url`、`status` 以及（若可得）响应 `body`——消费方可按状态码程序化分支，如 `401` → 提示配置 token。

### 推送草稿

`postDraft` 接受一个 `PostDraftInput`：结构和 bundle 一样，只是每个资产是携带内存中 `bytes: Uint8Array`（而非 `bytesLen`）的 `DraftAssetInput`，且 `id`/`createdAt`/`schemaVersion`/`kind` 会替你填好——`kind` 来自客户端的作用域。`input.kind` 仍可作单次调用的覆盖；它同时决定路由的路径段和 `bundle.kind`，两者因此永远一致。

```ts
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import { collectImageSources } from '@kaitox/x-article';

const relay = new HttpRelayClient(); // http://127.0.0.1:8765, kind-scoped to 'x-article'

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
  // kind comes from the client's scope ('x-article'); POST /x-article/drafts
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

relay 会把它存到 `~/.kaitox/outbox/<id>/` 下（`bundle.json` + `assets/<fileName>`）。对于 `kind: 'x-article'` 的草稿，Kaitox Chrome 插件轮询 `/x-article/drafts`，并在点击时用用户自己已登录的 x.com 会话创建 Article 草稿。

> **合规提示。** 以这种方式发布 X Article，是驱动用户自己已登录的浏览器会话去调 X 的私有网页接口。这属非官方用法，X 轮换 queryId 时随时可能失效，且不应用于批量自动化。风险自担。

### 消费草稿

同一契约的消费端——这基本就是 Chrome 插件做的事：

```ts
import { HttpRelayClient } from '@kaitox/relay-protocol';

const relay = new HttpRelayClient(); // kind-scoped to 'x-article'

// GET /x-article/drafts — the server already filtered by kind.
const pending = (await relay.listDrafts()).filter((d) => d.status === 'pending');

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

kind 过滤如今发生在服务端。当你确实要从 bundle 或列表项上读 `kind` 时，请用规范访问器 `draftKind(b)`——缺省（只可能出现在遗留磁盘草稿包上）仍意味着 `'x-article'`。

## base64 工具

字节在 `POST /:kind/drafts` 的 JSON 里以 base64 传输。两个工具函数在两种运行时都可用——有 `Buffer` 时用 `Buffer`，否则用分块的 `btoa`/`atob`：

```ts
import { bytesToBase64, base64ToBytes } from '@kaitox/relay-protocol';

const b64 = bytesToBase64(new Uint8Array([1, 2, 3]));
const bytes = base64ToBytes(b64);
```

`HttpRelayClient.postDraft` 会替你调用 `bytesToBase64`；只有手写 REST 契约时才需要它们。

## 用你自己的功能扩展 Kaitox

`kind` 判别字段让 relay 成为一个通用的本地草稿队列：

1. **推送**时用一个以 kind 为作用域的客户端：`new HttpRelayClient(base, { kind: 'my-feature' })`。任何满足路径段规则（`/^[a-z0-9][a-z0-9-]*$/`，且不是 `health`/`setting`/`drafts`——可用 `isValidKindSegment` 检查）的字符串都合法——不需要修改协议。
2. **relay 原样存储和转发 `kind`。** 它从不解释这个字段；你的草稿包和 `x-article` 草稿在磁盘上躺在同一个 outbox 里，但拥有自己的路由命名空间（`/my-feature/drafts`）——跨 kind 访问一律 404。
3. **消费**时用同一个 kind 作用域客户端：`listDrafts()` 只返回你的 kind（服务端已过滤），再用 `ack` 驱动 `pending → uploading → done | failed` 生命周期。

你的功能免费获得持久化、REST 接口、CORS、可选 token 鉴权和一个共享客户端。完整演练见[接入你自己的本地服务](../../docs/integrate-local-service.zh-CN.md)；运行 relay 本身见 [`@kaitox/relay`](../relay/README.md)。

## 许可证

MIT © [kaitox](https://kaitox.ai)
