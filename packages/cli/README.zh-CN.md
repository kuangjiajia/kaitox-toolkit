[English](README.md) | 简体中文

# @kaitox/cli

[Kaitox](https://kaitox.ai) 个人工具集的命令行产品。当前功能：对本地 Markdown 文件做风格检查，把它和图片字节打包在一起，投递到本地 [Kaitox relay](../relay)，成为一份 **X (Twitter) Article 草稿**。之后由 Kaitox Chrome 插件在你自己已登录的浏览器会话里把草稿写进 X。

CLI 从不直接和 X 通信——它只和 `127.0.0.1` 上的 relay 打交道。各部分如何协作见[发布协议](../../docs/x-article-publish-protocol.zh-CN.md)。

## 安装

```bash
npm i -g @kaitox/cli
```

要求 Node.js >= 18。ESM-only。只安装一个二进制：`kaitox`。

## 命令

> 注：帮助文本为英文；交互式运行时信息（报告、提示、状态输出）目前为中文。

### `kaitox x push <file.md> [--title T] [--cover IMG] [--plaintext] [--force]`

对 Markdown 做风格检查，把正文引用的每张图片解析成字节，再把整个草稿包 POST 到本地 relay。如果 relay 没在运行，`push` 会自动在后台把它拉起来。

它按顺序做这些事：

1. 读取文件并剥离 YAML frontmatter（见 [Frontmatter 支持](#frontmatter-支持)）。
2. 解析正文里的所有图片（见[图片解析规则](#图片解析规则)）。
3. 运行风格检查并打印报告：错误 / 警告 / 提示，附行号和修改建议。
4. 如果内容**不够推特友好**，且你既没传 `--plaintext` 也没传 `--force`：
   - **在终端（TTY）里：**弹出三选一的交互提示——`[f]` 取消，自己去改 Markdown（默认），`[p]` 降级为纯文本模式并上传，`[u]` 以 rich 模式原样上传。
   - **非交互（无 TTY，例如 CI 或 agent）：**命令直接报错，要求你显式带上 `--plaintext` 或 `--force` 重跑。它绝不会自作主张上传不友好的内容。
5. 对所有解析失败的图片（含封面）给出警告——这些图片会被跳过，推送本身照常进行。
6. 投递草稿包，打印草稿 id、标题、模式、图片数量和后续步骤。

参数：

| 参数 | 效果 |
| --- | --- |
| `--title T` | 覆盖文章标题。优先级：`--title` > frontmatter 的 `title:` > 从内容推导的标题 > 文件名。 |
| `--cover IMG` | 设置文章封面图。接受本地路径或 `http(s)` URL。相对路径先按**当前工作目录**解析，失败再退回 Markdown 文件所在目录。封面不进正文；插件在建完草稿后单独上传并设为文章封面。解析不了时，`push` 给出警告并在无封面的情况下继续。`--cover` 必须带值。 |
| `--plaintext` | 从一开始就以纯文本兜底模式构建（跳过提示）。不友好的结构——表格、代码块、原始 HTML、嵌套列表——会被降级为安全的纯文本；标题、加粗、链接和图片得以保留。 |
| `--force` | 即使风格检查报了问题，也以 rich 模式原样上传（跳过提示）。不友好的结构在 X 编辑器里可能渲染得很难看。 |

### `kaitox x list`

列出 relay 上待处理的草稿：短 id（前 8 个字符）、状态、模式、标题，以及风格问题计数（`[<errors>E/<warnings>W]`）。要求 relay 已在运行（该命令不会自动拉起 relay）。

### `kaitox x status <id>`

显示单个草稿的标题、状态、插件在 X 上建完草稿后的文章 `rest_id`，以及上传错误（如有）。id 用 `kaitox x push` 打印出来的那个。要求 relay 已在运行。

### `kaitox relay ...`

Relay 生命周期管理。一般用不到——`kaitox x push` 会按需拉起 relay。

```bash
kaitox relay            # run in the foreground (Ctrl-C to stop)
kaitox relay --daemon   # start in the background (no-op if already running)
kaitox relay stop       # stop the background relay
kaitox relay restart    # kill whatever holds the port, then start again
kaitox relay status     # is it running, and on which URL
```

relay 监听 `http://127.0.0.1:8765`，把草稿存在 `~/.kaitox/outbox/` 下。可用 `KAITOX_RELAY_PORT` 和 `KAITOX_HOME` 覆盖。它只绑定 `127.0.0.1`。详见 [@kaitox/relay](../relay)，包括可选的每机 token。

### `kaitox --version`、`kaitox help`

```bash
kaitox --version   # or -v
kaitox help        # or -h / --help; also: kaitox x --help
```

## Frontmatter 支持

如果文件以 YAML frontmatter 块开头，它会从发布正文中剥离，且只读取**一个**键：

```markdown
---
title: My article title
---
```

- `title:`——用作文章标题，除非被 `--title` 覆盖。首尾引号会被去掉。
- **不**支持 `cover:` frontmatter——封面图只能用 `--cover` 参数指定。

frontmatter 里的其他内容一律忽略。

## 图片解析规则

`push` 收集 Markdown 正文引用的每张图片，并在推送时把每个来源解析成字节：

- **`http(s)://` URL**——由 CLI 下载（你的机器必须能访问到）。MIME 类型取响应的 `Content-Type`，取不到再退回文件扩展名。
- **`file://` URL**——从磁盘读取。
- **绝对路径**——直接读取。
- **相对路径**——按 Markdown 文件所在目录解析（URL 编码字符会被解码）。

解析不了的来源会在风格报告中标记为 `image-missing`，推送时在警告里列出，并在上传时**跳过**——草稿仍会被创建，只是不含这些图片。

`--cover` 图片的规则略有不同：相对路径先试当前工作目录，再退回 Markdown 文件所在目录。

草稿包内的文件名会做清洗和去重，同名图片绝不会互相覆盖。

## Agent skill

Agent skills 是 Kaitox 工具集里独立的一款产品，位于仓库根目录的 [`skills/`](../../skills/README.md) 下。[`x-article` skill](../../skills/x-article/SKILL.md) 教会 Claude Code / Codex 这类 coding agent 围绕这个 CLI 走完整个流程：跑 `kaitox x push`，把每条风格错误/警告翻译成大白话，向用户给出修改 / `--plaintext` / `--force` 的选择（agent 运行时没有 TTY，所以显式参数很关键），最后交棒给浏览器步骤。安装方法见 [`skills/README.md`](../../skills/README.md)。

## push 之后会发生什么

`push` 只负责把草稿投递到本地 relay，relay 把它存在 `~/.kaitox/outbox/<id>/` 下。要真正在 X 上创建草稿：

1. 在装了 Kaitox Chrome 插件且已登录 X 的浏览器里打开 <https://x.com/compose/articles>。
2. 插件每 5 秒轮询本地 relay，在面板里展示待办草稿。
3. 点上传。插件用页面自己的登录会话上传图片并创建 Article 草稿——原始 Markdown 到这一步才被转换成 X 的内容格式，因为图片的 `media_id` 只有在登录页面里上传之后才存在。
4. `kaitox x status <id>` 会反映结果，包括文章的 `rest_id`。

> **合规提示：**这本质是用你自己的登录态调用 X 的私有网页接口。属非官方用法，X 轮换内部 query id 时随时可能失效，仅用于以人类节奏发布你自己的内容——风险自担，不要批量自动化。

## 许可证

MIT © [kaitox](https://kaitox.ai)
