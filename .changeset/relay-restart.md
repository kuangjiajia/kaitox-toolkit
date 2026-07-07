---
"@kaitox/relay": minor
"@kaitox/cli": minor
---

Harden `restart` and expose it through the main CLI. `kaitox relay restart` (new) and `kaitox-relay restart` now kill whatever holds the relay port — graceful pidfile SIGTERM first, then a port sweep via `lsof`/`netstat` that catches orphan processes whose pidfile is missing or stale (SIGTERM, then SIGKILL after a grace period) — before starting the daemon again. `@kaitox/relay` exports the sweep as `killPortOccupants()`.
