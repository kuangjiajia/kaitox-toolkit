# X Article「Markdown → content_state」发布协议与实现说明

**Abstract (English).** This document is a reverse-engineered protocol reference for creating X (Twitter) Article drafts from Markdown, driving the private web endpoints of x.com with the user's own logged-in browser session. It covers: the auth model (public web bearer token + `ct0` cookie as `x-csrf-token`, cookies as the real identity); the three-phase chunked media upload (`INIT` / `APPEND` / `FINALIZE` against `upload.x.com/i/media/upload.json`); the `content_state` data model (Draft.js-style `blocks` + an array-shaped `entity_map` with MEDIA / DIVIDER / MARKDOWN / LINK entities); the full Markdown → `content_state` mapping rules; the `ArticleEntityDraftCreate` draft-create and `ArticleEntityUpdateCoverMedia` cover mutations; and the pitfalls (rotating queryIds, `x-client-transaction-id`, UTF-16 offsets, entity key numbering, no `depth` field, rejected block/style types). All fields were captured from real requests and verified by tests. The document body is written in Chinese; the reference implementation lives at [`packages/x-article/`](../packages/x-article/) — see its [README](../packages/x-article/README.md) for English API documentation. Unofficial: these endpoints may break whenever X rotates queryIds; use at your own risk and do not mass-automate.

> 目标：把「一键把 Markdown 发成 X（Twitter）长文 Article」的完整链路讲清楚，
> 并给出一份可直接复用的 TypeScript 参考实现（见仓库 `packages/x-article/src/`）。后续做类似的「导入/发布到某个富文本平台」的活儿，可以照这个分层套。
>
> 本文档记录 x.com 网页端发布一篇 Article 草稿时所用的私有接口、请求参数与数据模型，
> 全部字段以真实请求为准，并用 `packages/x-article/` 的测试逐条验证。

---

## 0. 一句话结论

本工具并没有调用什么官方开放 API，而是**借用你在浏览器里已登录 x.com 的会话**，直接打 x.com 网页端自己在用的**私有接口**，干两件事：

1. **把正文里的每张图片，用 X 的分片上传接口传上去**，换回 `media_id`；
2. **把 Markdown 转成 X Article 编辑器的内部数据结构（Draft.js `content_state`）**，连同 `media_id` 一起 POST 给 GraphQL 的 `ArticleEntityDraftCreate`，生成一篇**草稿**。

难点不在网络请求，而在第 2 步的**内容模型转换**——这也是最有复用价值的部分。

---

## 1. 整体流程

```
Markdown 源文
   │
   │  ① 扫描出所有图片 src
   ▼
[ 逐张图片 ]───②──► X 分片上传  INIT ─► APPEND ─► FINALIZE ─► media_id_string
   │                 (upload.x.com/i/media/upload.json)
   │  ③ Markdown + {src → media_id}
   ▼
content_state（Draft.js blocks + entity_map）
   │
   │  ④ POST 创建草稿
   ▼
x.com/i/api/graphql/<queryId>/ArticleEntityDraftCreate
   │
   ▼
文章草稿（rest_id）→ 打开 x.com/compose/articles/edit/<id> 供用户继续编辑/发布
```

一次完整发布里请求的真实先后顺序：

```
POST upload.json?command=INIT   total_bytes=41904  media_type=image/webp  media_category=tweet_image
POST upload.json?command=APPEND media_id=…  segment_index=0    (multipart/form-data, 字段名 media)
POST upload.json?command=FINALIZE media_id=…
… 每张图重复一遍 INIT/APPEND/FINALIZE …
POST i/api/graphql/g1l5N8BxGewYuCy5USe_bQ/ArticleEntityDraftCreate   (application/json, 正文在这里)
```

> 说明：x.com 页面自身还会发大量 `abs.twimg.com` 的 JS/字体、`viewer_context.json` 埋点、CORS 预检 `OPTIONS`——都是页面自身行为，与上传逻辑无关，忽略即可。

---

## 2. 鉴权：本质是「带着你的登录态替你操作」

所有私有接口都靠同一套请求头。值全部来自你已登录 x.com 的浏览器会话。

| Header | 值 | 说明 |
|---|---|---|
| `authorization` | `Bearer AAAA…FA33AGWWjCpTnA` | **公开** web bearer，所有网页端共用同一个，长期不变。见下方常量。 |
| `x-csrf-token` | `<ct0>` | CSRF，**等于 cookie 里的 `ct0`**。 |
| `x-twitter-auth-type` | `OAuth2Session` | 固定。 |
| `x-twitter-active-user` | `yes` | 固定。 |
| `x-twitter-client-language` | `en` | 客户端语言。 |
| Cookie | `auth_token=…; ct0=…; …` | 真正的身份来源。浏览器同源 fetch 用 `credentials:'include'` 自动带；服务端调用得手动塞 `cookie` 头。 |
| `x-client-transaction-id` | （create 这步可省略） | X 对多数 GraphQL 会校验它，但从 x.com 页面上下文里发同源请求时可省略。**跨域/服务端调用时可能必须**，见第 7 节「坑」。 |

公开 bearer（参考实现内置为默认值）：

```
AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA
```

> ⚠️ 你只需要准备两样东西：**`ct0`** 和 **完整 cookie 串**（尤其 `auth_token`）。bearer 用内置默认的即可。

---

## 3. 媒体上传：分片三段式 INIT / APPEND / FINALIZE

对每张图片走一遍，接口都是 `POST https://upload.x.com/i/media/upload.json`，靠 query 参数区分阶段。

### ① INIT —— 申请一个 media 槽位
```
POST upload.json?command=INIT
     &total_bytes=<字节数>
     &media_type=<image/webp | image/png | image/jpeg | image/gif>
     &media_category=tweet_image
```
- body 为空。
- 返回 JSON 里取 **`media_id_string`**（务必用字符串版，别用会丢精度的数字 `media_id`）。

几组真实 INIT 参数（印证 media_type 会随图变）：
```
command=INIT&total_bytes=41904 &media_type=image/webp&media_category=tweet_image
command=INIT&total_bytes=46552 &media_type=image/webp&media_category=tweet_image
command=INIT&total_bytes=173214&media_type=image/png &media_category=tweet_image
command=INIT&total_bytes=62806 &media_type=image/webp&media_category=tweet_image
```

### ② APPEND —— 上传数据分片
```
POST upload.json?command=APPEND&media_id=<id>&segment_index=0
Content-Type: multipart/form-data; boundary=…
  字段名: media   值: 图片二进制（Blob）
```
- 单片上限约 5MB，超了就多个 `segment_index=0,1,2…`。图片一般一片搞定。
- **不要手动写 `Content-Type`**，交给 `fetch`/`FormData` 自动生成 boundary。

### ③ FINALIZE —— 收尾
```
POST upload.json?command=FINALIZE&media_id=<id>
```
- 图片即时完成。视频/GIF 会返回 `processing_info`，需要再轮询 `command=STATUS` 直到 `state==succeeded`（参考实现里 `waitForProcessing` 已处理）。

> 注意一个**易错点**：上传时 `media_category` 是 **`tweet_image`**，但正文 `content_state` 里引用这张图时 `media_category` 是 **`DraftTweetImage`**。两个字段服务于两个不同接口，别混。

---

## 4. 核心数据模型：X Article 的 `content_state`

X Article 正文用的是 **Draft.js 的 `RawDraftContentState`**，但 X 做了两处改动：

1. `entity_map` 是**数组**（每个元素带显式 `key`），不是 Draft.js 原生的对象。
2. 字段名是 snake_case：`entity_ranges` / `inline_style_ranges` / `entity_map`。

结构：

```jsonc
{
  "blocks": [ /* 段落级块，按顺序就是文章从上到下 */ ],
  "entity_map": [ /* 图片/分割线/代码/链接等「实体」，被 block 通过 key 引用 */ ]
}
```

### 4.1 block（段落级）

```jsonc
{
  "key": "ckq8u",                 // 随机 5 位，仅需文档内唯一
  "text": "……",                  // 纯文本
  "type": "unstyled",             // 见下表
  "data": {},
  "entity_ranges": [              // 把某段文字关联到实体（如链接、或 atomic 的块级实体）
    { "key": 0, "offset": 0, "length": 1 }
  ],
  "inline_style_ranges": [        // 行内样式
    { "offset": 27, "length": 19, "style": "Bold" }
  ]
}
```

> **坑：不要发 `depth` 字段。** Draft.js 原生 block 有 `depth`（列表缩进用），但 X 的 `ArticleEntityDraftCreate` GraphQL **input 是强类型的、没有 `depth` 字段**。带上它会被拒：
> `GRAPHQL_VALIDATION_FAILED … path:["variable","content_state","blocks",0,"depth"]`。
> 本转换器把嵌套列表拍平（depth 恒为 0，无信息量），所以直接不输出该字段。

**block `type` 全集：**

| type | 对应 Markdown |
|---|---|
| `unstyled` | 普通段落 |
| `header-one` / `header-two` | 编辑器里的 Heading / SubHeading。本转换器约定：`#` = 主标题（走 title 字段不进正文）、`##` → `header-one`、`###` 及更深 → `header-two` |
| `blockquote` | `>` 引用 |
| `unordered-list-item` | `-` 列表项（**每项一个 block**） |
| `ordered-list-item` | `1.` 列表项（实测合法） |
| `atomic` | **块级实体宿主**：图片 / 分割线 / 代码。`text` 固定 `" "`（一个空格），且有且仅有一个 `entity_range = {offset:0, length:1}` |

> **坑：`header-three` 和 `code-block` 过得了 GraphQL 校验、过不了后端。** 2026-07 实测：这两个
> 类型不会触发 GRAPHQL_VALIDATION_FAILED，但创建草稿会整单报
> `OperationalError: Internal: Unspecified, path:["articleentity_create_draft"]`（错误信息完全不指向原因）。
> X Article 正文只支持两级标题；代码块必须走 atomic + MARKDOWN 实体。
> 排查这类「校验过了但 Operational 失败」的问题，可用二分法：按 blocks 切片重放（实体按引用重编号），
> 找出所有失败切片的公共 block 类型/特征，再用单 block 探针确认。

**`inline_style_ranges.style`：** 实测枚举全集 = `Bold` / `Italic` / `Strikethrough`（2026-07 探针验证）。
> **坑：没有行内代码样式。** `Code` / `CODE` / `InlineCode` / `Underline` 都会被拒：
> `GRAPHQL_VALIDATION_FAILED … path:["variable","content_state","blocks",i,"inline_style_ranges",j,"style"]`。
> X Article 编辑器本身也没有行内代码/下划线按钮。本转换器把行内 `` `code` `` 降级为普通文本。
> 探针方法：构造「blocks[0] 带待测 style + blocks[1] 带非法 `depth`」的请求——错误 path 落在
> `blocks[1].depth` 说明待测 style 合法；且请求必失败，不会真的创建草稿。
**关键：`offset`/`length` 用 JS 字符串下标（UTF-16 code unit），CJK 字符按 1 计。** 实测：首段 `offset:27,length:19` 精确框住 "Harness Engineering"。

### 4.2 entity_map（实体）

四种类型：

```jsonc
// 图片：先上传拿 media_id 再引用
{ "key": 3, "value": { "type": "MEDIA", "mutability": "Immutable",
    "data": { "media_items": [
      { "local_media_id": 3, "media_id": "2073636721275641856", "media_category": "DraftTweetImage" }
    ] } } }

// 分割线 ---
{ "key": 2, "value": { "type": "DIVIDER", "mutability": "Immutable", "data": {} } }

// 代码块 / ASCII 图：整段围栏原样塞进 markdown 字段（这是 X 的「万能转义」块）
{ "key": 0, "value": { "type": "MARKDOWN", "mutability": "Immutable",
    "data": { "markdown": "```plaintext\nHarness Engineering …\n```" } } }

// 链接：被普通/列表 block 的 entity_range 引用，覆盖显示文字
{ "key": 30, "value": { "type": "LINK", "mutability": "Mutable",
    "data": { "url": "https://x.com/AnatoliKopadze/status/2069475753184329889" } } }
```

**三条必须遵守的约定（否则 X 会拒或渲染错乱）：**

1. **entity 的 `key` 从 0 开始、按文档从上到下的出现顺序递增。** block 级实体（MEDIA/DIVIDER/MARKDOWN）和 inline 实体（LINK）**共用同一个计数器**。
2. **MEDIA 的 `local_media_id` === 该实体自己的 `key`。**
3. **atomic block 与它承载的实体**：atomic block 的唯一 `entity_range.key` 指向 entity_map 里的 MEDIA/DIVIDER/MARKDOWN。

---

## 5. Markdown → content_state 映射规则（最有复用价值的部分）

| Markdown | 产出 |
|---|---|
| 段落 | `unstyled` block |
| `#`（第一个） | 文章主标题（title 字段，不进正文；文中额外 `#` 按 `##` 处理） |
| `##` / `###` 及更深 | `header-one`（Heading）/ `header-two`（SubHeading，后端无 `header-three`） |
| `> 引用` | `blockquote` block（引用里每个段落一块） |
| `- 项` / `1. 项` | `unordered-list-item` / `ordered-list-item`（每项一块） |
| `**粗**` `*斜*` `~~删~~` | `inline_style_ranges`：`Bold` / `Italic` / `Strikethrough` |
| `` `行内代码` `` | 普通文本（X 无行内代码样式，`Code` 枚举实测被拒） |
| `[文字](url)` | 新建 `LINK` 实体 + `entity_range` 覆盖「文字」 |
| `![alt](src)` | **先上传图片** → 新建 `MEDIA` 实体 + 一个 `atomic` block |
| ` ```代码``` ` | 新建 `MARKDOWN` 实体（`data.markdown` = 完整围栏串）+ 一个 `atomic` block |
| `---` | 新建 `DIVIDER` 实体 + 一个 `atomic` block |
| 表格 | X 无原生表格 → 退化为 `MARKDOWN` 实体（保留原始 markdown） |

一个实现细节：代码块/ASCII 图统一包成 ` ```plaintext ` 的 MARKDOWN 实体（X Article 编辑器对所有代码块都用 `plaintext` 渲染）。

> 算法实现见 `packages/x-article/src/contentState.ts`：一次从上到下的遍历，同时维护 `blocks`、`entity_map` 和递增的 entity key 计数器；行内用递归处理 `strong/em/link` 的嵌套并按累计文本长度算 offset。

---

## 6. 创建草稿：ArticleEntityDraftCreate

```
POST https://x.com/i/api/graphql/g1l5N8BxGewYuCy5USe_bQ/ArticleEntityDraftCreate
Content-Type: application/json
（+ 第 2 节的鉴权头）
```

请求体骨架（`content_state` 就是第 4/5 节的产物）：

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

- URL 路径里的 `g1l5N8BxGewYuCy5USe_bQ` 就是 `queryId`，两处要一致。
- 这一步**只创建草稿**。随后可见 `ArticleEntityResultByRestId`（拉取刚建的文章）、`ArticleEntitiesSlice`（草稿列表）——都是编辑器加载行为。**正式「发布」是另一个 mutation**，见第 7 节。

---

## 6.5 设置封面：ArticleEntityUpdateCoverMedia

封面/头图是**独立的一步**，在建好草稿之后调（需要草稿的 `rest_id`）。流程：先把封面图走第 3 节的媒体上传（`media_category=tweet_image`）拿到 `media_id`，再调这个 mutation。

```
POST https://x.com/i/api/graphql/AbzX20PDk6TTzqmN67hiPQ/ArticleEntityUpdateCoverMedia
Content-Type: application/json
（+ 第 2 节的鉴权头）
```

请求体：

```jsonc
{
  "variables": {
    "articleEntityId": "2073786172036268032",     // 建草稿返回的 rest_id
    "coverMedia": {
      "media_id": "2073790268667478016",           // 上传封面图拿到的 media_id_string
      "media_category": "DraftTweetImage"           // 与正文图片引用时一致
    }
  },
  "features": { /* 见下方注意点 */ },
  "queryId": "AbzX20PDk6TTzqmN67hiPQ"
}
```

响应体里回显 `cover_media`（含 `media_key`、`original_img_url` 等），可据此确认设置成功。

**两个和 `ArticleEntityDraftCreate` 不同的坑：**
1. **没有 `fieldToggles`** 字段——别照抄建草稿的结构加上去。
2. **`features` 有三个 flag 取值相反**：`profile_label_improvements_pcf_label_in_post_enabled` 这里是 `true`（建草稿是 `false`）、`responsive_web_profile_redirect_enabled` 这里是 `false`（建草稿 `true`）、`rweb_tipjar_consumption_enabled` 这里是 `false`（建草稿 `true`）。参考实现里分别是 `DEFAULT_ARTICLE_FEATURES` 与 `DEFAULT_COVER_MEDIA_FEATURES`。

`queryId` 同样会轮换（参考实现 `ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID` 可覆盖）。

---

## 7. 局限、坑、以及做类似逻辑时的注意点

**当前实现的边界：**
- 只覆盖**创建草稿**，没有覆盖**发布**（publish）那一步的 mutation 名与参数。
- `restId` 的解析是「宽松探测」，接入真实环境后按实际响应校正。

**做同类功能时最容易踩的坑：**
1. **`queryId` 会轮换。** X 会不定期改 `g1l5N8BxGewYuCy5USe_bQ`。做成可配置（参考实现已支持覆盖），失效时从 x.com 前端 bundle 里重新取。
2. **`x-client-transaction-id`。** 同源页面内可省，但服务端/跨域调用时 X 常会校验。它由 x.com 前端一段混淆代码基于请求方法+路径动态算出；真要在页面外调用，得自行实现这套算法或在页面上下文里发请求。
3. **`media_category` 两处不同**：上传 `tweet_image`，正文引用 `DraftTweetImage`。
4. **`media_id` 用字符串**（`media_id_string`），别用数字版。
5. **offset 用 UTF-16 code unit**：别按「字符数」或字节数算，emoji（代理对）会让你和 X 对不齐。
6. **entity key 全局连续递增**，block 级和 inline 级共用一个计数器；MEDIA 的 `local_media_id` 必须等于其 key。
7. **合规**：本质是拿用户自己的登录态操作用户自己的账号，属自动化脚本。别高频、别跨账号批量，注意 X 的自动化政策与频控。

**给复用者的分层建议**（后续做「发普通推文 / 发 thread / 导入到别的富文本编辑器」都能套）：

```
鉴权 & HTTP        →  packages/x-article/src/xArticleClient.ts   （换接口只改这层）
内容模型转换        →  packages/x-article/src/contentState.ts     （换目标编辑器就重写映射，这层最值钱）
端到端编排          →  packages/x-article/src/publishArticle.ts   （收集资源→上传→转换→提交，骨架不变）
数据类型            →  packages/x-article/src/types.ts
```

---

## 8. 参考实现怎么用

```bash
cd packages/x-article
npm install
npm run typecheck        # 类型检查
npm run build            # 编译到 dist/
```

```ts
import { publishXArticle } from '@kaitox/x-article';

const { restId, contentState, mediaMap, skippedImages } = await publishXArticle({
  markdown,                                  // 你的 Markdown
  // title 不传会自动取第一个标题
  credentials: {
    bearerToken: '',                         // 留空用内置默认公开 bearer
    csrfToken: '<你的 ct0>',
    cookie: '<完整 cookie 串>',               // 服务端调用必填
  },
  clientOptions: { credentialsMode: 'omit' } // 服务端：不靠浏览器自动带 cookie
});
```

- 只想要「Markdown → content_state」而不发布：直接用 `markdownToContentState(md, { src: media_id })`。
- 想跑在浏览器扩展 content script 里：`credentialsMode` 用默认 `'include'`，`cookie`/`csrfToken` 可从页面取，同源 fetch 自动带登录态。

> 转换正确性由 `npm test`（`packages/x-article/test/validate.mjs`）覆盖：35 条断言逐条比对期望真值，包括那条 CJK 加粗 `offset:27,length:19`。
