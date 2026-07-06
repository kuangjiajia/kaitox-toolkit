# kaitox-x-publisher

把**本地 Markdown 一键发成 X (Twitter) Article 草稿**的完整工具链：本地选一份 `.md` → 检查推特友好度 → 同步到本地 relay → 在 X 草稿页用 Chrome 插件点「上传草稿」，图片与格式一次性写进 X Article 草稿。

底层不走官方开放 API，而是借用你浏览器里已登录 x.com 的会话直接调网页端的私有接口。完整的数据模型与协议说明见 **[`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md)**。

## 为什么这么设计

Chrome 插件跑在**已登录的 x.com 页面里**，所以由**插件**来上传图片 + 建草稿——同源/同站请求自动带 cookie，绕开了「手动塞 cookie」和 `x-client-transaction-id` 两个大坑。于是：

- 上传端只负责**检查 + 打包**（原始 Markdown + 图片字节），投递到本地 relay。
- 插件收到后在页面里**上传图片拿 `media_id` → `markdownToContentState` → 建草稿**，全程同源。

```
上传端（CLI / Claude skill / Obsidian）
   │  读 md + 解析本地图片字节 + styleCheck（推特友好度）
   │  不友好→建议改；用户不改→ 纯文本兜底
   ▼  POST 草稿包（bundle.json + 图片字节）
本地 relay  http://127.0.0.1:8765   ── 存 ~/.kaitox/outbox/<id>/
   ▲  GET 轮询列表 / 拉取字节（CORS 只放行 x.com / Obsidian / 本插件）
   │
Chrome 插件（content script，跑在 x.com/compose/articles 页面）
   │  面板列出待办草稿；点「上传草稿」：
   │   ① 读 document.cookie 的 ct0  ② 逐图同源 upload（INIT/APPEND/FINALIZE）
   │   ③ markdownToContentState(md, {src→media_id})  ④ ArticleEntityDraftCreate
   ▼  跳转 x.com/compose/articles/edit/<rest_id>
```

## 仓库结构（npm workspaces）

| 路径 | 内容 |
|---|---|
| `packages/core` | `@kaitox/core`：**Markdown→content_state 转换**（`contentState.ts`，最值钱）、X 私有接口客户端（`xArticleClient.ts`）、编排（`publishArticle.ts`）、**风格检查 + 纯文本兜底**（`styleCheck.ts`）、草稿包契约（`bundle.ts`）、relay 客户端（`relayClient.ts`） |
| `packages/relay` | `@kaitox/relay`：本地 HTTP 中转（零第三方依赖），存草稿包、放行 CORS |
| `packages/cli` | `@kaitox/cli`：`kaitox` 命令行 + `skills/x-article/SKILL.md`（Claude/Codex skill） |
| `apps/extension` | Chrome MV3 插件（esbuild 打包，内置 core） |
| `apps/obsidian` | Obsidian 插件：当前笔记一键同步（解析 `![[wikilink]]` 与相对/远程图片） |
| `docs/` | 协议文档（数据模型 + 映射规则 + 坑） |

## 快速开始

```bash
npm install
npm run build            # 构建 core / relay / cli
npm test                 # core 转换正确性（21 条断言）
npm run test:integration # 端到端集成测试（进程内起 relay，28 条断言，含封面链路）
npm run build:extension  # 打包 Chrome 插件 → apps/extension/dist/
npm run build:obsidian   # 打包 Obsidian 插件 → apps/obsidian/dist/
```

### 1. 用 CLI 推一份 Markdown

```bash
node packages/cli/dist/kaitox.js push path/to/post.md
#   会先打印「推特友好度」报告；不友好时问你：修改 / 纯文本兜底 / 原样上传
#   --plaintext 纯文本兜底 · --force 原样上传 · --title 覆盖标题
#   --cover <图片路径或URL> 指定文章封面（不进正文，建草稿后单独设为封面）
# relay 会被自动拉起。也可手动：kaitox relay --daemon
```

> Obsidian 里则在笔记 frontmatter 写 `cover: [[封面图.png]]`（也支持相对路径或 http(s) URL）。

（`npm link` 或把 `packages/cli/dist/kaitox.js` 加进 PATH 后可直接 `kaitox push`。Claude/Codex 里让 agent 用 `skills/x-article` 这个 skill 即可。）

### 2. 装 Chrome 插件

`chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `apps/extension/dist/`。
然后打开 <https://x.com/compose/articles>，右下角出现 kaitox 面板 → 点「上传草稿」。

### 3.（可选）装 Obsidian 插件

把 `apps/obsidian/dist/` 拷进 vault 的 `.obsidian/plugins/kaitox-x-article/`，在设置里启用。
命令面板或左侧 ribbon 「同步当前笔记为 X Article 草稿」。桌面端专用（需本机 relay）。

## 推特友好度检查 & 纯文本兜底

`styleCheck.ts` 按转换器的**真实降级行为**报问题（不报假警）：表格→退化成代码块、嵌套列表→子项丢失、HTML 块→被丢弃、脚注→当字面量、`>h3`→钳到 h3、远程/缺失/过大图片等。

不友好时可选**纯文本兜底**（`mode: 'plaintext'`）：确定性预处理器只降级不友好构造（表格→段落、代码/HTML→纯段落、嵌套列表→拍平），**标题、粗斜体、链接、图片全部保留**。

## 关键不变量（改代码时守住）

- 草稿包 `assets[].src` 必须 === 插件里 `collectImageSources(markdown)` 的原样 src（两端靠它对齐）。
- 图片上传 `media_category=tweet_image`，正文引用 `DraftTweetImage`；`media_id` 用字符串版；offset 按 UTF-16；entity key 全局递增；MEDIA 的 `local_media_id === key`。均由 core 保证，`packages/core/test/validate.mjs` 是回归基线。

## 已知边界

- **queryId 轮换**：`ArticleEntityDraftCreate` 的 queryId 会变。插件解析顺序：设置里手动覆盖 → 内置常量（运行时抓取见后续）。失效时在插件设置里更新。
- **`extractRestId`**：建草稿的响应体结构随 X 变化，rest_id 解析做的是「宽松探测」，真机首次跑请对照实际响应校正（拿不到就退回文章列表页）。
- **Obsidian 移动端**无 Node、无法起 relay，桌面端专用。
- **合规**：本质是拿你自己的登录态操作你自己的账号，属自动化脚本。别高频、别跨账号批量，注意 X 的自动化政策与频控。
