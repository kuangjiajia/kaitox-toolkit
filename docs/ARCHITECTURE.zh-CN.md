[English](ARCHITECTURE.md) | 简体中文

# Kaitox 架构

面向 Kaitox monorepo 贡献者/维护者的文档。面向用户的安装配置见[根 README](../README.zh-CN.md)；X Article 的线上协议细节见
[x-article-publish-protocol.zh-CN.md](./x-article-publish-protocol.zh-CN.md)。

Kaitox 是一套个人工具集：一系列产品 —— `kaitox` CLI、一个
Obsidian 插件、一个 Chrome 扩展（MV3），以及 `skills/` 下的 agent skills ——
构建在共享的本地基础设施（relay 及其 wire 协议）之上。功能横跨多个产品；把
Markdown 发布为 X（Twitter）Article 草稿是第一个功能，后续更多功能通过草稿包上的 `kind`
判别字段接入。

X 功能的数据流：

```
CLI / Obsidian / your service          local relay              Chrome extension (MV3)
        │                          http://127.0.0.1:8765        on x.com/compose/articles
        │  POST /x-article/drafts          │                            │
        │  raw Markdown + image bytes      │                            │
        │  (base64, single JSON)           │                            │
        ├─────────────────────────────────▶│  ~/.kaitox/x-article/      │
        │                                  │    outbox/<id>/            │
        │                                  │      bundle.json           │
        │                                  │      assets/<fileName>     │
        │                                  │◀──── polls every 5s ──────┤
        │                                  │  GET /x-article/drafts     │
        │                                  │  GET assets (bytes)        │
        │                                  │                            │ click or auto URL: uploads images +
        │                                  │◀─ PATCH /x-article/… ─────┤ creates the Article draft
        │                                  │      done/failed           │ with the page's own session
```

草稿包刻意携带的是**原始 Markdown，而不是预先构建好的
`content_state`** —— 图片的 `media_id` 只有在扩展从已登录的 x.com 页面上传字节之后才存在，因此
Markdown → `content_state` 的转换必须在那里发生。

> **合规说明。** 发布这一步驱动的是用户自己已登录的浏览器会话，针对
> X 的私有网页接口。这是非官方的，随时可能因为 X 轮换 queryIds 而失效，且不得用于大规模自动化。在任何指导用户发布的文档中都要保留这一说法。

## 1. 仓库结构

```
kaitox/
├── packages/
│   ├── relay-protocol/      # @kaitox/relay-protocol — 零依赖线上契约：
│   │                        #   DraftBundle 类型、RelayClient、HttpRelayClient、base64 辅助函数
│   ├── x-article/           # @kaitox/x-article — X 引擎：Markdown → content_state，
│   │                        #   XArticleClient、publishXArticle、风格检查器、纯文本兜底
│   ├── relay/               # @kaitox/relay — 运行在 127.0.0.1 的本地 relay 服务器，
│   │                        #   入库时重编码超大图片，bin: kaitox-relay (start|dev|stop|status|restart)
│   └── cli/                 # @kaitox/cli — bin: kaitox (kaitox x push|list|status, kaitox relay ...)
├── apps/
│   ├── extension/           # Chrome 扩展（MV3），私有 — 轮询 relay，位于
│   │                        #   x.com/compose/articles，点击或显式自动上传 URL 触发上传草稿
│   └── obsidian/            # Obsidian 插件，私有 — 把当前笔记推送到 relay
├── skills/
│   └── kaitox-x-article/SKILL.md   # agent skill：教编码 agent 驱动 kaitox x push
├── test/
│   ├── integration.mjs             # 端到端套件：进程内 relay + 被 mock 的 X API
│   └── relay-protocol.smoke.mjs    # 仅协议的冒烟测试，像第三方一样使用 relay-protocol
├── docs/
│   ├── ARCHITECTURE.md             # 本文件
│   ├── integrate-local-service.md      # 从你自己的服务推送草稿
│   ├── integrate-browser-extension.md  # 构建你自己的 relay 消费端/上传端
│   └── x-article-publish-protocol.md  # X 私有 API 的线上协议说明
├── .changeset/              # changesets 配置（apps 被忽略，packages 一起发布）
└── .github/workflows/       # ci.yml（构建 + 全部测试，Node 20/22），release.yml（changesets 发布）
```

全部四个 `packages/*` 都可发布到 npm（ESM-only，Node >= 18，MIT；版本由
changesets 管理 —— 见各自的 package.json；首次发布尚待进行）。`apps/*` 是私有的，从不发布。

## 2. 分层规则

**作为铁律：**

- `@kaitox/relay-protocol` **不从** workspace 导入任何东西。
- `@kaitox/x-article` 仅为 wire 类型依赖 `relay-protocol`（目前是
  [`packages/x-article/src/styleCheck.ts`](../packages/x-article/src/styleCheck.ts)
  中的 `StyleIssue`/`StyleReport`）。
- `@kaitox/relay` 依赖 `relay-protocol`。
- `@kaitox/cli` 依赖以上全部三个。
- `apps/*` 是叶子（它们依赖 `relay-protocol` + `x-article`，没有任何东西依赖它们）。

```
                 ┌────────────────────────┐
                 │ @kaitox/relay-protocol │   imports nothing from the workspace
                 └────────▲──────▲────────┘
                          │      │
            ┌─────────────┘      └─────────────┐
   ┌────────┴─────────┐               ┌────────┴──────┐
   │ @kaitox/x-article │               │ @kaitox/relay │
   └────────▲─────────┘               └────────▲──────┘
            │                                  │
            └───────────────┬──────────────────┘
                    ┌───────┴──────┐
                    │ @kaitox/cli  │   depends on all three
                    └──────────────┘

   apps/extension, apps/obsidian ──▶ relay-protocol + x-article   (leaves)
```

为什么这么做：它避免了依赖环，并让协议可以独立被消费 —— 第三方上传端只安装
`@kaitox/relay-protocol` 就能拿到完整的线上契约，且没有任何传递依赖。这也是为什么协议冒烟测试放在仓库根目录（[`test/relay-protocol.smoke.mjs`](../test/relay-protocol.smoke.mjs)）而不是包内部：这个包绝不能哪怕新增一个反向指向
`@kaitox/relay` 的 devDependency。

根目录 [`package.json`](../package.json) 中的 `build`/`typecheck` 脚本按依赖顺序枚举各个包（`relay-protocol` →
`x-article` → `relay` → `cli`）；新增包时保持这个顺序。

## 3. 硬性不变量

破坏其中任何一条，草稿都会悄无声息地停止上传。每一条都列出了定义、产生和消费它的代码位置。

### 3.1 `assets[].src` 必须与 `collectImageSources(markdown)` 的输出完全相等

- 契约：[`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts)
  （`DraftAsset.src` 的文档注释 —— "这是最关键的不变量"）。
- 产生方：[`packages/cli/src/bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts)
  和 [`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts) 遍历
  `collectImageSources(markdown)`，并**原样**存储每个解析出的 `src`。
- 消费方：[`packages/x-article/src/publishArticle.ts`](../packages/x-article/src/publishArticle.ts)
  在草稿包的 Markdown 上重新运行 `collectImageSources`，而
  [`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts)
  在从 relay 拉取字节之前，通过**精确字符串相等**（`draft.assets.find((a) => a.src === src)`）把每个报告出的
  `src` 解析回草稿包中的 asset。

绝不要只在一侧对 src 做归一化、解码或改写 —— 不匹配的 asset 会成为孤儿，图片会被跳过。`collectImageSources` 位于
[`packages/x-article/src/contentState.ts`](../packages/x-article/src/contentState.ts)。

### 3.2 `'__cover__'` 哨兵

封面图片不属于文章正文：`bundle.cover` 使用哨兵
`src: '__cover__'`，**不在** `bundle.assets` 中，也**不被**
Markdown 引用。它的字节仍然在线上 `assets` 数组中传输，并像其他 asset 一样落到磁盘上的 `assets/<cover.fileName>`。

- 产生：两个产生方（[`packages/cli/src/bundleBuilder.ts`](../packages/cli/src/bundleBuilder.ts)
  和 [`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts)）都调用来自
  [`packages/x-article/src/pushHelpers.ts`](../packages/x-article/src/pushHelpers.ts)
  的 `makeCoverAsset()` —— 这是唯一发出
  `{ key: 'cover', src: '__cover__', fileName: 'cover-…', mime, bytes }` 的地方。
- 线上打包：[`packages/relay-protocol/src/relayClient.ts`](../packages/relay-protocol/src/relayClient.ts)
  中的 `HttpRelayClient.postDraft` 把封面字节追加到 `wireAssets`。
- 消费：[`apps/extension/src/uploader.ts`](../apps/extension/src/uploader.ts)
  通过 `getAsset(draft.id, cover.fileName)` 拉取字节；`publishXArticle`
  在草稿存在**之后**才上传封面，并用单独的
  `ArticleEntityUpdateCoverMedia` mutation 设置它。

### 3.3 kind 命名空间路由 + `PostDraftWireBody` 结构

所有草稿路由都位于 `/:kind/drafts...` 之下，其中路径段就是**逐字的 `kind` 字符串** ——
relay 把它当作一个不透明参数（存储、过滤、匹配它；从不解释它），因此第三方 kind 无需改动 relay 就能获得自己的命名空间：

```
GET    /health                               infrastructure (token-exempt)
GET    /setting                              relay settings view — never returns the token value
PATCH  /setting                              body: { token?: string | null }
POST   /:kind/drafts                         body: PostDraftWireBody; kind stamped from the path
GET    /:kind/drafts                         server-side filtered by kind
GET    /:kind/drafts/:id
GET    /:kind/drafts/:id/assets/:fileName    raw binary
PUT    /:kind/drafts/:id/cover               body: SetCoverWireBody
PATCH  /:kind/drafts/:id                     body: { status, restId?, error? }
DELETE /:kind/drafts/:id
/drafts*                                     410 Gone (pre-v0.5 root routes; migration hint)
```

kind 路径段必须匹配 `/^[a-z0-9][a-z0-9-]*$/`，且不能是保留字（`health`、`setting`、`drafts`）——
见 [`packages/relay-protocol/src/validate.ts`](../packages/relay-protocol/src/validate.ts)
中的 `isValidKindSegment`。

`POST /:kind/drafts` 是一个带 base64 assets 的**单一 JSON 文档**：

```ts
// packages/relay-protocol/src/relayClient.ts
interface PostDraftWireBody {
  bundle: Omit<DraftBundle, 'status' | 'restId' | 'error'>;
  assets: Array<{ fileName: string; mime: string; base64: string }>;
}
```

这是刻意为之：relay 在写入时把 base64 解码为二进制，不需要 multipart 解析器 —— 它只依赖纯粹的
Node 内置模块。asset 的**下载**方向（`GET /:kind/drafts/:id/assets/:fileName`）返回原始二进制，因为那是扩展的热点、带宽敏感路径。

请求体在边界处由 `relay-protocol` 导出的零依赖线上校验器校验（[`validate.ts`](../packages/relay-protocol/src/validate.ts)
中的 `validatePostDraftWireBody` 及其同类 —— 这份契约的可执行形式）；relay
对格式错误的请求体以 `400 { error, issues }` 拒绝，其中每个 issue 携带一个 JSONPath
风格的位置。这些校验器刻意宽松：未知字段和未知（更高）的
`schemaVersion` 都会放行，开放字符串 `kind`/`source` 不受约束。路由逻辑在
[`packages/relay/src/server.ts`](../packages/relay/src/server.ts)，存储在
[`packages/relay/src/storage.ts`](../packages/relay/src/storage.ts)。

### 3.4 `kind` 缺省 = `'x-article'`

- 类型：[`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts)
  中的 `DraftKind`。磁盘上的 v0.2 草稿包早于这个字段出现，因此缺省必须永远保持表示
  `'x-article'`。
- **读取侧：始终使用规范访问器 `draftKind(bundle)`**（由 `relay-protocol` 导出），而不要手写
  `b.kind ?? 'x-article'`。
- 自从有了 kind 命名空间路由（3.3），**新草稿包总是带有 `kind`**：relay
  在 `POST /:kind/drafts` 时从路径段上盖章写入（[`packages/relay/src/storage.ts`](../packages/relay/src/storage.ts)），而
  `bundle.kind` 与路由不一致的请求体会被以 400 拒绝。只有历史磁盘草稿包仍可能缺省，`draftKind()`
  会把它们归类为 `'x-article'`（因此它们出现在 `/x-article/drafts` 下）。
- relay 仍然**从不解释** kind 的值 —— 它把它作为不透明字符串来存储、过滤和匹配。
- 消费端不再在客户端过滤：`HttpRelayClient` 是按 kind 限定作用域的（构造函数选项，默认
  `'x-article'`），并且服务端会过滤 `GET /:kind/drafts`。

### 3.5 默认端口 8765：一个常量 + 静态的扩展 manifest

唯一真源是
[`packages/relay-protocol/src/relayClient.ts`](../packages/relay-protocol/src/relayClient.ts)
中的 `DEFAULT_RELAY_PORT` / `DEFAULT_RELAY_BASE`。每个运行时消费方都导入它：relay 的 `DEFAULT_PORT`
（[`packages/relay/src/config.ts`](../packages/relay/src/config.ts)，可通过 `KAITOX_RELAY_PORT` 覆盖）、扩展
（[`apps/extension/src/xsession.ts`](../apps/extension/src/xsession.ts)
重新导出它），以及 Obsidian 插件
（[`apps/obsidian/src/main.ts`](../apps/obsidian/src/main.ts)）。

唯一剩下的重复是
[`apps/extension/manifest.json`](../apps/extension/manifest.json)
（`host_permissions`：`http://127.0.0.1:8765/*`、`http://localhost:8765/*`）——
它必须保持为 Chrome 和商店工具能逐字读取的静态 JSON。扩展的构建（[`apps/extension/esbuild.mjs`](../apps/extension/esbuild.mjs)）
**在 manifest 与常量不一致时会失败**，因此修改默认端口意味着同时修改常量和 manifest；构建会抓出遗漏。host
永远是 `127.0.0.1` —— relay 从不绑定公开网络接口。

### 3.6 `content_state` 中的 UTF-16 offset

内联样式和实体范围中的 `offset`/`length` 是 JS 字符串索引 ——
**UTF-16 码元** —— 因此一个 CJK 字符计为 1，而 BMP 之外的字符（emoji）计为 2。定义在
[`packages/x-article/src/types.ts`](../packages/x-article/src/types.ts) 和
[`packages/x-article/src/contentState.ts`](../packages/x-article/src/contentState.ts)；在
[`packages/x-article/test/validate.mjs`](../packages/x-article/test/validate.mjs)
中经过真值测试（包含一个 CJK 加粗 offset 的用例）。不要按 Unicode 码点或字素簇来计数。

### 3.7 `schemaVersion` 策略

`DraftBundle.schemaVersion` 是一个普通的 `number`；当前值是
[`packages/relay-protocol/src/bundle.ts`](../packages/relay-protocol/src/bundle.ts)
中的 `SCHEMA_VERSION` 常量（通过 `bundleSchemaVersion(b)` 读取 —— 在 v0.2 磁盘草稿包上缺省即表示 1）。规则如下：

- **新增式的改动绝不 bump** 版本号（线上校验器容忍未知字段正是出于这个原因）。
- **不兼容的改动才 bump `SCHEMA_VERSION`** —— 而且只有到那时才编写迁移/升级函数（如今一个都没有；不要过早添加无用的机制）。
- **消费方必须拒绝高于自己所知的版本**，给出清晰的错误，而不是错误解析。
- **relay 盲目地存储任何版本** —— 拒绝是消费方的职责；relay 保持对内容无感知。

### 3.8 内嵌帖子（`TWEET` 实体）

**独占一行**的 `x.com`/`twitter.com` 帖子链接（整段就是一条裸链接）会转成内嵌帖子：
一个 `TWEET` 实体（`data` 只含 `tweet_id`）由 `atomic` block 承载，与 `DIVIDER` 同构。
两个要点：

- **只认独占的裸链接。** `[文字](url)` 与段内混着正文的链接仍是 `LINK`。`parseTweetId`
  整串锚定（`^…$`），行内链接绝不命中；只有整段每一行都是帖子链接时才改写。
- **`data` 只放 `tweet_id`，别的都不放。** X input 强类型 —— 任何多余字段（比如 X 编辑器
  有时会带的可选 `entity_key` UUID）都可能 `GRAPHQL_VALIDATION_FAILED`。这里不涉及上传/
  `media_id`，因此完全在 `contentState.ts` 与无框架预览里运行。

## 4. 新增一个功能（实例演练：`linkedin`）

这套工具集的设计使得新增一个功能几乎不触碰任何已有代码。假设你想要 `kaitox linkedin push`：

1. **新的引擎包 `packages/linkedin`** —— `packages/x-article` 的对应物：把
   Markdown 转换成目标所需的任何形式，并与目标的 API 通信。它可以仅为 wire 类型依赖
   `@kaitox/relay-protocol`（绝不依赖 `relay` 或 `cli`）。把它按依赖顺序加入根目录
   [`package.json`](../package.json) 的 `build`/`typecheck` 链，如果要发布，还要加入
   [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 中的 `npm pack --dry-run` 循环。
2. **推送侧原封不动复用 `relay-protocol`** —— 构建一个按 kind 限定作用域的客户端并 post：
   `new HttpRelayClient(base, { kind: 'linkedin' }).postDraft({ title, markdown, mode, source, assets, ... })`。
   原始 Markdown 加图片字节，结构与今天一致；草稿会落到
   `/linkedin/drafts` 下。
3. **relay：无需改动。** kind 命名空间来自 URL 路径段，relay 把它当作不透明字符串（不变量 3.3/3.4）。每一个路由都已经能为新 kind 工作 ——
   唯一的约束是路径段规则（`/^[a-z0-9][a-z0-9-]*$/`，且不能是保留字）。
4. **CLI：** 新增 `packages/cli/src/commands/linkedin.ts`，导出
   `runLinkedin(args: string[])`，然后在 [`packages/cli/src/kaitox.ts`](../packages/cli/src/kaitox.ts)
   的 `FEATURES` 分发表中添加**一条条目**：

   ```ts
   const FEATURES: Record<string, Command> = {
     x: { run: runX, summary: 'X (Twitter) Article publishing — push / list / status' },
     linkedin: { run: runLinkedin, summary: 'LinkedIn drafts — push / list / status' },
   };
   ```

   这就得到了 `kaitox linkedin push|list|status ...`，而且帮助输出是从这张表生成的 —— 没有别的地方需要更新。
5. **消费端：** 无论由什么来投递草稿（一个浏览器扩展、一个脚本），都去轮询
   `GET /linkedin/drafts` —— 服务端过滤，不需要客户端的 kind 过滤。多个功能共存于一个 relay 上，各自在自己的路由命名空间里。

扩展点小结：

- `packages/cli/src/kaitox.ts` 中的 `FEATURES` 表（一行；帮助由它生成）。
- 新增 `packages/cli/src/commands/<feature>.ts`。
- 新增引擎包 `packages/<feature>`。
- `HttpRelayClient` 构造函数上的 `kind`（无需改类型 ——
  `DraftKind` 是开放的：`'x-article' | (string & {})`；路由命名空间会自动跟随）。
- 一个轮询 `GET /<kind>/drafts` 的消费端。
- 如果希望 agent 驱动该功能，在 `skills/<feature>/SKILL.md` 下放一个
  skill（外加在 [`skills/README.zh-CN.md`](../skills/README.zh-CN.md) 中加一行目录）。
- 一个用于发布的 changeset（见第 6 节）。

## 5. 构建与测试

`@kaitox/*` 各包已发布到 npm（终端用户 `npm i -g @kaitox/cli` 即可）。要在本 monorepo 上开发，则从源码构建——四个包按依赖顺序构建，两个私有 app 单独打包：

```bash
npm install
npm run build             # relay-protocol → x-article → relay → cli
npm run build:extension   # → apps/extension/dist/（在 Chrome 里以「已解压」方式加载）
npm run build:obsidian    # → apps/obsidian/dist/（拷进某个 vault 的 .obsidian/plugins/kaitox/）
```

三个套件，全部可离线运行（X API 始终被 mock）：

| 套件 | 位置 | 覆盖内容 | 运行 |
| --- | --- | --- | --- |
| 线上校验器测试 | [`packages/relay-protocol/test/validate.mjs`](../packages/relay-protocol/test/validate.mjs) | 零依赖线上校验器（格式错误请求体的 issue 路径、向前兼容的宽松度、kind 路径段规则）；只导入包自身的 dist —— 绝不导入 `@kaitox/relay` | `npm test`（根目录；先运行 `-w @kaitox/relay-protocol`） |
| 转换真值测试 | [`packages/x-article/test/validate.mjs`](../packages/x-article/test/validate.mjs) | `markdownToContentState` 对照预期的基准真值（标题、内联样式、CJK UTF-16 offset、`collectImageSources`、`sanitizeContentState`、`deriveTitle`） | `npm test`（根目录；委托给 `-w @kaitox/x-article`） |
| 集成测试 | [`test/integration.mjs`](../test/integration.mjs) | 使用进程内 relay 的端到端测试：relay CRUD（含封面字节）、路径穿越防护、自定义 `kind` 往返 + 跨 kind 隔离、边界校验（400 + issue 路径，历史路由返回 410）、`GET`/`PATCH /setting` + 实时 token 轮换、`done` → `sent` 迁移；X API 被 mock 的扩展上传流水线（正确的 `content_state`，封面在草稿创建后通过 `ArticleEntityUpdateCoverMedia` 上传）；`checkMarkdownStyle` + 纯文本兜底不变量 | `npm run test:integration` |
| 协议冒烟测试 | [`test/relay-protocol.smoke.mjs`](../test/relay-protocol.smoke.mjs) | 仅针对 `@kaitox/relay-protocol` 的公开导出（按 kind 限定作用域的 `HttpRelayClient`、`RelayHttpError`、base64 辅助函数），对着进程内 relay，完全按第三方集成的用法来用；第三方 `kind`/`source` 透传与命名空间隔离 | `npm run test:protocol` |

一次跑全部（先构建，再跑三个）：

```bash
npm run test:all
```

CI（[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)）在 Node 20 和 22 上运行构建、typecheck、全部三个套件，构建两个 app，并对每个可发布的包运行
`npm pack --dry-run`，以抓出 `files`/exports 的错误。

手动 CLI 冒烟（隔离的 home + 端口，让你真实的 `~/.kaitox` 保持干净）：

```bash
npm run build
export KAITOX_HOME=$(mktemp -d) KAITOX_RELAY_PORT=8799
node packages/cli/dist/kaitox.js --version
node packages/cli/dist/kaitox.js relay --daemon
node packages/cli/dist/kaitox.js x push README.md --title "Smoke test"
node packages/cli/dist/kaitox.js x list
node packages/cli/dist/kaitox.js relay status
node packages/cli/dist/kaitox.js relay stop
```

（如果 relay 没在运行，`kaitox x push` 会自动拉起它，因此显式的
`relay --daemon` 步骤是可选的。）

## 6. 发布

发布使用 [changesets](https://github.com/changesets/changesets)。四个
`packages/*` 按需一起版本化；`@kaitox/extension` 和 `@kaitox/obsidian` 在
[`.changeset/config.json`](../.changeset/config.json) 中被忽略，从不发布。

流程：

1. 在你的 feature 分支上：`npx changeset` —— 选择受影响的包和一个 bump 级别，写好
   changelog 条目，把生成的 `.changeset/*.md` 文件连同你的改动一起提交。
2. 版本 bump：`npx changeset version`（根脚本：`npm run version`）。这会重写各包的版本号和
   changelog，并 bump 内部依赖范围（`updateInternalDependencies: "patch"`）。
3. 发布：`npm run release` —— 构建、运行 `test:all`，然后以 `access: public` 执行
   `changeset publish`。

如果维护者已经在准备好的 `main` checkout 上，可以用一个命令走完整本地发布：

```bash
npm run release:direct
```

它要求干净的 `main` 且与 `origin/main` 一致、`gh` 已登录、存在 `zip` 命令，并且默认要求 npm
已登录（除非传 `--skip-npm`）。默认流程会：运行 typecheck，通过 `npm run release` 发布 npm
包，构建两个 app，在 toolkit 仓库创建 GitHub Release（`extension-v<version>` 与
`obsidian-v<version>`），同步 `kuangjiajia/kaitox-obsidian`，并在那里创建 Obsidian
要求的裸版本号 release。常用参数：

```bash
npm run release:direct -- --dry-run
npm run release:direct -- --skip-npm
npm run release:direct -- --replace-assets
```

在 CI 中，[`.github/workflows/release.yml`](../.github/workflows/release.yml)
通过 `changesets/action` 自动化第 2–3 步：推送到 `main` 时它会打开（或更新）一个
"Version Packages" PR，并在该 PR 合并时发布。这个 workflow 需要一个具有发布权限的
`NPM_TOKEN` 仓库 secret，以及 npm 组织 **`kaitox`** 存在，因为所有包都位于
`@kaitox` scope 下（每个包还设置了 `publishConfig.access: public`）。如果没有待处理的
changeset，且 `NPM_TOKEN` 不存在，workflow 会成功退出，不会尝试 npm 发布。

## 7. 语言与命名规范

- **每一份已发布的文档都同时提供英文 + 中文。** 各包 README 以及 `docs/` 下的每个文件都有一个 `*.md`（英文，权威版本）以及紧挨着的一个 `*.zh-CN.md`（中文镜像），二者由各自顶部的切换行链接（`English | [简体中文](X.zh-CN.md)` / `[English](X.md) | 简体中文`）。英文是真源 —— 编辑其中任一份时保持两者同步。CLI `--help` 输出、npm 包描述和 manifest 保持仅英文。
- **历史遗留的中文代码注释保持原样** —— 不要批量翻译它们；它们承载着设计背景（见 `packages/relay-protocol/src/bundle.ts`）。
- **App 的 UI 字符串目前是中文**（扩展面板、Obsidian
  设置）。在 `apps/*` 仍是私有的情况下这可以接受；在任何公开分发之前需要重新审视。
- **新的代码注释用英文书写。**
- **大小写**：在正文、品牌语境、manifest 和包描述中用 "Kaitox"（大写 K）；仅在机器名中用小写 "kaitox" ——
  CLI 命令、`@kaitox` scope 下的 npm 名称、目录名、`~/.kaitox` 以及环境变量。
