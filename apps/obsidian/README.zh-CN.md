[English](README.md) | 简体中文

# @kaitox/obsidian

[Kaitox](../../README.zh-CN.md) 个人工具集的 Obsidian 产品（私有，不发布）。当前功能：在 vault 里把当前笔记一键同步为 **X (Twitter) Article 草稿**。

## 工作原理

插件是 Kaitox 流水线的上传端——只负责检查和打包，真正的上传在你的浏览器里完成：

1. 读取当前笔记；从 frontmatter 解析 `title:` 和 `cover:`。
2. 把每张图片解析成字节——`![[wikilink]]` 嵌入、带 vault 相对路径的标准 `![alt](src)`、远程 `http(s)` URL——并改写为稳定的文件名（重复引用复用同一份资源）。解析不到的图片原样保留，并在通知里报告。
3. 运行推特友好度风格检查（[`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) 的 `checkMarkdownStyle`）。友好的笔记直接上传；否则弹出对话框逐条列出问题（级别、行号、建议），三选一：**去修改** / **纯文本兜底** / **原样上传**。关闭对话框即取消。
4. 把草稿包（原始 Markdown + 图片字节，附风格报告和笔记元数据）通过 [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.zh-CN.md) POST 到本地 relay（`http://127.0.0.1:8765`）。
5. [Chrome 插件](../extension)在你已登录的 `x.com/compose/articles` 页面上拾取草稿——在那里点「上传草稿」完成最后一步。

纯文本模式下，Markdown 在上传时一次性降级（`toPlaintextMarkdown`）；图片引用和资源保持不变。

## 安装

在仓库根目录：

```bash
npm run build:obsidian   # 打包插件 → apps/obsidian/dist/
```

把 `apps/obsidian/dist/` 拷进 vault 的 `.obsidian/plugins/kaitox/`，在「设置 → 第三方插件」里启用。

**仅桌面端**（`isDesktopOnly: true`）：插件要访问 `127.0.0.1` 上的本地 relay，移动端 Obsidian 做不到。

## 用法

两种方式触发同步：

- 命令面板：**同步当前笔记为 X Article 草稿**
- 左侧 ribbon：纸飞机图标（「kaitox：同步到 X 草稿」）

插件读取的 frontmatter 键：

```yaml
---
title: 我的文章标题            # 可选；缺省依次取第一个标题、文件名
cover: "[[cover.png]]"       # 可选；wikilink、vault 相对路径或 http(s) URL
---
```

封面被解析成字节后与正文分开传输（哨兵 src `__cover__`），永不出现在文章正文里。

图片解析规则：

- `![[image.png]]` 和 `![[image.png|alt]]` —— 走 Obsidian 的链接解析器；`#heading` 后缀会被去掉；非图片嵌入会被跳过并报告。
- `![alt](relative/path.png)` —— 按 vault 解析（URL 编码的路径会被解码）。
- `![alt](https://...)` —— 下载后作为字节打包。

投递成功后会弹出通知；打开 <https://x.com/compose/articles>，在 Kaitox 面板里点「上传草稿」。投递失败时，先确认本地 relay 在运行（`kaitox relay --daemon`，或跑一次 `kaitox x push`，它会自动拉起）。

## 设置

| 设置 | 默认值 | 用途 |
|---|---|---|
| relay 地址 | `http://127.0.0.1:8765` | 本地 kaitox relay 的地址。 |
| relay token（可选） | 空 | 如果你的 relay 启用了 token（`~/.kaitox/config.json`），在这里设成相同的值；以 `x-kaitox-token` 请求头发送。 |

## 合规

与[根 README](../../README.zh-CN.md#已知边界) 相同的提醒：整条流水线是用你自己已登录的 x.com 会话调 X 的私有网页接口，属非官方用法，随时可能失效；这是对你自己账号的自动化——风险自担，控制频率，注意 X 的自动化政策。

## 相关

- [根 README](../../README.zh-CN.md) — Kaitox 工具集与完整的草稿流水线。
- [`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) — 风格检查、纯文本兜底、标题推导。
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.zh-CN.md) — 投递草稿用的线上契约。
- [`apps/extension`](../extension) — 完成上传的 Chrome 插件。
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) · [`docs/x-article-publish-protocol.md`](../../docs/x-article-publish-protocol.md)
