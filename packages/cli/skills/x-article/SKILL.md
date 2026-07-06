---
name: x-article
description: 把本地 Markdown 检查并同步为 X (Twitter) Article 草稿。当用户想把一份 .md 文件发成 X 长文草稿、或说「同步到 X 草稿 / 上传到推特文章 / push 到 kaitox」时使用。
---

# 把 Markdown 同步为 X Article 草稿

这个 skill 用 `kaitox` 命令行把一份本地 Markdown 检查、打包并投递到本地 relay，之后用户在浏览器 X 草稿页里用 kaitox Chrome 插件点「上传草稿」完成真正的上传。

**你（agent）只负责上传端这一半**：跑检查、把风格问题讲清楚、按用户意愿投递。真正把图片和正文写进 X 草稿是 Chrome 插件在用户已登录的 x.com 页面里做的——你不要、也无法替用户去调 X 的接口。

## 前置

`kaitox` 需可执行。若未全局安装，可在仓库里用 `node packages/cli/dist/kaitox.js` 代替 `kaitox`（先 `npm run build`）。

## 步骤

1. **确认目标文件**：用户给出 `.md` 路径。没给就问。

2. **先做一次检查（不直接上传）**：运行
   ```
   kaitox x push <file.md>
   ```
   它会打印「推特友好度」报告。若内容友好，会直接投递并给出草稿 id。

3. **不友好时**：`kaitox x push` 在交互终端里会停下来问怎么处理。如果你在非交互环境运行（拿不到 TTY），它会报错要求显式选择。这时你要把报告里的**每条 error/warning 用人话转述给用户**，并给出建议，然后问用户三选一：
   - **去修改**：用户自己改 Markdown（推荐，尤其是表格、嵌套列表、脚注）。改完重跑。
   - **纯文本兜底**：`kaitox x push <file.md> --plaintext`——自动把表格/代码/HTML/嵌套列表降级成安全文本，其余（标题、加粗、链接、图片）保留。
   - **原样上传**：`kaitox x push <file.md> --force`——不改，按富文本上传（不友好的构造可能渲染不佳）。

   **封面图**：用户想指定文章封面时，加 `--cover <图片路径或URL>`（相对当前目录，找不到时回退 Markdown 文件所在目录）。封面不进正文，插件在建好草稿后单独上传并设为文章封面（走 `ArticleEntityUpdateCoverMedia`）。解析不到会警告并跳过，不影响正文。

4. **投递成功后**，告诉用户：
   - 草稿 id、标题、模式（富文本/纯文本）、图片数量；
   - **下一步**：在浏览器打开 `https://x.com/compose/articles`，在右下角 kaitox 插件面板里点「上传草稿」。图片和格式会在那一步真正写进 X 草稿。

## 其它命令

- `kaitox x list` —— 看有哪些待上传草稿。
- `kaitox x status <id>` —— 看某草稿的上传状态 / 文章 rest_id。
- `kaitox relay status|--daemon|stop` —— relay 一般会被 `kaitox x push` 自动拉起，通常不用手动管。
- 旧的顶层 `kaitox push|list|status` 仍可用（会打 deprecation 提示），新脚本请一律用 `kaitox x ...`。

## 提醒用户的要点

- 这套东西是用**用户自己浏览器里已登录的 x.com 会话**替他操作**自己的**账号，属自动化脚本。别高频、别跨账号批量。
- 远程图片（http/https）会由 `kaitox x push` 先下载进草稿包，所以本机要能访问这些图片 URL。
- 本地/相对路径的图片按 Markdown 文件所在目录解析；路径不对会被标成 image-missing 并在上传时跳过。
