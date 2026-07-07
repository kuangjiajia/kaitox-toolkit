[English](README.md) | 简体中文

# Kaitox

Kaitox 是一个**个人工具集**：一组共享同一套本地基础设施的个人产品——`kaitox` 命令行、Obsidian 插件、Chrome 插件和 agent skills。功能横跨各产品；第一个功能是把本地 Markdown 发成 **X (Twitter) Article 草稿**。

## 产品

### CLI — [`@kaitox/cli`](packages/cli/README.zh-CN.md)

`kaitox` 命令。功能按命名空间组织（`kaitox x push|list|status`），基础设施在 `kaitox relay ...` 下。新增功能只是新增一个命名空间，不需要新的二进制。

### Obsidian 插件 — [`apps/obsidian`](apps/obsidian/README.zh-CN.md)

在 vault 里把当前笔记一键同步为 X Article 草稿：解析 `![[wikilink]]`、相对路径与远程图片，支持 `cover:` frontmatter。仅桌面端（插件需要访问本机 relay）。

### Chrome 插件 — [`apps/extension`](apps/extension/README.zh-CN.md)

MV3 companion，在你自己已登录的浏览器会话里执行各功能的浏览器侧步骤。对 X Article 发布功能而言，它跑在 `x.com/compose/articles` 上，轮询本地 relay 并上传待办草稿。

### Agent skills — [`skills/`](skills/README.zh-CN.md)

Skills 教会 coding agent（Claude Code 及兼容宿主）驱动其他产品。当前有：[`x-article`](skills/x-article/SKILL.md)——通过 `kaitox x push` 把 Markdown 检查并同步为 X Article 草稿。

## 功能

功能横跨各产品。每个功能 = 一个引擎包 + 一个 CLI 命名空间 + 草稿包上的一个 `kind` + 各产品上需要的表面。新功能通过草稿包的 `kind` 判别字段接入（见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)）。

### X Article 发布

选一份 `.md`，做风格检查，推到本地 relay，再在 X 草稿页的浏览器插件里点「上传草稿」，图片与格式一次性写进 Article 草稿。

它不走官方开放 API，而是由插件驱动**你浏览器里已登录 x.com 会话**的网页端接口。完整的数据模型与协议说明见 [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md)。

Chrome 插件跑在**已登录的 x.com 页面里**，所以由插件来上传图片、创建草稿——同源请求自动带 cookie（`credentials: 'include'`，`ct0` cookie 作为 `x-csrf-token`），绕开了「手动塞 cookie」和 `x-client-transaction-id` 两个大坑。于是：

- 上传端只负责**检查 + 打包**（原始 Markdown + 图片字节），投递到本地 relay。
- 插件收到后在页面里**上传图片拿 `media_id` → `markdownToContentState` → 建草稿**，全程同源。

草稿包刻意携带**原始 Markdown 而不是预先构建的 `content_state`**：图片的 `media_id` 只有在登录页面里上传之后才存在，所以转换必须放在插件这一侧。

```
上传端（CLI / Obsidian / 你自己的服务）
   │  读 md + 收集本地图片字节 + 风格检查（推特友好度）
   │  不友好 → 建议修改；用户不改 → 纯文本兜底
   ▼  POST 草稿包（原始 Markdown + 图片字节，base64，单个 JSON）
本地 relay  http://127.0.0.1:8765   ── 存 ~/.kaitox/outbox/<id>/
   ▲  GET 轮询列表 / 拉取字节（CORS 白名单：x.com / Obsidian / 插件）
   │
Chrome 插件（MV3 content script，跑在 x.com/compose/articles，每 5 秒轮询）
   │  面板列出待办草稿；点「上传草稿」：
   │   ① 读 document.cookie 的 ct0   ② 逐图同源上传（INIT/APPEND/FINALIZE）
   │   ③ markdownToContentState(md, {src → media_id})   ④ ArticleEntityDraftCreate
   ▼  跳转 x.com/compose/articles/edit/<rest_id>
```

## 仓库结构（npm workspaces）

所有发布包均为 ESM-only，要求 Node >= 18（版本号由 changesets 管理；尚未发布到 npm）。

**产品：**

| 产品 | 用途 |
|---|---|
| [`@kaitox/cli`](packages/cli/README.zh-CN.md) | `kaitox` 命令行：`kaitox x push/list/status`、`kaitox relay ...`。 |
| [`apps/extension`](apps/extension/README.zh-CN.md) | Chrome MV3 插件（私有，不发布）——跑在 x.com/compose/articles 上的上传器。 |
| [`apps/obsidian`](apps/obsidian/README.zh-CN.md) | Obsidian 插件（私有，不发布）——把当前笔记同步为 X Article 草稿。仅桌面端。 |
| [`skills/`](skills/README.zh-CN.md) | 给 Claude Code 及兼容宿主的 agent skills（Markdown，不是 npm 包）。 |

**功能引擎：**

| 包 | 用途 |
|---|---|
| [`@kaitox/x-article`](packages/x-article/README.zh-CN.md) | X 引擎：`markdownToContentState`、`collectImageSources`、`XArticleClient`、`publishXArticle`、风格检查 + 纯文本兜底、X 常量。可跑在浏览器（x.com 同源）和 Node。 |

**基础设施：**

| 包 | 用途 |
|---|---|
| [`@kaitox/relay`](packages/relay/README.zh-CN.md) | 本地 relay 服务（bin `kaitox-relay`），把草稿包存到 `~/.kaitox/outbox/`，入库时静默重编码超限图片。 |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.zh-CN.md) | 零依赖线上契约：`DraftBundle` / `DraftAsset` / `StyleReport` 等类型、`RelayClient` 接口、`HttpRelayClient`、base64 工具。 |

## 快速开始

```bash
npm install
npm run build            # 依次构建 relay-protocol → x-article → relay → cli
npm test                 # x-article 引擎测试（35 条断言）
npm run test:integration # 端到端：进程内 relay + 上传流水线（31 条断言）
npm run test:protocol    # relay-protocol 线上契约冒烟测试（10 条断言）
npm run test:all         # 构建 + 上面全部
npm run build:extension  # 打包 Chrome 插件 → apps/extension/dist/
npm run build:obsidian   # 打包 Obsidian 插件 → apps/obsidian/dist/
```

### 1. 用 CLI 推一份 Markdown

```bash
kaitox x push path/to/post.md
#   会先打印「推特友好度」报告；不友好时问你：
#   修改 / 纯文本兜底 / 原样上传
#   --title T          覆盖标题
#   --cover IMG        文章封面（本地路径或 http(s) URL；不进正文，
#                      建草稿后单独设为封面）
#   --plaintext        降级为纯文本模式
#   --force            不友好也原样（rich）上传
kaitox x list            # 列出 relay 上待上传的草稿
kaitox x status <id>     # 查看单个草稿状态
```

`push` 会自动拉起 relay。也可以手动管理：`kaitox relay --daemon` / `kaitox relay stop` / `kaitox relay status`。在包发布到 npm 之前，可直接跑 workspace 里的 bin（`node packages/cli/dist/kaitox.js ...`）或 `npm link`。

配置：`KAITOX_HOME`（默认 `~/.kaitox`）、`KAITOX_RELAY_PORT`（默认 `8765`）；relay 只绑定 `127.0.0.1`。可选的每机 token 写在 `~/.kaitox/config.json`，以 `x-kaitox-token` 请求头校验（`GET /health` 豁免）。

### 2. 装 Chrome 插件

`chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选 `apps/extension/dist/`。
然后打开 <https://x.com/compose/articles>，页面角落出现 Kaitox 面板 → 点「上传草稿」。

### 3.（可选）装 Obsidian 插件

把 `apps/obsidian/dist/` 拷进 vault 的 `.obsidian/plugins/kaitox/`，在设置里启用。用命令面板或左侧 ribbon 把当前笔记同步为 X Article 草稿。封面用 frontmatter 指定：`cover: [[封面图.png]]`（相对路径和 http(s) URL 也支持）。仅桌面端——插件需要访问本机 relay。

### 4.（可选）装 agent skill

```bash
cp -r skills/x-article ~/.claude/skills/
```

之后 coding agent 就能替你跑完整个检查加投递的流程。详见 [`skills/README.zh-CN.md`](skills/README.zh-CN.md)。

## 把 Kaitox 接进你自己的工具

任何能向 `127.0.0.1` POST JSON 的程序都可以当上传端，relay 的 REST 接口小而稳定：

- [`docs/integrate-local-service.md`](docs/integrate-local-service.md) — 从你自己的脚本或服务向 relay 投递草稿包（用 `@kaitox/relay-protocol` 或裸 HTTP）。
- [`docs/integrate-browser-extension.md`](docs/integrate-browser-extension.md) — 插件侧的工作原理，以及如何基于 `@kaitox/x-article` 实现你自己的上传器。

## 关键不变量（改代码时守住）

- `bundle.assets[].src` 必须与 `collectImageSources(markdown)` 的输出逐字相等——两端靠它对齐。
- 封面图使用哨兵 src `'__cover__'`，在线上 assets 里以 `cover.fileName` 传递；永不出现在正文中。
- 草稿包缺省 `kind` 即为 `'x-article'`。relay 只存储和转发 `kind`，不做解释——后续功能就是这样接入的。
- 草稿包携带原始 Markdown，永不携带预构建的 `content_state`（media_id 只有在登录页面上传之后才存在）。
- 引擎级不变量（字符串版 `media_id`、UTF-16 offset、全局递增的 entity key、`local_media_id === key`、`media_category=tweet_image`）由 `@kaitox/x-article` 保证；`packages/x-article/test/validate.mjs` 是回归基线。

## 已知边界

- **queryId 轮换**：X 会轮换 `ArticleEntityDraftCreate` 等接口的 queryId。插件的解析顺序：设置里手动覆盖 → 内置常量。建草稿开始失败时，去插件设置里更新 queryId。
- **`extractRestId` 脆弱**：建草稿的响应体结构随 X 变化，`rest_id` 解析做的是宽松探测；拿不到时插件停留在当前页，提示你到文章列表里查看刚建的草稿。
- **Obsidian 仅桌面端**：移动端 Obsidian 没有 Node，也无法访问本机 relay。
- **合规**：本质是用你自己的登录态调 X 的私有网页接口，属非官方用法，X 轮换 queryId 时随时可能失效；这是对你自己账号的自动化——风险自担，控制频率，不要跨账号批量操作，注意 X 的自动化政策与频控。

## 延伸阅读

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 组件全景、一份草稿的生命周期、设计取舍。
- [`docs/x-article-publish-protocol.md`](docs/x-article-publish-protocol.md) — 完整数据模型、Markdown → `content_state` 映射规则与坑。

## 许可证

[MIT](LICENSE)
