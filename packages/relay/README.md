# @kaitox/relay

Local, loopback-only draft relay for the [Kaitox](https://kaitox.ai) publishing platform. Upload clients (the [`@kaitox/cli`](../cli/README.md), the Obsidian plugin, or your own service) POST draft bundles — raw Markdown plus image bytes — to `http://127.0.0.1:8765`; the relay stores them on disk under `~/.kaitox/outbox/`, and the Kaitox Chrome extension polls it from `https://x.com/compose/articles` to publish drafts using your own logged-in session.

Zero third-party dependencies: pure `node:http`, plus the zero-dep [`@kaitox/relay-protocol`](../relay-protocol/README.md) wire contract. Ships the `kaitox-relay` CLI.

Requires Node.js >= 18 (global `fetch`). ESM only.

## Install

Globally, for the CLI:

```bash
npm install -g @kaitox/relay
```

Or as a dependency, for programmatic use:

```bash
npm install @kaitox/relay
```

Most users never install this package directly — it ships as a dependency of [`@kaitox/cli`](../cli/README.md), and `kaitox x push` auto-spawns the relay daemon when it is not already running.

## CLI usage

```bash
kaitox-relay start      # start in the background (daemon; returns once /health is ready)
kaitox-relay dev        # run in the foreground (blocks; Ctrl-C to exit — use for debugging)
kaitox-relay stop       # stop the background daemon (SIGTERM via pidfile)
kaitox-relay status     # is it running, and where
kaitox-relay restart    # stop, then start
kaitox-relay --version  # print the version
```

Notes:

- `start` and `dev` are no-ops (with a message) if a relay already answers on the configured port.
- `stop` reads the pid from `~/.kaitox/relay.pid`, sends `SIGTERM`, and waits until the port is actually released before returning.
- If `start` fails silently, run `kaitox-relay dev` to see the actual error in the foreground.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `KAITOX_HOME` | `~/.kaitox` | Data directory (outbox, sent, config, pidfile) |
| `KAITOX_RELAY_PORT` | `8765` | Listen port (host is always `127.0.0.1`) |
| `~/.kaitox/config.json` → `token` | unset | Optional per-install shared token |

`config.json` example:

```json
{
  "token": "some-long-random-string"
}
```

When `token` is set, every request except `GET /health` (and CORS preflight) must carry it in the `x-kaitox-token` header, or the relay answers `401`.

## On-disk layout

```text
~/.kaitox/
├── config.json              # optional { "token": "..." }
├── relay.pid                # pid of the running relay
├── outbox/                  # drafts waiting to be published
│   └── <id>/
│       ├── bundle.json      # DraftBundle: raw Markdown, metadata, asset manifest
│       └── assets/
│           └── <fileName>   # decoded image bytes
└── sent/                    # drafts whose status was patched to 'done'
    └── <id>/                # same layout as outbox/<id>/
```

`GET /drafts` lists only the outbox (statuses `pending` / `uploading` / `failed`), newest first. When a draft is patched to `status: "done"`, its whole directory moves from `outbox/` to `sent/`; `GET /drafts/:id` and asset reads still find it there.

## Security model

- **Loopback only.** The server binds `127.0.0.1` — it is never reachable from other machines.
- **CORS allowlist.** Browser origins are restricted to `x.com` / `twitter.com` / `mobile.twitter.com`, any `chrome-extension://` origin, and `app://obsidian.md` (the Obsidian desktop renderer).
- **No-Origin requests are allowed.** Requests without an `Origin` header (CLI, curl, same-process code) are local tools, not cross-origin browser contexts, so they pass.
- **Optional shared token.** Set `token` in `~/.kaitox/config.json` and every client must send it as `x-kaitox-token`. `GET /health` stays token-free so liveness probes and `kaitox-relay status` keep working.
- **Path hygiene.** Draft ids and asset file names are sanitized on every read/write to prevent directory traversal.

The relay itself only stores and serves drafts. Actually publishing them — done by the Chrome extension in your logged-in x.com tab — drives X's private web endpoints, which are unofficial and may break without notice. Use at your own risk and don't mass-automate.

## Programmatic use

```ts
import { startRelay, isRelayUp, relayBaseUrl } from '@kaitox/relay';

if (!(await isRelayUp())) {
  const handle = await startRelay(); // RelayServerHandle
  console.log(`relay on ${relayBaseUrl()} (port ${handle.port})`);
  // ...later:
  await handle.close();
}
```

Exports:

| Export | Kind | Description |
| --- | --- | --- |
| `startRelay(port?)` | `async fn` | Start the HTTP server on `127.0.0.1`, write the pidfile, resolve to a `RelayServerHandle` |
| `RelayServerHandle` | type | `{ port: number; close(): Promise<void> }` |
| `isRelayUp()` | `async fn` | `GET /health` probe → `boolean` |
| `spawnDaemon(entryScript)` | `async fn` | Detach a background relay (re-runs the given CLI script with `dev`) and wait until `/health` is ready (~5 s timeout) |
| `stopDaemon()` | `async fn` | Read the pidfile, `SIGTERM`, wait for the port to free; `true` if a process was signalled |
| `relayBaseUrl()` | fn | `http://127.0.0.1:<port>` for the configured port |
| `RELAY_VERSION`, `DEFAULT_PORT`, `HOST` | consts | Version string, `8765`, `'127.0.0.1'` |
| `relayPort()`, `kaitoxHome()`, `outboxDir()`, `sentDir()`, `configPath()`, `pidPath()` | fns | Resolved config values and paths (env-aware) |
| `loadConfig()` | `async fn` | Read `~/.kaitox/config.json` → `RelayConfig` |
| `RelayConfig` | type | `{ token?: string }` |
| `isAllowedOrigin(origin?)` | fn | The CORS allowlist check described above |

## REST surface

One-liners only — see [`@kaitox/relay-protocol`](../relay-protocol/README.md) for the full wire contract (`DraftBundle`, `PostDraftWireBody`, `HttpRelayClient`, …).

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness probe → `{ ok, version, port }` (token-exempt) |
| `POST /drafts` | Store a draft bundle (`PostDraftWireBody`) → `201 { id }` |
| `GET /drafts` | List outbox drafts → `DraftListItem[]` |
| `GET /drafts/:id` | Fetch one bundle → `DraftBundle` (outbox, then sent) |
| `GET /drafts/:id/assets/:fileName` | Raw asset bytes → `application/octet-stream` |
| `PATCH /drafts/:id` | Update `{ status, restId?, error? }`; `done` moves it to `sent/` |
| `DELETE /drafts/:id` | Remove a draft from outbox and sent → `{ deleted }` |

## License

MIT © [kaitox](https://kaitox.ai)
