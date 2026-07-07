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
| `schemaVersion` | `1` | 字面量。只在破坏性线上变更时递增。 |
| `id` | `string` | 由推送方分配（`HttpRelayClient` 默认使用 `crypto.randomUUID()`）。 |
| `kind?` | `DraftKind` | 功能判别字段。**缺省即 `'x-article'`**（磁盘上的 v0.2 草稿包早于该字段出现）。relay 只存储和转发它，不做解释。 |
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

`GET /drafts` 返回的轻量形态——没有 `markdown`，没有字节：

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

Base URL 默认为 `http://127.0.0.1:8765`。relay 只绑定 `127.0.0.1`；端口可通过 `KAITOX_RELAY_PORT` 配置，存储位于 `KAITOX_HOME`（默认 `~/.kaitox`）之下。

| 方法 | 路径 | 请求体 | 成功 | 错误 |
|---|---|---|---|---|
| `GET` | `/health` | — | `200` `{ ok, version, port }` | —（免 token） |
| `POST` | `/drafts` | `PostDraftWireBody`（JSON） | `201` `{ id }` | `401` |
| `GET` | `/drafts` | — | `200` `DraftListItem[]` | `401` |
| `GET` | `/drafts/:id` | — | `200` `DraftBundle` | `401`、`404` |
| `GET` | `/drafts/:id/assets/:fileName` | — | `200` 二进制（`application/octet-stream`） | `400`（非法文件名）、`401`、`404` |
| `PATCH` | `/drafts/:id` | `{ status, restId?, error? }` | `200` 更新后的 `DraftBundle` | `401`、`404` |
| `DELETE` | `/drafts/:id` | — | `200` `{ deleted: true }` | `401`、`404` `{ deleted: false }` |

`OPTIONS` 预检恒应答 `204`。未处理的错误应答 `500` `{ error }`。

`POST /drafts` 的请求体是单个 JSON 文档——没有 multipart，所以 relay 除 Node 内置模块外不需要任何解析器：

```ts
export interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}
```

`wire.assets` **同时**携带正文图片和封面的字节（封面的字节以 `bundle.cover.fileName` 为键）。资产下载则走相反方向，以原始二进制传输，因为那是更热、对带宽更敏感的路径。

### 鉴权：`x-kaitox-token`

鉴权默认关闭。如果 `~/.kaitox/config.json` 里有 token：

```json
{ "token": "some-long-random-string" }
```

那么除 `GET /health` 和 `OPTIONS` 之外的每个请求都必须以 `x-kaitox-token` 请求头发送它，否则得到 `401` `{ "error": "unauthorized" }`。

### CORS

浏览器 origin 采用白名单：`x.com`、`twitter.com`、`mobile.twitter.com`、任意 `chrome-extension://` origin，以及 `app://obsidian.md`（Obsidian 桌面端）。**不带** `Origin` 请求头的请求——CLI 工具、curl、服务端代码，也就是一切不是跨域浏览器页面的东西——总是放行。因此另一个 origin 上的第三方*网页*无法直接调用 relay；请改从服务器或 CLI 进程推送。

## HttpRelayClient

`RelayClient` 接口的一个基于 `fetch` 的实现，Node 和浏览器都能用。（未来的）云端 relay 只需实现同一接口，就能作为替代品直接换上。

```ts
new HttpRelayClient(baseUrl?, opts?)
```

- `baseUrl`——默认 `http://127.0.0.1:8765`（末尾斜杠会被去掉）。
- `opts.fetchImpl`——注入一个 `fetch`（默认用全局的；不存在时在构造阶段抛错）。
- `opts.token`——每机 token，随每个请求以 `x-kaitox-token` 发送。
- `opts.makeId`——id 工厂，默认 `crypto.randomUUID`。
- `opts.now`——时间戳工厂，默认 `() => new Date().toISOString()`。

| 方法 | 返回 | 作用 |
|---|---|---|
| `health()` | `{ ok, version, port? }` | `GET /health` 存活探测。 |
| `postDraft(input)` | `{ id }` | 填好 `id`/`createdAt`，把所有字节（含封面）编码为 base64，`POST /drafts`。 |
| `listDrafts()` | `DraftListItem[]` | `GET /drafts`。 |
| `getDraft(id)` | `DraftBundle` | `GET /drafts/:id`。 |
| `getAsset(id, fileName)` | `Uint8Array` | 以二进制获取 `GET /drafts/:id/assets/:fileName`。 |
| `ack(id, patch)` | `void` | 以 `{ status, restId?, error? }` 调 `PATCH /drafts/:id`。 |
| `deleteDraft(id)` | `void` | `DELETE /drafts/:id`。 |

任何非 2xx 响应都会使方法抛出携带 HTTP 状态码的 `Error`。

### 推送草稿

`postDraft` 接受一个 `PostDraftInput`：结构和 bundle 一样，只是每个资产是携带内存中 `bytes: Uint8Array`（而非 `bytesLen`）的 `DraftAssetInput`，且 `id`/`createdAt`/`schemaVersion` 会替你填好。

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

relay 会把它存到 `~/.kaitox/outbox/<id>/` 下（`bundle.json` + `assets/<fileName>`）。对于 `kind: 'x-article'` 的草稿，Kaitox Chrome 插件轮询 relay，并在点击时用用户自己已登录的 x.com 会话创建 Article 草稿。

> **合规提示。** 以这种方式发布 X Article，是驱动用户自己已登录的浏览器会话去调 X 的私有网页接口。这属非官方用法，X 轮换 queryId 时随时可能失效，且不应用于批量自动化。风险自担。

### 消费草稿

同一契约的消费端——这基本就是 Chrome 插件做的事：

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

过滤时永远把缺失的 `kind` 当作 `'x-article'`。

## base64 工具

字节在 `POST /drafts` 的 JSON 里以 base64 传输。两个工具函数在两种运行时都可用——有 `Buffer` 时用 `Buffer`，否则用分块的 `btoa`/`atob`：

```ts
import { bytesToBase64, base64ToBytes } from '@kaitox/relay-protocol';

const b64 = bytesToBase64(new Uint8Array([1, 2, 3]));
const bytes = base64ToBytes(b64);
```

`HttpRelayClient.postDraft` 会替你调用 `bytesToBase64`；只有手写 REST 契约时才需要它们。

## 用你自己的功能扩展 Kaitox

`kind` 判别字段让 relay 成为一个通用的本地草稿队列：

1. **推送**时带上你自己的 kind：`postDraft({ kind: 'my-feature', ... })`。任意字符串都合法——不需要修改协议。
2. **relay 原样存储和转发 `kind`。** 它从不解释这个字段；你的草稿包和 `x-article` 草稿躺在同一个 outbox 里。
3. **消费**时做过滤：`listDrafts()` 之后保留 `(d.kind ?? 'x-article') === 'my-feature'` 的条目，并用 `ack` 驱动 `pending → uploading → done | failed` 生命周期。

你的功能免费获得持久化、REST 接口、CORS、可选 token 鉴权和一个共享客户端。完整演练见[接入你自己的本地服务](../../docs/integrate-local-service.md)；运行 relay 本身见 [`@kaitox/relay`](../relay/README.md)。

## 许可证

MIT © [kaitox](https://kaitox.ai)
