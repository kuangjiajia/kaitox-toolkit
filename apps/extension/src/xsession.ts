/** x.com 会话 / relay 连接 / queryId 解析。 */
import {
  HttpRelayClient,
  ARTICLE_DRAFT_CREATE_QUERY_ID,
  ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
} from '@kaitox/core';

export const DEFAULT_RELAY_BASE = 'http://127.0.0.1:8765';

export interface Settings {
  relayBase: string;
  queryId: string;
  coverQueryId: string;
  token?: string;
}

/** 读取插件设置（chrome.storage.sync），带默认值。 */
export async function getSettings(): Promise<Settings> {
  let stored: Record<string, any> = {};
  try {
    stored = await chrome.storage.sync.get(['relayBase', 'queryId', 'coverQueryId', 'relayToken']);
  } catch {
    /* storage 不可用时用默认 */
  }
  return {
    relayBase: stored.relayBase || DEFAULT_RELAY_BASE,
    // queryId 解析顺序：用户覆盖 → 内置常量（运行时抓取见 P5）。
    queryId: stored.queryId || ARTICLE_DRAFT_CREATE_QUERY_ID,
    coverQueryId: stored.coverQueryId || ARTICLE_UPDATE_COVER_MEDIA_QUERY_ID,
    token: stored.relayToken || undefined,
  };
}

/** 从 document.cookie 读 ct0（非 HttpOnly），作 x-csrf-token。 */
export function readCt0(): string {
  const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function getRelayClient(): Promise<HttpRelayClient> {
  const { relayBase, token } = await getSettings();
  return new HttpRelayClient(relayBase, { token, fetchImpl: window.fetch.bind(window) });
}
