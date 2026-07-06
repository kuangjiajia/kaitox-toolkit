/**
 * @kaitox/relay-protocol — the wire contract between kaitox upload clients
 * (CLI, Obsidian, your own service) and a kaitox relay, plus a portable
 * fetch-based client.
 *
 * Layering rule: this package never imports from any other kaitox package.
 * Feature engines (e.g. @kaitox/x-article) and the relay server both depend
 * on it, never the other way around.
 *
 *   - bundle.ts       DraftBundle data contract (what travels over the wire)
 *   - relayClient.ts  RelayClient interface + HttpRelayClient (Node & browser)
 *   - base64.ts       byte <-> base64 helpers (Buffer or atob/btoa)
 */

export type {
  DraftBundle,
  DraftAsset,
  DraftListItem,
  DraftKind,
  DraftMode,
  DraftSource,
  DraftStatus,
  StyleIssue,
  StyleReport,
} from './bundle.js';
export {
  HttpRelayClient,
} from './relayClient.js';
export type {
  RelayClient,
  PostDraftInput,
  DraftAssetInput,
  PostDraftWireBody,
  HttpRelayClientOptions,
} from './relayClient.js';
export { bytesToBase64, base64ToBytes } from './base64.js';
