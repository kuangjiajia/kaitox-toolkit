[English](README.md) | 简体中文

# @kaitox/obsidian

[Kaitox](../../README.zh-CN.md) 个人工具集的 Obsidian 产品（私有，不发布）。当前功能：在 vault 里把当前笔记实时预览成 **X (Twitter) Article** 并推送到草稿箱。

## 工作原理

插件是流水线的上传端——负责预览、检查和打包，真正的发布在你的浏览器里完成。它会打开一块**发布预览面板**（右侧栏），实时映射当前笔记：

1. **渠道切换** —— 选择目标（当前是 X 文章；微信公众号作为 `soon` 占位预留）。加一个渠道 = 新引擎 + 一行注册，无需改 relay（kind 命名空间化）。
2. **实时预览** —— 解析笔记（frontmatter `title:`/`cover:`、`![[wikilink]]` 嵌入、vault 相对路径 `![alt](src)`、远程 `http(s)` 图片都解析成字节，重复引用复用同一份资源），并用与发布完全相同的转换路径（[`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) 的 `renderPreviewHtml`）渲染成 X 文章该有的样子。所见即所推。
3. **样式检查** —— 工具栏上的开关（角标显示 错误+提示 的数量），逐条列出 X 文章友好度问题（`checkMarkdownStyle`）：表格转纯文本、不可压缩的大图、外链以纯文本展示，以及通过项。
4. **封面** —— 在面板里上传/更换/移除封面；它与正文分开传输（哨兵 src `__cover__`），永不出现在正文里。没有面板内封面时，用 frontmatter 的 `cover:`。
5. **推送到草稿箱** —— 把草稿包（原始 Markdown + 图片字节 + 风格报告 + 笔记元数据）通过 [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.zh-CN.md) POST 到本地 relay（`http://127.0.0.1:8765`）。绿点反映 relay 连通状态。笔记不友好时，推送弹窗提供**纯文本兜底**（`toPlaintextMarkdown`，会降级 HTML 块/嵌套列表，但图片与资源保持不变）。
6. **在浏览器里收尾** —— [Chrome 插件](../extension)在你已登录的 `x.com/compose/articles` 页面拾取草稿并创建文章草稿。成功弹窗直接给出打开编辑器的入口。

## 安装

从 [Releases](https://github.com/kuangjiajia/kaitox-toolkit/releases) 下载 `main.js` 和 `manifest.json`，放进 vault 的 `.obsidian/plugins/kaitox/`（目录自行创建），然后在「设置 → 第三方插件」里启用 **Kaitox**。`kaitox-obsidian-<版本>.zip` 那个资产就是这两个文件打成的、可直接拖入的 `kaitox/` 文件夹。

**仅桌面端**（`isDesktopOnly: true`）：插件要访问 `127.0.0.1` 上的本地 relay，移动端 Obsidian 做不到。

### 从源码构建

开发时可自行构建，在仓库根目录执行，再把 `apps/obsidian/dist/` 拷进 `.obsidian/plugins/kaitox/`：

```bash
npm run build:obsidian   # 打包插件 → apps/obsidian/dist/
```

## 用法

先打开面板，再推送：

- 左侧 ribbon：纸飞机图标（**Kaitox：发布预览**）打开发布预览面板。
- 命令面板：**打开发布预览面板**，或 **推送当前笔记到草稿箱**（跳过面板直接进推送弹窗）。

面板工具栏上有：渠道切换、**样式检查**开关、设置齿轮、relay 状态绿点、**推送到草稿箱**按钮。

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

推送成功后，打开 <https://x.com/compose/articles>（成功弹窗有入口），让 Kaitox 扩展创建草稿。推送失败时，先确认本地 relay 在运行（`kaitox relay --daemon`，或跑一次 `kaitox x push`，它会自动拉起）——relay 可达时工具栏状态点会变绿。

## 设置

| 设置 | 默认值 | 用途 |
|---|---|---|
| relay 地址 | `http://127.0.0.1:8765` | 本地 kaitox relay 的地址。 |
| relay token（可选） | 空 | 如果你的 relay 启用了 token（`~/.kaitox/config.json`），在这里设成相同的值；以 `x-kaitox-token` 请求头发送。 |
| 推送后打开 X 文章编辑器 | 关 | 推送成功后自动打开 `x.com/compose/articles`。 |

## 合规

整条流水线是用你自己已登录的 x.com 会话调 X 的私有网页接口，属非官方用法，随时可能失效；这是对你自己账号的自动化——风险自担，控制频率，注意 X 的自动化政策。

## 相关

- [根 README](../../README.zh-CN.md) — Kaitox 工具集与完整的草稿流水线。
- [`@kaitox/x-article`](../../packages/x-article/README.zh-CN.md) — 风格检查、纯文本兜底、标题推导。
- [`@kaitox/relay-protocol`](../../packages/relay-protocol/README.zh-CN.md) — 投递草稿用的线上契约。
- [`apps/extension`](../extension) — 完成上传的 Chrome 插件。
- [`docs/ARCHITECTURE.zh-CN.md`](../../docs/ARCHITECTURE.zh-CN.md) · [`docs/x-article-publish-protocol.zh-CN.md`](../../docs/x-article-publish-protocol.zh-CN.md)
