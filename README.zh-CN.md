[English](README.md) | 简体中文

# Kaitox

Kaitox 是我的个人工具集——一组共享同一套本地基础设施、还在不断生长的小效率工具。每个工具都通过最合适的入口触达你：coding agent、Obsidian 插件、Chrome 插件，或 `kaitox` 命令行。

## 功能

| 功能 | 状态 | 做什么 |
|---|---|---|
| [**X Article 发布**](docs/Features/x-article.zh-CN.md) | ✅ 已上线 | 把本地 Markdown 发成 X (Twitter) Article 草稿——图片、排版、封面一次到位。 |
| 更多功能 | 🌱 在路上 | 更多个人效率工具，共享同一套本地 relay。 |

## 安装

各部分从最合适的地方获取：**agent skill** 放在本仓库里，**Chrome 插件**和 **Obsidian 插件**以 [GitHub Release](https://github.com/kuangjiajia/kaitox-toolkit/releases) 分发，`kaitox` CLI 在 npm 上。用到哪个功能，就装哪几块。

**环境要求：** Node.js ≥ 18。X Article 功能还需要一个你保持登录的 X 账号，以及上传那一步用的 Chromium 内核浏览器（Chrome / Edge / Brave）。

### Agent skill

Skill 教会 coding agent（Claude Code、Codex 及兼容宿主）替你驱动 Kaitox。从本仓库的 checkout 里复制：

```bash
# Claude Code —— 复制目录，靠 description 自动触发
cp -r skills/kaitox-x-article ~/.claude/skills/                 # 单个 skill
for d in skills/*/; do cp -r "${d%/}" ~/.claude/skills/; done   # 所有 skill
# 把 ~/.claude/skills/ 换成 .claude/skills/ 即按项目安装

# Codex —— 把 SKILL.md 复制进 prompts 目录，成为一个 /命令
cp skills/kaitox-x-article/SKILL.md ~/.codex/prompts/kaitox-x-article.md               # 单个 skill
for d in skills/*/; do cp "$d/SKILL.md" ~/.codex/prompts/"$(basename "$d")".md; done   # 所有 skill
```

其它能识别 `SKILL.md` 的宿主，直接指向本仓库的 `skills/` 目录即可。更多见 [`skills/README.zh-CN.md`](skills/README.zh-CN.md)。

> **注意：** Chrome 插件和 Obsidian 插件正在 Chrome 应用商店和 Obsidian 社区插件目录审核中。审核通过前，请按下面的步骤从 GitHub Release 手动安装。

### Chrome 插件

到 [Releases 页](https://github.com/kuangjiajia/kaitox-toolkit/releases)，打开 **Kaitox Chrome extension** 那个 release，下载 `kaitox-extension-<版本>.zip` 解压。然后打开 `chrome://extensions`，开启**开发者模式**，点**加载已解压的扩展程序**，选解压出来的文件夹。

### Obsidian 插件

到同一个 [Releases 页](https://github.com/kuangjiajia/kaitox-toolkit/releases)，打开 **Kaitox Obsidian plugin** 那个 release，把它的 `main.js` 和 `manifest.json` 放进 vault 的 `.obsidian/plugins/kaitox/`，在设置里启用（仅桌面端）。

### CLI

```bash
npm i -g @kaitox/cli
```

可选——缺失时 agent skill 会自动帮你装上。命令与参数说明见 [CLI README](packages/cli/README.zh-CN.md)。

装好后，使用 X Article 功能只有两步——同步，再上传。完整流程见 **[发布到 X](docs/Features/x-article.zh-CN.md)**。

## 工作方式

每个 Kaitox 工具都是同一个形状：一个推送方把活儿打包，交给 `127.0.0.1` 上的本地 relay；一个消费方取走、把剩下的事做完。relay 只监听回环地址——数据不出你的机器——功能之间用命名空间隔开、互不干扰，新工具能直接插进来、不动上一个。

完整架构与设计取舍见 [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md)。

## 底层

三个 npm 包（ESM-only，Node >= 18）：

| 包 | 角色 |
|---|---|
| [`@kaitox/relay`](packages/relay/README.zh-CN.md) | 本地 relay 服务（bin：`kaitox-relay`）——每个功能都会复用的共享地基。 |
| [`@kaitox/relay-protocol`](packages/relay-protocol/README.zh-CN.md) | 零依赖线上契约 + 与 relay 通信的 HTTP 客户端。 |
| [`@kaitox/x-article`](packages/x-article/README.zh-CN.md) | X 引擎（Markdown → 文章转换、风格检查、预览渲染、X 客户端）——X Article 功能专用。 |

## 接入你自己的工具

任何能向 `127.0.0.1` POST JSON 的程序都可以推送草稿，新功能通过草稿包的 `kind` 判别字段接入：

- [`docs/integrate-local-service.zh-CN.md`](docs/integrate-local-service.zh-CN.md) — 从你自己的脚本或服务推送草稿。
- [`docs/integrate-browser-extension.zh-CN.md`](docs/integrate-browser-extension.zh-CN.md) — 基于 `@kaitox/x-article` 实现你自己的上传器。
- [`docs/x-article-publish-protocol.zh-CN.md`](docs/x-article-publish-protocol.zh-CN.md) — 完整的 X 线上协议。

## 状态与边界

`@kaitox/*` 各包已发布到 npm；Chrome 插件与 Obsidian 插件正在 Chrome 应用商店和 Obsidian 社区插件目录审核中，目前需从 [GitHub Release](https://github.com/kuangjiajia/kaitox-toolkit/releases) 手动安装。从源码构建与参与贡献见 [`docs/ARCHITECTURE.zh-CN.md`](docs/ARCHITECTURE.zh-CN.md)。

## 许可证

[MIT](LICENSE)
