[English](README.md) | 简体中文

# @kaitox/relay

[Kaitox](https://kaitox.ai) 工具集的本地、仅回环草稿 relay。上传端（[`@kaitox/cli`](../cli/README.md)、Obsidian 插件，或你自己的服务）把草稿包——原始 Markdown 加图片字节——POST 到 `http://127.0.0.1:8765`；relay 将其存到磁盘上的 `~/.kaitox/<kind>/outbox/` 下（如 `~/.kaitox/x-article/outbox/`），Kaitox Chrome 插件则在 `https://x.com/compose/articles` 页面轮询它，用你自己的登录会话发布草稿。

纯 `node:http` 服务，构建在零依赖的 [`@kaitox/relay-protocol`](../relay-protocol/README.md) 线上契约之上；超过 X 上传上限（5MB）的图片在入库时由 [sharp](https://sharp.pixelplumbing.com) 静默重编码。附带 `kaitox-relay` 命令行。

要求 Node.js >= 18（全局 `fetch`）。仅 ESM。

## 安装

全局安装，使用 CLI：

```bash
npm install -g @kaitox/relay
```

或作为依赖安装，供编程使用：

```bash
npm install @kaitox/relay
```

大多数用户从不直接安装这个包——它作为 [`@kaitox/cli`](../cli/README.md) 的依赖一起分发，`kaitox x push` 会在 relay 守护进程尚未运行时自动把它拉起来。

## CLI 用法

```bash
kaitox-relay start      # start in the background (daemon; returns once /health is ready)
kaitox-relay dev        # run in the foreground (blocks; Ctrl-C to exit — use for debugging)
kaitox-relay stop       # stop the background daemon (SIGTERM via pidfile)
kaitox-relay status     # is it running, and where
kaitox-relay restart    # 杀掉占用端口的进程（没有 pidfile 也行），然后重新启动
kaitox-relay --version  # print the version
```

说明：

- 如果配置端口上已经有 relay 在应答，`start` 和 `dev` 不做任何事（只打印一条消息）。
- `stop` 从 `~/.kaitox/relay.pid` 读取 pid，发送 `SIGTERM`，并等到端口真正释放后才返回。
- 如果 `start` 静默失败，运行 `kaitox-relay dev` 在前台查看实际错误。

## 配置

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `KAITOX_HOME` | `~/.kaitox` | 数据目录（按 kind 的 `<kind>/{outbox,sent}`、配置、pidfile） |
| `KAITOX_RELAY_PORT` | `8765` | 监听端口（host 恒为 `127.0.0.1`） |
| `~/.kaitox/config.json` → `token` | 未设置 | 可选的每机共享 token |

`config.json` 示例：

```json
{
  "token": "some-long-random-string"
}
```

设置了 `token` 后，除 `GET /health`（及 CORS 预检）之外的每个请求都必须在 `x-kaitox-token` 请求头里携带它，否则 relay 应答 `401`。

`config.json` 在启动时读取，但 token 也可以在运行中的 relay 上直接修改：`PATCH /setting` 携带 `{ "token": "..." }` 设置它（`{ "token": null }` 清除），即时生效——无需重启——并会回写持久化到 `config.json`。`GET /setting` 报告 `{ port, version, tokenConfigured }`，永不返回 token 值本身。

## 磁盘目录结构

```text
~/.kaitox/
├── config.json                 # optional { "token": "..." }
├── relay.pid                   # pid of the running relay
└── <kind>/                     # 每个功能一个命名空间目录，如 x-article
    ├── outbox/                 # drafts waiting to be published
    │   └── <id>/
    │       ├── bundle.json     # DraftBundle: raw Markdown, metadata, asset manifest
    │       └── assets/
    │           └── <fileName>  # decoded image bytes
    └── sent/                   # drafts whose status was patched to 'done'
        └── <id>/               # same layout as outbox/<id>/
```

每个功能（`kind`）有自己的目录，不同 kind 的草稿绝不共用一个 outbox——`x-article` 草稿在 `~/.kaitox/x-article/` 下，后续功能各自独立。`GET /:kind/drafts` 会列出该 kind 的两个目录——outbox（状态为 `pending` / `uploading` / `failed`）**以及** `sent/` 里已完成的草稿（消费端将它们展示在「已完成」标签页里）——最新在前。当草稿被 patch 成 `status: "done"` 时，它的整个目录会从 `<kind>/outbox/` 移到 `<kind>/sent/`；`GET /:kind/drafts/:id` 和资产读取仍能在那里找到它。

## 安全模型

- **仅回环。** 服务器只绑定 `127.0.0.1`——其他机器永远无法访问。
- **CORS 白名单。** 浏览器 origin 仅限 `x.com` / `twitter.com` / `mobile.twitter.com`、任意 `chrome-extension://` origin，以及 `app://obsidian.md`（Obsidian 桌面端渲染器）。
- **允许无 Origin 请求。** 不带 `Origin` 请求头的请求（CLI、curl、同进程代码）是本地工具，不是跨域浏览器上下文，因此放行。
- **可选共享 token。** 在 `~/.kaitox/config.json` 里设置 `token`（或通过 `PATCH /setting` 在线设置）后，每个客户端都必须以 `x-kaitox-token` 发送它。`GET /health` 保持免 token，让存活探测和 `kaitox-relay status` 继续可用；`GET /setting` 报告是否已配置 token，但永不返回它的值。
- **路径卫生。** 草稿 id 和资产文件名在每次读写时都会被清洗，防止路径穿越。

relay 本身只负责存储和提供草稿。真正的发布——由 Chrome 插件在你已登录的 x.com 标签页里完成——驱动的是 X 的私有网页接口，属非官方用法，随时可能失效。风险自担，不要批量自动化。

## 编程使用

```ts
import { startRelay, isRelayUp, relayBaseUrl } from '@kaitox/relay';

if (!(await isRelayUp())) {
  const handle = await startRelay(); // RelayServerHandle
  console.log(`relay on ${relayBaseUrl()} (port ${handle.port})`);
  // ...later:
  await handle.close();
}
```

导出：

| 导出 | 类别 | 说明 |
| --- | --- | --- |
| `startRelay(port?)` | `async fn` | 在 `127.0.0.1` 上启动 HTTP 服务器，写入 pidfile，resolve 为 `RelayServerHandle` |
| `RelayServerHandle` | 类型 | `{ port: number; close(): Promise<void> }` |
| `isRelayUp()` | `async fn` | `GET /health` 探测 → `boolean` |
| `spawnDaemon(entryScript)` | `async fn` | 分离出一个后台 relay（以 `dev` 重新运行给定的 CLI 脚本），并等待 `/health` 就绪（约 5 秒超时） |
| `stopDaemon()` | `async fn` | 读取 pidfile，发送 `SIGTERM`，等待端口释放；若确有进程收到信号则返回 `true` |
| `killPortOccupants()` | `async fn` | 杀掉监听 relay 端口的进程（先 `SIGTERM`，宽限期后 `SIGKILL`）——`restart` 背后不依赖 pidfile 的兜底；发过信号则返回 `true` |
| `relayBaseUrl()` | fn | 配置端口对应的 `http://127.0.0.1:<port>` |
| `RELAY_VERSION`, `DEFAULT_PORT`, `HOST` | 常量 | 版本字符串、`8765`、`'127.0.0.1'` |
| `relayPort()`, `kaitoxHome()`, `outboxDir()`, `sentDir()`, `configPath()`, `pidPath()` | fns | 解析后的配置值与路径（感知环境变量） |
| `loadConfig()` | `async fn` | 读取 `~/.kaitox/config.json` → `RelayConfig` |
| `RelayConfig` | 类型 | `{ token?: string }` |
| `isAllowedOrigin(origin?)` | fn | 上文所述的 CORS 白名单检查 |

## REST 接口

这里只列一句话概要——完整线上契约（`DraftBundle`、`PostDraftWireBody`、`HttpRelayClient` 等）见 [`@kaitox/relay-protocol`](../relay-protocol/README.md)。

草稿路由按 `kind` 命名空间化（`/:kind/drafts...`）：路径段就是原样的 kind 字符串，relay 把它当作不透明参数——只存储、过滤和匹配，从不解释。kind 路径段必须匹配 `/^[a-z0-9][a-z0-9-]*$/`，且不能是保留字（`health`、`setting`、`drafts`）；这条规则以 `isValidKindSegment` 从 `@kaitox/relay-protocol` 导出。畸形的请求体会被拒绝为 `400 { error, issues }`（JSONPath 风格的位置）。

| 路由 | 用途 |
| --- | --- |
| `GET /health` | 存活探测 → `{ ok, version, port }`（免 token） |
| `GET /setting` | 设置视图 → `{ port, version, tokenConfigured }`——永不返回 token 值 |
| `PATCH /setting` | 更新设置：`{ token?: string \| null }`（`null` 表示清除；即时生效，无需重启） |
| `POST /:kind/drafts` | 存储一个草稿包（`PostDraftWireBody`）→ `201 { id }`；`kind` 由路径段盖章写入（请求体的 `bundle.kind` 与之不符 → `400`） |
| `GET /:kind/drafts` | 列出草稿 → `DraftListItem[]`，服务端按 kind 过滤（含 `sent/` 里已完成的草稿） |
| `GET /:kind/drafts/:id` | 获取单个草稿包 → `DraftBundle`（先查 outbox，再查 sent；跨 kind 访问 → `404`） |
| `GET /:kind/drafts/:id/assets/:fileName` | 原始资产字节 → `application/octet-stream` |
| `PUT /:kind/drafts/:id/cover` | 设置/替换封面（`SetCoverWireBody`）→ 更新后的 `DraftBundle` |
| `PATCH /:kind/drafts/:id` | 更新 `{ status, restId?, error? }` → 更新后的 `DraftBundle`；`done` 会把它移到 `sent/` |
| `DELETE /:kind/drafts/:id` | 从 outbox 和 sent 中删除草稿 → `{ deleted }` |
| `/drafts*` | `410 Gone`——v0.5 之前的根路由，应答中附迁移提示 |

## 许可证

MIT © [kaitox](https://kaitox.ai)
