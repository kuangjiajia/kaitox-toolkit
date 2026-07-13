[English](README.md) | 简体中文

# @kaitox/extension

[Kaitox](../../README.zh-CN.md) 个人工具集的浏览器产品（私有，不发布）。一个 Chrome MV3 插件，在你自己已登录的浏览器会话里执行各功能的浏览器侧步骤。当前功能：在 `x.com/compose/articles` 页把本地 relay 里的待办 **X (Twitter) Article 草稿**一键上传。

## 工作原理

插件是 Kaitox 流水线的发布端——上传端（CLI、Obsidian 插件或你自己的服务）只负责检查和打包，需要登录页面才能做的事都由插件完成：

1. content script 跑在 `x.com/compose/articles*` 上，在 Articles 页标题行（挨着「新建文章」按钮）注入一个「上传草稿」按钮。X 会频繁重绘 header，所以用 `MutationObserver` 加低频定时器兜底，按钮被冲掉后自动补回。
2. 按钮的下拉面板每 5 秒轮询本地 relay，列出待上传草稿（标题、来源、富文本/纯文本模式、风格问题计数）。只显示 `kind` 为 `'x-article'` 的草稿包——其他 kind 留给别的消费者。
3. 点击上传时，或在开启「跳转到页面立即自动上传」后打开带 `kaitoxAutoUpload=1&kaitoxDraftId=<id>` 的自动上传 URL 时，从 `document.cookie` 读 `ct0`（页面已登录，同源请求自动带 cookie），从 relay 拉取草稿的图片字节，然后调用 [`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) 的 `publishXArticle`：逐图上传（`INIT`/`APPEND`/`FINALIZE`）→ `markdownToContentState` → `ArticleEntityDraftCreate` → 有封面则再走 `ArticleEntityUpdateCoverMedia` 设置封面。
4. 成功后把草稿在 relay 上确认为 `done`，并跳转到 `x.com/compose/articles/edit/<rest_id>`。若从 X 的响应里解析不到 `rest_id`，草稿其实已经建好——去文章列表里找。失败会记为 `failed`，可在面板里重试。
5. service worker 另外每分钟轮询一次 relay，把待上传数量显示在插件工具栏图标的角标上。

下拉面板里也可以删除草稿（就地二次确认，避免误删）。

## 安装

**推荐——[从 Chrome 应用商店安装](https://chromewebstore.google.com/detail/kaitox/ljefnciiojdefgpnphihcijfdmbdomll)**，点「添加至 Chrome」即可，自动更新。然后打开 <https://x.com/compose/articles>，Kaitox 按钮出现在页面标题行。

想用已解压的版本？从 [Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases) 拿最新构建：下载 `kaitox-extension-<版本>.zip` 解压，然后 `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选解压出来的文件夹。

### 从源码构建

开发时可自行构建已解压的插件，在仓库根目录：

```bash
npm run build:extension   # 打包插件 → apps/extension/dist/
```

然后按上面的方式加载 `apps/extension/dist/`。按钮的悬浮提示会显示构建时间戳，重新加载后可以据此确认生效的是哪个构建。

## 设置

工具栏 popup 和页内设置浮窗会写入 `chrome.storage.sync`，键与默认值如下：

| 键 | 默认值 | 用途 |
|---|---|---|
| `relayBase` | `http://127.0.0.1:8765` | 本地 Kaitox relay 的地址。 |
| `relayToken` | 未设置 | 如果你的 relay 启用了 token（`~/.kaitox/config.json`），在这里设成相同的值；以 `x-kaitox-token` 请求头发送。 |
| `showUploadButton` | `true` | 是否在 X Articles 页面显示 Kaitox 上传按钮。 |
| `autoUploadAfterOpen` | `true` | 是否启用「跳转到页面立即自动上传」。只有带 `kaitoxAutoUpload=1&kaitoxDraftId=<id>` 的 URL 会自动开始。 |
| `queryId` | 内置常量 | 覆盖 `ArticleEntityDraftCreate` 的 GraphQL queryId。X 会轮换这些 id——建草稿开始失败时，在这里设一个新的。 |
| `coverQueryId` | 内置常量 | 覆盖 `ArticleEntityUpdateCoverMedia` 的 queryId。 |

设置方法：在插件的 service worker 控制台（`chrome://extensions` →「检查视图」）里执行，例如 `chrome.storage.sync.set({ queryId: '...' })`。

## 合规

上传是用你自己已登录的 x.com 会话调 X 的私有网页接口，属非官方用法，X 轮换 queryId 或改响应结构时随时可能失效；这是对你自己账号的自动化——风险自担，控制频率，注意 X 的自动化政策。

## 相关

- [根 README](../../README.zh-CN.md) — Kaitox 工具集与完整的草稿流水线。
- [`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) — 插件运行的引擎（转换器、客户端、编排）。
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.zh-CN.md) — 轮询 relay 用的线上契约。
- [`apps/obsidian`](../obsidian) — 从 vault 推草稿过来的 Obsidian 插件。
- [`docs/integrate-browser-extension.zh-CN.md`](../../docs/integrate-browser-extension.zh-CN.md) — 基于同一个 relay 实现你自己的上传器。
- [`docs/x-article-publish-protocol.zh-CN.md`](../../docs/x-article-publish-protocol.zh-CN.md) — 完整的 X 线上协议。
