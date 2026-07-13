import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DraftListItem } from '@kaitox/relay-protocol';
import { getRelayClient, getSettings } from './xsession.js';
import { runRelayUploadFlow, uploadErrorMessage } from './upload-flow.js';
import { AlertIcon, CheckIcon, CloseIcon, LogoIcon, RefreshIcon } from './icons.js';

const AUTO_UPLOAD_PARAM = 'kaitoxAutoUpload';
const DRAFT_ID_PARAM = 'kaitoxDraftId';

type AutoPhase = 'uploading' | 'success' | 'error';

interface AutoState {
  phase: AutoPhase;
  title?: string;
  message: string;
  restId?: string;
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let active = false;
let checking = false;

function autoUploadPayloadFromUrl(): { draftId: string | null } | null {
  const url = new URL(location.href);
  if (url.searchParams.get(AUTO_UPLOAD_PARAM) !== '1') return null;
  const draftId = url.searchParams.get(DRAFT_ID_PARAM)?.trim() || null;
  url.searchParams.delete(AUTO_UPLOAD_PARAM);
  url.searchParams.delete(DRAFT_ID_PARAM);
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return { draftId };
}

function ensureRoot(): Root {
  if (!host) host = document.createElement('div');
  if (!host.isConnected) document.body.append(host);
  if (!root) root = createRoot(host);
  return root;
}

function unmount(): void {
  active = false;
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
}

/** Consume the one-shot auto-upload URL parameters and start the modal if enabled. */
export function maybeStartAutoUploadFromUrl(): void {
  if (active || checking) return;
  const payload = autoUploadPayloadFromUrl();
  if (!payload) return;

  checking = true;
  void (async () => {
    try {
      const settings = await getSettings();
      if (!settings.autoUploadAfterOpen) return;
      active = true;
      ensureRoot().render(<AutoUploadModal draftId={payload.draftId} onClose={unmount} />);
    } finally {
      checking = false;
    }
  })();
}

function AutoUploadModal({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const [state, setState] = useState<AutoState>({ phase: 'uploading', message: '正在连接 relay…' });
  const started = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const openDraftBox = useCallback(() => {
    document.querySelector<HTMLButtonElement>('#kaitox-hdr-btn .kx-hdr-btn')?.click();
    onClose();
  }, [onClose]);

  const navigateToRestId = useCallback((restId: string) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => location.assign(`/compose/articles/edit/${restId}`), 700);
  }, []);

  const run = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!draftId) {
      setState({ phase: 'error', message: '自动上传链接缺少草稿 ID。请从 Obsidian 或 skill 生成新的跳转链接。' });
      return;
    }

    setState({ phase: 'uploading', message: '正在连接 relay…' });
    try {
      const client = await getRelayClient();
      await client.health();
      setState({ phase: 'uploading', message: '正在查找草稿…' });
      const item = (await client.listDrafts()).find((d) => d.id === draftId) as DraftListItem | undefined;
      if (!item) throw new Error(`relay 中找不到草稿：${draftId}`);
      if (item.status === 'done') {
        const bundle = await client.getDraft(draftId);
        if (bundle.restId) {
          setState({ phase: 'success', title: item.title, restId: bundle.restId, message: '草稿已上传，正在打开编辑页…' });
          navigateToRestId(bundle.restId);
        } else {
          setState({ phase: 'success', title: item.title, message: '草稿已上传，但 relay 没有记录 rest_id。请到文章列表查看。' });
        }
        return;
      }

      const result = await runRelayUploadFlow({
        id: draftId,
        client,
        onBundle: (bundle) => setState((s) => ({ ...s, title: bundle.title })),
        onProgress: (message) => setState((s) => ({ ...s, phase: 'uploading', title: s.title || item.title, message })),
      });

      const skipped = result.skippedImages.length ? `（跳过 ${result.skippedImages.length} 张图）` : '';
      if (result.restId) {
        setState({
          phase: 'success',
          title: item.title,
          restId: result.restId,
          message: `已创建草稿${skipped}，正在打开编辑页…`,
        });
        navigateToRestId(result.restId);
      } else {
        setState({
          phase: 'success',
          title: item.title,
          message: `已创建草稿${skipped}，但未取到 rest_id。请到文章列表查看。`,
        });
      }
    } catch (err) {
      setState({ phase: 'error', message: `上传失败：${uploadErrorMessage(err)}` });
    }
  }, [draftId, navigateToRestId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
    return () => window.clearTimeout(timer.current);
  }, [run]);

  const busy = state.phase === 'uploading';

  return (
    <div className="kx-auto-overlay" onMouseDown={busy ? undefined : onClose}>
      <div className="kx-auto-card" onMouseDown={(e) => e.stopPropagation()}>
        <button className="kx-auto-close" type="button" title="关闭" disabled={busy} onClick={onClose}>
          <CloseIcon size={18} />
        </button>
        <div className={`kx-auto-mark kx-auto-mark-${state.phase}`}>
          {state.phase === 'uploading' ? <LogoIcon size={34} /> : state.phase === 'success' ? <CheckIcon size={24} /> : <AlertIcon size={24} />}
        </div>
        <div className="kx-auto-title">
          {state.phase === 'success' ? '自动上传完成' : state.phase === 'error' ? '自动上传失败' : '正在自动上传'}
        </div>
        {state.title && <div className="kx-auto-draft">{state.title}</div>}
        <div className="kx-auto-message">{state.message}</div>
        <div className="kx-auto-id">{draftId ? `ID ${draftId}` : '未提供草稿 ID'}</div>
        {state.phase === 'error' && (
          <div className="kx-auto-actions">
            <button className="kx-auto-secondary" type="button" onClick={openDraftBox}>
              打开草稿箱
            </button>
            <button className="kx-auto-primary" type="button" onClick={() => void run()}>
              <RefreshIcon size={16} />
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
