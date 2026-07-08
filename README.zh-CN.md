[English](README.md) | 简体中文

# Kaitox

个人工具集——`kaitox` 命令行、Obsidian 插件、Chrome 插件和 agent skills，共享同一套本地基础设施。第一个功能：**把本地 Markdown 发成 X (Twitter) Article 草稿**——图片、排版、封面一次到位。

```bash
kaitox x push post.md
```

然后打开 [x.com/compose/articles](https://x.com/compose/articles)，在 Kaitox 面板里点「上传草稿」。搞定。

## 工作方式

1. **推送** — CLI（或 Obsidian 插件、你自己的脚本）对 Markdown 做风格检查，连同图片字节打包，投递到 `127.0.0.1` 上的本地 relay。
2. **中转** — relay 只监听回环地址，把待办草稿存在本地磁盘。数据不出你的机器。
3. **上传** — Chrome 插件在 X 草稿页取走草稿，用你自己已登录的会话创建 Article 草稿。

不走官方 API、不需要 API key：插件驱动的是你浏览器里已登录 x.com 会话的网页端接口，正常的浏览器登录态就是全部所需。完整架构与设计取舍见 [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md)。

## 产品

| 产品 | 做什么 | 详情 |
|---|---|---|
| **CLI** | `kaitox x push / list / status`——检查、打包、投递；relay 也帮你管好 | [`packages/cli`](packages/cli/README.zh-CN.md) |
| **Obsidian 插件** | 把当前笔记一键同步为草稿：wikilink、图片、`cover:` frontmatter（仅桌面端） | [`apps/obsidian`](apps/obsidian/README.zh-CN.md) |
| **Chrome 插件** | 在 X 草稿页用你自己的会话上传待办草稿 | [`apps/extension`](apps/extension/README.zh-CN.md) |
| **Agent skills** | 教会 Claude Code（及兼容 agent）替你跑完整个流程 | [`skills/`](skills/README.zh-CN.md) |

底层是三个 npm 包（ESM-only，Node >= 18）：

| 包 | 角色 |
|---|---|
| [`@kaitox/x-article`](packages/x-article/README.zh-CN.md) | X 引擎：Markdown → 文章转换、风格检查、预览渲染、X 客户端。可嵌进你自己的工具。 |
| [`@kaitox/relay`](packages/relay/README.zh-CN.md) | 本地 relay 服务（bin：`kaitox-relay`）。 |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.zh-CN.md) | 零依赖线上契约 + 与 relay 通信的 HTTP 客户端。 |

## 安装

**环境要求：** Node.js ≥ 18、一个你保持登录的 X 账号，上传那一步还需要 Chrome（或任意 Chromium 内核浏览器）。

**1. 安装 CLI**（npm）——它会带上本地 relay，并提供 `kaitox` 命令：

```bash
npm i -g @kaitox/cli
kaitox --version
```

**2. 启动本地 relay** —— 插件要轮询 `127.0.0.1` 上的它，所以它必须在跑：

```bash
kaitox relay --daemon      # 后台运行
```

`kaitox x push` 也会自动拉起 relay，所以先推送的话可以跳过这步；可用 `kaitox relay status` / `kaitox relay stop` 管理。

**3. 安装 Chrome 插件** —— 到 Releases 页下载：

<https://github.com/kuangjiajia/kaitox-toolkit/releases>

打开 **Kaitox Chrome extension** 那个 release，下载 `kaitox-extension-<版本>.zip` 解压，然后打开 `chrome://extensions`，开启**开发者模式**，点**加载已解压的扩展程序**，选解压出来的文件夹。

> 🖼️ _教程图 —— 在 `chrome://extensions` 加载已解压的扩展程序。_ —— `docs/images/01-load-extension.png`
<!-- ![加载已解压的扩展程序](docs/images/01-load-extension.png) -->

在登录状态下打开 <https://x.com/compose/articles> —— relay 在跑时，页面角落会出现 Kaitox 面板。

> 🖼️ _教程图 —— X 草稿页上的 Kaitox 面板。_ —— `docs/images/02-panel.png`
<!-- ![x.com/compose/articles 上的 Kaitox 面板](docs/images/02-panel.png) -->

（可选）[Obsidian 插件](apps/obsidian/README.zh-CN.md)可直接从 vault 推送草稿：到同一个 [Releases 页](https://github.com/kuangjiajia/kaitox-toolkit/releases)，打开 **Kaitox Obsidian plugin** 那个 release，把它的 `main.js` 和 `manifest.json` 放进 `.obsidian/plugins/kaitox/`，在设置里启用。[agent skill](skills/README.zh-CN.md) 则能让 coding agent 替你跑完整个流程。

> 上面的占位是注释掉的图片标签。把截图放到对应的 `docs/images/…` 路径，再取消每条说明下面那行的注释即可。见 [`docs/images/README.md`](docs/images/README.md)。

## 使用 X 功能

把任意 Markdown 变成 X Article 草稿只需两步——终端推送，浏览器上传。

### 1. 推送 Markdown

```bash
kaitox x push path/to/post.md
```

`push` 会对文件做风格检查、把图片解析成字节、在 relay 没起时自动拉起它，并把草稿排到你本机的队列里。它先打印一份**推特友好度报告**；若内容不够 X-friendly，会问你：去修改、降级为纯文本，还是原样上传。

> 🖼️ _教程图 —— `kaitox x push` 的输出：风格报告与草稿 id。_ —— `docs/images/03-push.png`
<!-- ![kaitox x push 输出](docs/images/03-push.png) -->

常用参数：

| 参数 | 作用 |
|---|---|
| `--title "…"` | 覆盖文章标题（默认：frontmatter 的 `title:` → 第一个标题 → 文件名）。 |
| `--cover img.png` | 设置文章封面——本地路径或 `http(s)` URL。不进正文。 |
| `--plaintext` | 把表格 / 代码 / HTML / 嵌套列表降级为安全纯文本。 |
| `--force` | 即使风格检查报问题也原样上传。 |

查看队列与结果：

```bash
kaitox x list          # relay 上待上传的草稿
kaitox x status <id>   # 单个草稿的状态，以及创建后的文章 rest_id
```

### 2. 在浏览器里上传

打开 <https://x.com/compose/articles>，在 Kaitox 面板里找到你的草稿，点**上传草稿**。插件会用你自己已登录的会话上传图片、创建 Article 草稿，然后跳进编辑器。图片和排版一次到位——满意后在 X 里自行发布。

> 🖼️ _教程图 —— 点「上传草稿」以及在 X 编辑器里生成的 Article 草稿。_ —— `docs/images/04-upload-result.png`
<!-- ![上传草稿及在 X 编辑器里的结果](docs/images/04-upload-result.png) -->

完整参数、frontmatter 与图片解析规则、以及排障说明见 [CLI README](packages/cli/README.zh-CN.md)。

## 接入你自己的工具

任何能向 `127.0.0.1` POST JSON 的程序都可以推送草稿，新功能通过草稿包的 `kind` 判别字段接入：

- [`docs/integrate-local-service.zh-CN.md`](docs/integrate-local-service.zh-CN.md) — 从你自己的脚本或服务推送草稿。
- [`docs/integrate-browser-extension.zh-CN.md`](docs/integrate-browser-extension.zh-CN.md) — 基于 `@kaitox/x-article` 实现你自己的上传器。
- [`docs/x-article-publish-protocol.zh-CN.md`](docs/x-article-publish-protocol.zh-CN.md) — 完整的 X 线上协议。

## 状态与边界

`@kaitox/*` 各包已发布到 npm；Chrome 插件与 Obsidian 插件以 [GitHub Release](https://github.com/kuangjiajia/kaitox-toolkit/releases) 分发（尚未上架 Chrome 应用商店或 Obsidian 社区插件目录）。从源码构建与参与贡献见 [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md)。

发布走的是 X 的私有网页接口加你自己的登录态：非官方用法，X 调整内部实现时随时可能失效，仅用于以人类节奏发布你自己的内容——不要批量自动化。各产品的具体限制见对应 README。

## 许可证

[MIT](LICENSE)
