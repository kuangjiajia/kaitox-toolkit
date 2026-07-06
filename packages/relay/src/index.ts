/** @kaitox/relay 程序化入口。也可直接用 CLI（bin: kaitox-relay，见 dist/cli.js）。 */
export { startRelay } from './server.js';
export type { RelayServerHandle } from './server.js';
export {
  isRelayUp,
  spawnDaemon,
  stopDaemon,
  relayBaseUrl,
} from './daemon.js';
export {
  RELAY_VERSION,
  DEFAULT_PORT,
  HOST,
  relayPort,
  kaitoxHome,
  outboxDir,
  sentDir,
  configPath,
  pidPath,
  loadConfig,
  isAllowedOrigin,
} from './config.js';
export type { RelayConfig } from './config.js';
