[English](README.md) | 简体中文

# @kaitox/x-article

把 Markdown 发成 **X (Twitter) Article 草稿**：一个 Markdown → `content_state` 转换器、一个针对 X 私有网页 API 的客户端、端到端发布编排、一个推特友好度风格检查器，以及一个框架无关的预览渲染器。可跑在浏览器（x.com 同源）和 Node（>= 18）。ESM-only。

它是 [Kaitox](https://kaitox.ai) 工具集（CLI、本地 relay、Obsidian 插件、Chrome 插件）里 X 发布功能背后的引擎，但不依赖 Kaitox 的其余部分——你可以把它嵌进自己的浏览器插件或服务端。

> **非官方。** 本库驱动的是用户自己已登录的 x.com 会话，调用 X 的私有 GraphQL 接口。在基于它构建任何东西之前，请先阅读[已知边界与合规](#已知边界与合规)。

## 安装

```bash
npm i @kaitox/x-article
```

依赖：[`marked`](https://www.npmjs.com/package/marked)（Markdown 词法解析）和 [`@kaitox/relay-protocol`](https://www.npmjs.com/package/@kaitox/relay-protocol)（仅用到 `StyleIssue`/`StyleReport` 类型）。

## 工作原理

X Article 在一个 Draft.js 风格的编辑器里编辑。底层一篇草稿就是一个 `content_state`——由 `blocks` 数组（段落、标题、列表项、引用、atomic 块）加一个 `entity_map`（链接、图片、分隔线、内嵌 Markdown、内嵌帖子）组成。本包做三件事：

1. **转换**：把 Markdown 转成该 `content_state`（`markdownToContentState`）。图片会变成引用 `media_id` 的 `MEDIA` entity，所以图片必须*先*上传；独占一行的 `x.com`/`twitter.com` 帖子链接会变成内嵌帖子（`TWEET` entity）。
2. **对接 X**（`XArticleClient`）：分片上传媒体（`INIT`/`APPEND`/`FINALIZE`），然后调 GraphQL 的 `ArticleEntityDraftCreate` mutation，可选地再调 `ArticleEntityUpdateCoverMedia` 设置封面图。
3. **编排**整条流水线（`publishXArticle`）：收集图片 src → 逐张上传 → 转换 → 建草稿 → 设封面。

这三层可以独立使用：

| 层 | 适用场景 |
|---|---|
| 仅转换器（`contentState`） | 你有自己的传输通道，只需要 Markdown → `content_state`。复用价值最高的部分。 |
| 客户端（`XArticleClient`） | 你自己构建（或导入）`content_state`，需要带正确鉴权头的上传 + 建草稿能力。 |
| 完整编排（`publishXArticle`） | 你有 Markdown 和获取图片字节的方式，想一次调用拿到草稿。 |

完整协议（请求头、请求体、响应结构、映射规则）见 [`docs/x-article-publish-protocol.zh-CN.md`](../../docs/x-article-publish-protocol.zh-CN.md)。

### 鉴权

每次调用都借用用户已登录的 x.com 会话：

- `authorization`：所有 x.com 网页端共用的**公开** web bearer token（`DEFAULT_BEARER_TOKEN`，长期不变）。
- `x-csrf-token`：`ct0` cookie 的值。
- Cookie：真正的身份来源。x.com 上的同源 fetch 配合 `credentials: 'include'` 会自动携带；服务端调用必须显式传完整 cookie 头。

## 快速开始 A：在 x.com 上的浏览器插件里

在 `x.com` 的 content script（或页面上下文）里运行。同源 fetch 自动携带登录 cookie，所以凭据只剩两件事：从 `document.cookie` 读出 `ct0`，`bearerToken` 留空（使用内置默认值）。这正是 Kaitox Chrome 插件的做法：

```ts
import { publishXArticle, type ImageFetcher } from '@kaitox/x-article';

const ct0 = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
if (!ct0) throw new Error('Not logged in to x.com');

// You own image resolution: return bytes + MIME for each src
// found in the Markdown (local store, IndexedDB, your backend, ...).
const fetchImage: ImageFetcher = async (src) => {
  const bytes = await myAssetStore.get(src); // Uint8Array | Blob
  return { bytes, mimeType: 'image/png' };
};

const result = await publishXArticle({
  markdown: '# Hello\n\nFirst article via API.\n\n![diagram](assets/diagram.png)',
  credentials: { bearerToken: '', csrfToken: ct0 }, // '' → built-in public bearer
  clientOptions: {
    fetchImpl: window.fetch.bind(window),
    credentialsMode: 'include', // same-origin: cookies ride along automatically
    // X rotates GraphQL queryIds occasionally — make them configurable:
    // articleDraftCreateQueryId: '...',
    // updateCoverMediaQueryId: '...',
  },
  fetchImage,
});

console.log(result.restId); // draft id → https://x.com/compose/articles/edit/<restId>
```

如果还要设置封面图，传入 `fetchCover: async () => ({ bytes, mimeType })`——它只会在草稿已创建、`restId` 已知之后才被调用。

## 快速开始 B：服务端 Node

Node 没有登录会话，所以你得从一个已登录 x.com 的浏览器里导出凭据（DevTools → Application → Cookies → `https://x.com`）：`ct0` 的值和**完整 cookie 头字符串**（`auth_token` cookie 是 HttpOnly 的，只能从面板里复制，`document.cookie` 拿不到）。

```ts
import { publishXArticle } from '@kaitox/x-article';

const result = await publishXArticle({
  markdown: myMarkdown,
  credentials: {
    bearerToken: '',                    // '' → built-in public bearer
    csrfToken: process.env.X_CT0!,      // the ct0 cookie value
    cookie: process.env.X_COOKIE!,      // full cookie string incl. auth_token
  },
  clientOptions: {
    credentialsMode: 'omit',            // don't rely on ambient cookies; send the header explicitly
  },
});
```

可直接运行的版本见 [`examples/publish.ts`](examples/publish.ts)。

> **脆弱——随时可能失效。** 服务端调用正是 X 反自动化措施针对的场景。X 会在很多 GraphQL 调用上校验 `x-client-transaction-id` 请求头，它由 x.com 前端的混淆代码计算，本包**不**生成它（你可以通过 `credentials.clientTransactionId` 自行提供）。同源页面上下文的调用可以省略它；服务端调用缺了它可能被拒。会话会过期，queryId 会轮换，cookie 串也容易泄露——凡是要长期用的东西，优先走浏览器路线（快速开始 A），且永远不要把凭据提交进仓库。

## API 参考

| 导出 | 一句话说明 |
|---|---|
| `markdownToContentState(markdown, mediaIdBySrc?)` | 把 Markdown 转成 `{ contentState, skippedImages, title? }`；`mediaIdBySrc` 是图片 src → 已上传 `media_id` 的映射（Record 或 Map）；第一个 `#` 标题成为 `title`，不进正文。 |
| `collectImageSources(markdown)` | 按文档顺序返回所有图片 src，已去重——先上传它们来构建 `mediaIdBySrc`。 |
| `XArticleClient` | HTTP 客户端：`uploadMedia(bytes, mimeType, category?)` → `media_id_string`；`createArticleDraft(title, contentState)` → `{ restId?, raw }`；`updateCoverMedia(articleEntityId, mediaId)` → `{ raw }`。 |
| `publishXArticle(params)` | 端到端：收集图片 → 上传（默认并发 3）→ 转换 → 建草稿 → 可选封面；返回 `PublishArticleResult`。 |
| `deriveTitle(markdown)` | 第一个 H1 的文本，退而取任意级别的第一个标题，再退为 `''`。 |
| `sanitizeContentState(cs)` | 按白名单重建 `content_state` 使 X 能接受：剥掉未知字段，丢弃非法 inline style，降级不支持的块类型（`header-three` → `header-two`，`code-block` → `unstyled`）。`createArticleDraft` 会自动应用。 |
| `checkMarkdownStyle(markdown, opts?)` | 对 Markdown 做推特友好度 lint；返回 `StyleReport`。见[风格检查器](#风格检查器)。 |
| `toPlaintextMarkdown(markdown)` | 只降级转换器真正会丢内容的结构（HTML 块、嵌套列表）；表格与代码围栏原样保留——X 原生渲染它们。 |
| `extractMermaidBlocks(markdown)` | 把顶层 ```` ```mermaid ```` 围栏替换成 `![...](mermaid://diagram-N)` 图片引用，返回变换后的 markdown 和提取出的块。用下面的辅助函数把每个块渲染成图，字节经 `fetchImage` 提供。 |
| `renderMermaidSvgUrl(mermaid, code)` / `renderMermaidPng(mermaid, code)` / `MERMAID_INIT_CONFIG` | 仅浏览器可用的 mermaid → 图片渲染器（预览用 SVG blob URL，上传用 PNG 字节）。自行加载 mermaid.js（约 8MB），先 `mermaid.initialize(MERMAID_INIT_CONFIG)` 一次，再把实例传进来——这样各消费方渲染出的图逐像素一致。Chrome 扩展与 Obsidian 插件都用它们。 |
| `renderPreviewHtml(markdown, opts?)` | 把发布效果渲染成（已转义的）HTML 字符串预览。见[预览渲染器](#预览渲染器)。 |
| `renderModelHtml(model, opts?)` / `buildPreviewModel(markdown)` | `renderPreviewHtml` 的两个半步：先构建可渲染模型，再渲染。 |
| `segmentText(text, styles, entityRanges)` / `groupBlocks(blocks)` | 预览底层工具：把 block 文本切成样式均匀的段；把连续列表项归组给 `<ul>`/`<ol>`。想自己写渲染层（原生 DOM、React 等）时直接用它们、跳过 HTML 层。 |
| `DEFAULT_BEARER_TOKEN` | 所有 x.com 网页端共用的公开 web bearer token。 |
| `ARTICLE_DRAFT_CREATE_QUERY_ID` | `ArticleEntityDraftCreate` 的默认 GraphQL queryId（X 会轮换——失效时覆盖它）。 |
| `ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID` | `ArticleEntityUpdateCoverMedia` 的默认 GraphQL queryId。 |
| `DEFAULT_ARTICLE_FEATURES` / `DEFAULT_COVER_MEDIA_FEATURES` | 两个 mutation 各自要求的 feature-flag 对象（注意：二者不同——不要混用）。 |
| `DEFAULT_ARTICLE_FIELD_TOGGLES` | 建草稿用的 `fieldToggles`（封面 mutation 不需要）。 |

导出的类型：`ContentState`、`ContentBlock`、`BlockType`、`EntityMapEntry`、`EntityValue`、`EntityRange`、`InlineStyleRange`、`XCredentials`、`XArticleClientOptions`、`FetchLike`、`PublishArticleParams`、`PublishArticleResult`、`ImageFetcher`、`CoverFetcher`、`AssetMeta`、`StyleCheckOptions`、`UploadMediaCategory`，以及请求/响应体类型（见 `src/types.ts`）。

### 转换规则（摘要）

| Markdown | `content_state` |
|---|---|
| 段落 | `unstyled` 块 |
| `#`（第一个） | 文章标题（`title` 字段，不进正文） |
| `##` / `###`+ | `header-one` / `header-two`（X 正文只有两级标题） |
| `> quote` | 每段一个 `blockquote` 块 |
| `-` / `1.` 项 | 每项一个 `unordered-list-item` / `ordered-list-item` |
| `**b**` `*i*` `~~s~~` | `inline_style_ranges`（`Bold` / `Italic` / `Strikethrough`——X 只接受这三种） |
| `` `inline code` `` | 纯文本（X 没有行内代码样式） |
| `[text](url)` | `LINK` entity |
| 独占一行的 `x.com`/`twitter.com` 帖子链接 | `atomic` 块 + `TWEET` entity（内嵌帖子；仅裸链接独占一行触发） |
| `![alt](src)` | `atomic` 块 + `MEDIA` entity（需要已上传的 `media_id`） |
| 围栏代码 | `atomic` 块 + `MARKDOWN` entity（渲染为纯文本代码框） |
| 表格 | `atomic` 块 + `MARKDOWN` entity——X 端原生渲染为表格 |
| `---` | `atomic` 块 + `DIVIDER` entity |

完整规则、entity key 约定与 UTF-16 offset 语义见 [`docs/x-article-publish-protocol.zh-CN.md`](../../docs/x-article-publish-protocol.zh-CN.md)。

## 风格检查器

`checkMarkdownStyle` 只标记转换器确实会渲染变形或丢弃的结构——对能正常转换的东西不误报。它返回 `{ friendly, issues, counts }`，其中 `friendly` 为 `true` 当且仅当既没有 error 也没有 warning。

| 规则 | 严重级别 | 原因 |
|---|---|---|
| `table` | info | 以 Markdown 块上传，X 端原生渲染为表格。 |
| `nested-list` | warning | 嵌套列表项会被静默丢弃（只保留一层）。 |
| `html-block` | warning | HTML 块会被整体丢弃——内容丢失。 |
| `code-block` | info | 渲染为纯文本代码框（无高亮）；通常可以接受。 |
| `heading-depth` | info | `h4`+ 会被压到 SubHeading（等同 `###`）。 |
| `extra-h1` | info | 只有第一个 H1 成为标题；后续 H1 渲染为 Heading。 |
| `footnote` | warning | `[^n]` 不会被解析；会以字面文本显示。 |
| `task-list` | info | 复选框会丢失；条目渲染为普通列表。 |
| `image-remote` | warning | 远程图片不会自动下载；你的上传器得自己去取。 |
| `image-missing` | error | 该 src 没有可用字节——上传时图片会被跳过。 |
| `image-too-large` | warning | 超过大小限制（默认 5 MB）**且**是 relay 无法静默重编码的格式（PNG/JPEG/WebP 以外）；X 可能拒绝上传。超限的 PNG/JPEG/WebP 会在 relay 入库时自动压缩，不再报告。 |
| `empty-doc` | error | X 要求正文非空。 |

传入 `StyleCheckOptions.assetMap`（`src → { bytesLen, mime, resolved }`）让图片规则能区分缺失/远程/超大，用 `maxImageBytes` 修改大小限制。

用户不愿修改被标记的结构时，`toPlaintextMarkdown(markdown)` 就是兜底：HTML 块去掉标签、嵌套列表拍平到一级——其余一切（标题、强调、链接、图片、表格、代码围栏）原样保留，因为表格和代码经 MARKDOWN 实体能干净转换。输出仍是 Markdown；照常喂给 `markdownToContentState` 即可。

## 预览渲染器

`renderPreviewHtml` 在发布**之前**展示文章大致长什么样——而且不会与实际发布产生偏差，因为它渲染的就是 `markdownToContentState` 产出的同一份 `content_state`。所有降级都会原样预览出来：行内代码变普通文本、嵌套列表项被丢弃、代码围栏显示为纯文本代码框、表格渲染为原生表格、未打包的图片显示「将被跳过」占位。

它与框架无关（返回已转义的 HTML 字符串，不需要 DOM，Node 里可测试），同一个调用可以支撑 React 弹窗（Kaitox Chrome 插件）、Obsidian 插件视图或普通网页：

```ts
import { renderPreviewHtml } from '@kaitox/x-article';
// 样式：import '@kaitox/x-article/preview.css'（打包器），或把文件拷出来用 <link> 引入

const html = renderPreviewHtml(markdown, {
  title: draft.title,               // 缺省回退到正文第一个 `#` 标题
  coverUrl: myCoverBlobUrl,         // 缺省不渲染封面
  resolveImage: (src) => {
    // string → <img src>；undefined → 「加载中」占位；null → 「将被跳过」占位
    return myBlobUrlFor(src);
  },
});
container.innerHTML = html; // 输出已全部转义；不安全的链接协议会被拦下
```

输出是 `<article class="xp-article">…</article>`；`preview.css`（以 `@kaitox/x-article/preview.css` 导出）把它排成近似 X 文章阅读页的样子。主题靠 `--xp-*` CSS 变量（`--xp-text`、`--xp-text-muted`、`--xp-border`、`--xp-box`、`--xp-link`、`--xp-placeholder`），自带亮色默认值——在任意祖先上重设变量即可实现暗色或品牌配色。

想自己搭视图（原生 DOM、React 元素）？直接用 `buildPreviewModel` + `segmentText` + `groupBlocks`，跳过 HTML 层。

## 配合 Kaitox relay 使用

在 Kaitox 工具集里，本包跑在 Chrome 插件内部；上传端（CLI、Obsidian、你自己的服务）不直接调 X，而是把草稿包——原始 Markdown 加图片字节——POST 到本地 relay，插件在 `x.com/compose/articles` 上取走并用页面自身的会话发布。草稿包刻意携带原始 Markdown 而不是预构建的 `content_state`，因为图片的 `media_id` 只有在登录页面里上传之后才存在。

- relay 的线上类型与 HTTP 客户端：[`@kaitox/relay-protocol`](https://www.npmjs.com/package/@kaitox/relay-protocol)
- 基于 relay 构建你自己的插件或上传端：[`docs/integrate-browser-extension.zh-CN.md`](../../docs/integrate-browser-extension.zh-CN.md)

## 已知边界与合规

- **只建草稿。** 不涉及发布草稿（最终的「发布」mutation）；由用户在 X 编辑器里完成收尾。
- **queryId 轮换。** X 会不打招呼地轮换 GraphQL queryId。两个 queryId 均可通过 `XArticleClientOptions` 覆盖；失效时从 x.com 前端 bundle 里提取新值。
- **`x-client-transaction-id`。** 本包不生成它。同源时没问题；服务端/跨域调用可能必须提供。
- **`restId` 提取是尽力而为。** 它针对观测到的响应结构并带兜底逻辑；请用真实响应验证。
- **媒体约束。** 上传用 `media_category=tweet_image`，正文的 `MEDIA` entity 里却引用 `DraftTweetImage`——两个不同的字符串。`media_id` 是字符串（`media_id_string`），永远不是数字形式。
- **合规。** 这些是 X 私有的、未文档化的网页接口。本库以用户身份、在用户自己的账号上、用用户自己的会话行事——它是非官方的，随时可能失效，并受 X 的自动化政策和频控约束。不要高频运行，不要跨账号批量自动化，风险自担。

## 许可证

[MIT](LICENSE) © kaitox
