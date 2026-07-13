/**
 * 设置 UI 的共享状态 hook：读取/保存 relay 地址、上传按钮和自动上传开关，
 * 维护连接状态胶囊。设置 popup 与页内设置浮窗共用。
 */
import { useCallback, useEffect, useState } from 'react';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import { DEFAULT_RELAY_BASE } from './xsession.js';

export type PillState = 'on' | 'off' | 'err';

export interface RelaySettings {
  /** 存储值是否已回填（回填前不渲染控件，避免默认开关状态闪动）。 */
  ready: boolean;
  relayBase: string;
  setRelayBase: (v: string) => void;
  /** 保存 relay 地址并 ping 一次（input change 时调）。 */
  commitRelayBase: () => Promise<void>;
  pill: { state: PillState; text: string };
  showButton: boolean;
  flipShowButton: () => Promise<void>;
  autoUploadAfterOpen: boolean;
  flipAutoUploadAfterOpen: () => Promise<void>;
}

function normalize(v: string): string {
  return v.trim().replace(/\/+$/, '') || DEFAULT_RELAY_BASE;
}

async function makeClient(base: string): Promise<HttpRelayClient> {
  const stored = (await chrome.storage.sync.get(['relayToken'])) as { relayToken?: string };
  return new HttpRelayClient(base, {
    token: stored.relayToken || undefined,
    fetchImpl: fetch.bind(globalThis),
  });
}

/** @param active 为 false 时不加载（浮窗收起时挂起；每次翻到 true 重新回填存储值）。 */
export function useRelaySettings(active = true): RelaySettings {
  const [ready, setReady] = useState(false);
  const [relayBase, setRelayBase] = useState(DEFAULT_RELAY_BASE);
  const [showButton, setShowButton] = useState(true);
  const [autoUploadAfterOpen, setAutoUploadAfterOpen] = useState(true);
  const [pill, setPill] = useState<{ state: PillState; text: string }>({ state: 'off', text: '检测中…' });

  const ping = useCallback(async (base: string) => {
    try {
      await (await makeClient(base)).health();
      setPill({ state: 'on', text: '已连接' });
    } catch {
      setPill({ state: 'err', text: '未连接' });
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setReady(false);
    void (async () => {
      let base = DEFAULT_RELAY_BASE;
      let show = true;
      let autoUpload = true;
      try {
        const stored = (await chrome.storage.sync.get(['relayBase', 'showUploadButton', 'autoUploadAfterOpen'])) as {
          relayBase?: string;
          showUploadButton?: boolean;
          autoUploadAfterOpen?: boolean;
        };
        base = stored.relayBase || DEFAULT_RELAY_BASE;
        show = stored.showUploadButton !== false;
        autoUpload = stored.autoUploadAfterOpen !== false;
      } catch {
        /* storage 不可用时用默认 */
      }
      if (cancelled) return;
      setRelayBase(base);
      setShowButton(show);
      setAutoUploadAfterOpen(autoUpload);
      setReady(true);
      void ping(normalize(base));
    })();
    return () => {
      cancelled = true;
    };
  }, [active, ping]);

  const commitRelayBase = useCallback(async () => {
    const base = normalize(relayBase);
    await chrome.storage.sync.set({ relayBase: base });
    await ping(base);
  }, [relayBase, ping]);

  const flipShowButton = useCallback(async () => {
    const next = !showButton;
    setShowButton(next);
    await chrome.storage.sync.set({ showUploadButton: next });
  }, [showButton]);

  const flipAutoUploadAfterOpen = useCallback(async () => {
    const next = !autoUploadAfterOpen;
    setAutoUploadAfterOpen(next);
    await chrome.storage.sync.set({ autoUploadAfterOpen: next });
  }, [autoUploadAfterOpen]);

  return {
    ready,
    relayBase,
    setRelayBase,
    commitRelayBase,
    pill,
    showButton,
    flipShowButton,
    autoUploadAfterOpen,
    flipAutoUploadAfterOpen,
  };
}
