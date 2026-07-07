/**
 * kaitox 入口：在 x.com「Articles」列表页的标题行里注入一个「上传草稿」按钮
 *（挨着「新建文章」铅笔按钮），点开是一个居中的「草稿箱」弹窗：
 * 左栏 = 搜索 + 状态 Tab + 草稿列表 + 分页；右栏 = 选中草稿的详情与操作。
 *
 * UI 用 React 渲染：Panel 是薄控制器，只负责把按钮容器插回 X 的 header、
 * 把浮层宿主挂到 body（X 重绘后 content.ts 会反复调 mount() 补回，React root 不重建）；
 * 按钮经 createPortal 渲染进 header 容器，弹窗直接渲染在 body 宿主里。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { DraftListItem, DraftStatus, HttpRelayClient, StyleReport } from '@kaitox/relay-protocol';
import { getRelayClient, getSettings } from './xsession.js';
import { uploadDraft } from './uploader.js';
import { LOGO_SVG } from './logo.js';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  FileIcon,
  ImageIcon,
  LogoIcon,
  RefreshIcon,
  SearchIcon,
  SlidersIcon,
  TrashIcon,
} from './icons.js';
import { PreviewModal } from './preview.js';
import { CoverCropModal } from './cover-crop.js';
import { toggleSettingsPanel } from './settings-panel.js';
import { useAssetUrls, useBundleCache, type AssetUrls, type BundleCache } from './bundle-cache.js';
import { formatRelativeTime } from './time.js';
import { summarize } from './markdown-text.js';
import { KX_CLOSE_MS } from './use-closing.js';

const BTN_ID = 'kaitox-hdr-btn';
const POLL_MS = 5000;
/** 兜底每页条数：列表区还量不到高度（首帧/无行可测）时使用。 */
const PAGE_SIZE_FALLBACK = 4;
/** 兜底行高（px）：列表里还没有行时按此估算每页条数。 */
const ROW_H_FALLBACK = 100;

/** esbuild define 注入的构建时间戳（按钮 title 可见，用于确认构建版本）。 */
declare const __KX_BUILD__: string;

export class Panel {
  private btnWrap: HTMLElement;
  private host: HTMLElement;
  private root: Root | null = null;

  constructor() {
    this.btnWrap = document.createElement('div');
    this.btnWrap.id = BTN_ID;
    this.btnWrap.className = 'kx-hdr-wrap';
    this.host = document.createElement('div');
  }

  /** 定位 Articles 标题行里「新建文章」按钮的容器（我们插它左边）。 */
  private headerAnchor(): HTMLElement | null {
    // 主锚点：create（新建文章）按钮。它的父 div 是标题行里的一个 flex 项。
    const createBtn = document.querySelector('button[aria-label="create"]');
    if (createBtn?.parentElement?.parentElement) return createBtn.parentElement as HTMLElement;
    // 兜底：#root-header（"Articles" 标题）所在块的父行。
    const h = document.getElementById('root-header');
    const block = h?.parentElement?.parentElement; // h2 → titleWrap → titleBlock
    return block?.parentElement ? (block as HTMLElement) : null;
  }

  /** 幂等挂载：把按钮容器插进 header（缺了才插），并确保浮层宿主在 body 上。
   *  X 重绘后可反复调用；React root 只建一次，容器被重插不影响已渲染内容。 */
  mount(): void {
    if (!this.btnWrap.isConnected) {
      const anchor = this.headerAnchor();
      if (anchor?.parentElement) anchor.parentElement.insertBefore(this.btnWrap, anchor);
    }
    if (!this.host.isConnected) document.body.append(this.host);
    if (this.btnWrap.isConnected && !this.root) {
      this.root = createRoot(this.host);
      this.root.render(<PanelApp btnHost={this.btnWrap} />);
    }
  }

  isMounted(): boolean {
    return this.btnWrap.isConnected;
  }

  destroy(): void {
    this.root?.unmount();
    this.root = null;
    this.btnWrap.remove();
    this.host.remove();
  }
}

type Tab = 'all' | 'pending' | 'uploading' | 'done';
type ConnState = 'ok' | 'down' | 'error';

interface UploadState {
  phase: 'uploading' | 'error' | 'success';
  message: string;
}

const TAB_DEFS: { key: Tab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待上传' },
  { key: 'uploading', label: '上传中' },
  { key: 'done', label: '已上传' },
];

const RELAY_DOWN_HINT = '本地 relay 未运行。请在终端运行 `kaitox relay`（或 `kaitox x push` 时会自动拉起）。';

function badgeFor(status: DraftStatus): { label: string; cls: string } {
  switch (status) {
    case 'uploading':
      return { label: '上传中', cls: 'kx-badge-uploading' };
    case 'done':
      return { label: '已上传', cls: 'kx-badge-done' };
    case 'failed':
      return { label: '上传失败', cls: 'kx-badge-failed' };
    default:
      return { label: '待上传', cls: 'kx-badge-pending' };
  }
}

function sourceLabel(source: string): string {
  if (source === 'cli') return 'CLI';
  if (source === 'obsidian') return 'Obsidian';
  if (source === 'unknown') return '未知';
  return source;
}

/** 「待上传」Tab 收纳 pending + failed（失败靠红色徽章区分，不单开 Tab）。 */
function inTab(status: DraftStatus, tab: Tab): boolean {
  if (tab === 'all') return true;
  if (tab === 'pending') return status === 'pending' || status === 'failed';
  return status === tab;
}

/** 弹窗应用：轮询 relay 更新角标；展开时渲染两栏草稿箱。 */
function PanelApp({ btnHost }: { btnHost: HTMLElement }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false); // 关窗时先播退场动画，动画播完才真正卸载
  const [items, setItems] = useState<DraftListItem[]>([]); // 全部 x-article 草稿（含已上传）
  const [conn, setConn] = useState<ConnState>('down');
  const [connErr, setConnErr] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spin, setSpin] = useState(0); // 刷新按钮累计旋转角度
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [relayAddr, setRelayAddr] = useState('');
  const clientRef = useRef<HttpRelayClient | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_FALLBACK);
  const [, setClientReady] = useState(false); // clientRef 就绪后触发一次重渲，让缓存 hook 拿到 client

  const bundles = useBundleCache(clientRef.current);
  const assetUrls = useAssetUrls(clientRef.current);

  /** 拉取全部草稿：更新角标、连接状态与列表。 */
  const refresh = useCallback(async () => {
    try {
      if (!clientRef.current) {
        clientRef.current = await getRelayClient();
        setClientReady(true);
      }
      await clientRef.current.health();
    } catch {
      setConn('down');
      setItems([]);
      return;
    }
    try {
      // 本面板只处理 X 文章草稿；其他 kind 留给别的消费方。
      const list = (await clientRef.current.listDrafts())
        .filter((d) => (d.kind ?? 'x-article') === 'x-article')
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      setItems(list);
      setConn('ok');
    } catch (err: any) {
      setConn('error');
      setConnErr(`拉取草稿失败：${err?.message ?? err}`);
    }
  }, []);

  // 常驻轮询（挂载期间有效；destroy 时 root 卸载会清掉定时器）。
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    void refresh();
    return () => window.clearInterval(timer);
  }, [refresh]);

  // 轮询后清掉已不存在草稿的缓存与 blob URL。
  useEffect(() => {
    const ids = new Set(items.map((d) => d.id));
    bundles.prune(ids);
    assetUrls.prune(ids);
  }, [items, bundles, assetUrls]);

  const close = useCallback(() => setClosing(true), []);

  // 退场动画播完再卸载弹窗、释放资源；期间重新打开（closing 归零）则取消卸载。
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setClosing(false);
      setOpen(false);
      setSelectedId(null);
      assetUrls.revokeAll(); // 关窗释放图片内存；bundle（纯 JSON）保留
    }, KX_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [closing, assetUrls]);

  // 展开时立即刷新一次，并监听 Esc 关闭 / ⌘K 聚焦搜索。
  useEffect(() => {
    if (!open) return;
    void refresh();
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    return () => document.removeEventListener('keydown', onKeydown, true);
  }, [open, refresh, close]);

  useEffect(() => {
    void getSettings().then((s) => setRelayAddr(s.relayBase.replace(/^https?:\/\//, '')));
  }, []);

  // 每页条数跟随列表区实际高度：首行实测高度（含边框）算出装得下几行。
  // 行高恒定、容器高度由布局决定（flex:1），所以测量收敛、不会与分页互相触发。
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const rowH = el.querySelector<HTMLElement>('.kx-drow')?.getBoundingClientRect().height || ROW_H_FALLBACK;
      setPageSize(Math.max(1, Math.floor(el.clientHeight / rowH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, items]);

  /** 行的展示状态：上传中的本地阶段优先于轮询到的 relay 状态。 */
  const effStatus = useCallback(
    (d: DraftListItem): DraftStatus => (uploads[d.id]?.phase === 'uploading' ? 'uploading' : d.status),
    [uploads],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = { all: items.length, pending: 0, uploading: 0, done: 0 };
    for (const d of items) {
      const s = effStatus(d);
      if (s === 'pending' || s === 'failed') counts.pending++;
      else if (s === 'uploading') counts.uploading++;
      else counts.done++;
    }
    return counts;
  }, [items, effStatus]);

  const filtered = useMemo(() => {
    let list = items.filter((d) => inTab(effStatus(d), tab));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => (d.title || '').toLowerCase().includes(q));
    return list;
  }, [items, tab, query, effStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages); // 列表缩水时页码自动收敛
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selected = items.find((d) => d.id === selectedId) ?? null;
  const actionableCount = conn === 'ok' ? items.filter((d) => d.status !== 'done').length : 0;

  /** 上传流程与旧版完全一致：ack(uploading) → getDraft → uploadDraft → ack(done) → 跳编辑页。 */
  const doUpload = useCallback(
    async (id: string) => {
      const client = clientRef.current;
      if (!client) return;
      setUploads((u) => ({ ...u, [id]: { phase: 'uploading', message: '正在上传图片并创建草稿…' } }));
      try {
        await client.ack(id, { status: 'uploading' });
        const bundle = await client.getDraft(id);
        bundles.seed(bundle);
        const result = await uploadDraft(bundle, client);
        await client.ack(id, { status: 'done', restId: result.restId });

        const skipped = result.skippedImages.length ? `（跳过 ${result.skippedImages.length} 张图）` : '';
        if (result.restId) {
          setUploads((u) => ({ ...u, [id]: { phase: 'success', message: `已创建草稿${skipped}，正在打开…` } }));
          setTimeout(() => location.assign(`/compose/articles/edit/${result.restId}`), 600);
        } else {
          setUploads((u) => ({
            ...u,
            [id]: { phase: 'success', message: `已创建草稿${skipped}（未取到 rest_id，请到文章列表查看）。` },
          }));
          void refresh();
        }
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        await client.ack(id, { status: 'failed', error: msg }).catch(() => {});
        setUploads((u) => ({ ...u, [id]: { phase: 'error', message: `上传失败：${msg}` } }));
        void refresh();
      }
    },
    [bundles, refresh],
  );

  const doDelete = useCallback(
    async (id: string) => {
      const client = clientRef.current;
      if (!client) throw new Error('relay 未连接');
      await client.deleteDraft(id);
      setSelectedId(null);
      bundles.invalidate(id);
      assetUrls.revoke(id);
      void refresh();
    },
    [bundles, assetUrls, refresh],
  );

  /** 上传/更换封面：写回 relay（PUT /drafts/:id/cover），再失效缓存让封面预览与行缩略图刷新。 */
  const doSetCover = useCallback(
    async (id: string, file: File) => {
      const client = clientRef.current;
      if (!client) throw new Error('relay 未连接');
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) throw new Error('仅支持 PNG / JPEG / WebP / GIF 图片');
      if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await client.setCover(id, { fileName: file.name, mime: file.type, bytes });
      bundles.invalidate(id);
      assetUrls.revoke(id);
    },
    [bundles, assetUrls],
  );

  /** 列表行缩略图：只认封面（正文图不作替补），没封面显示文件占位图标。bundle/字节都是懒加载。 */
  const thumbFor = useCallback(
    (d: DraftListItem): string | undefined => {
      const cover = bundles.get(d.id)?.cover;
      return cover ? assetUrls.get(d.id, cover.fileName, cover.mime) : undefined;
    },
    [bundles, assetUrls],
  );

  const button = (
    <button
      className="kx-hdr-btn"
      type="button"
      title={`kaitox 草稿箱 · build ${__KX_BUILD__}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (open && !closing) {
          close();
        } else {
          setClosing(false); // 退场中途再点：取消卸载，直接留在打开态
          setOpen(true);
        }
      }}
    >
      {/* 我们自己的静态可信标记，内联 SVG 跟随文字色 */}
      <span className="kx-hdr-logo" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
      上传草稿
      {actionableCount ? <span className="kx-hdr-count">{actionableCount}</span> : null}
    </button>
  );

  return (
    <>
      {createPortal(button, btnHost)}
      {open && (
        <div className={closing ? 'kx-overlay kx-closing' : 'kx-overlay'} onMouseDown={close}>
          <div id="kaitox-modal" className="kx-modal" onMouseDown={(e) => e.stopPropagation()}>
            {/* --- 左栏：搜索 / Tab / 列表 / 分页 --- */}
            <div className="kx-left">
              <div className="kx-lhead">
                <h1 className="kx-ltitle">
                  <LogoIcon size={32} />
                  草稿箱
                </h1>
                <div className="kx-lhead-actions">
                  <span className={`kx-pill ${conn === 'ok' ? 'kx-pill-ok' : 'kx-pill-down'}`} title={relayAddr}>
                    <span className="kx-pill-dot" />
                    {conn === 'ok' ? '已连接' : '未连接'}
                  </span>
                  <button
                    className="kx-icon-btn38"
                    type="button"
                    title="刷新"
                    style={{ transform: `rotate(${spin}deg)` }}
                    onClick={() => {
                      setSpin((s) => s + 360);
                      void refresh();
                    }}
                  >
                    <RefreshIcon size={19} />
                  </button>
                  <button
                    className="kx-icon-btn38"
                    type="button"
                    title="设置"
                    onClick={() => {
                      close();
                      toggleSettingsPanel(true);
                    }}
                  >
                    <SlidersIcon size={19} />
                  </button>
                  <button className="kx-icon-btn38" type="button" title="关闭" onClick={close}>
                    <CloseIcon size={19} />
                  </button>
                </div>
              </div>

              <div className="kx-search">
                <SearchIcon className="kx-svg kx-search-ico" size={19} />
                <input
                  ref={searchRef}
                  value={query}
                  placeholder="搜索草稿标题..."
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(1);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <span className="kx-search-kbd">⌘K</span>
              </div>

              <div className="kx-tabs">
                {TAB_DEFS.map((t) => (
                  <div
                    key={t.key}
                    className={tab === t.key ? 'kx-tab kx-tab-on' : 'kx-tab'}
                    onClick={() => {
                      setTab(t.key);
                      setPage(1);
                    }}
                  >
                    {t.label} <span className="kx-tab-n">{tabCounts[t.key]}</span>
                    {tab === t.key && <span className="kx-tab-bar" />}
                  </div>
                ))}
              </div>

              <div className="kx-dlist" ref={listRef}>
                {conn !== 'ok' ? (
                  <div className="kx-list-empty kx-list-empty-err">
                    {conn === 'down' ? `${RELAY_DOWN_HINT}${relayAddr ? `（${relayAddr}）` : ''}` : connErr}
                  </div>
                ) : items.length === 0 ? (
                  <div className="kx-list-empty">暂无草稿。用 `kaitox x push` 或 Obsidian 同步一份过来。</div>
                ) : pageItems.length === 0 ? (
                  <div className="kx-list-empty">没有匹配的草稿</div>
                ) : (
                  pageItems.map((d) => (
                    <DraftListRow
                      key={d.id}
                      draft={d}
                      status={effStatus(d)}
                      summary={bundles.get(d.id) ? summarize(bundles.get(d.id)!.markdown).excerpt : ''}
                      thumbUrl={thumbFor(d)}
                      selected={d.id === selectedId}
                      onSelect={() => setSelectedId(d.id)}
                    />
                  ))
                )}
              </div>

              <div className="kx-lfoot">
                <span className="kx-lfoot-total">共 {filtered.length} 条</span>
                <div className="kx-pgs">
                  <button
                    className="kx-pg-nav"
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeftIcon size={16} />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      className={n === safePage ? 'kx-pg kx-pg-on' : 'kx-pg'}
                      type="button"
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    className="kx-pg-nav"
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    <ChevronRightIcon size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* --- 右栏：详情 --- */}
            <div className="kx-detail">
              {selected ? (
                <DetailView
                  key={selected.id}
                  draft={selected}
                  status={effStatus(selected)}
                  bundles={bundles}
                  assetUrls={assetUrls}
                  uploadState={uploads[selected.id]}
                  disabled={conn !== 'ok'}
                  onClose={() => setSelectedId(null)}
                  onUpload={() => void doUpload(selected.id)}
                  onDelete={() => doDelete(selected.id)}
                  onSetCover={(file) => doSetCover(selected.id, file)}
                />
              ) : (
                <div className="kx-detail-empty">
                  <FileIcon size={46} />
                  <div>选择一篇草稿查看详情</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface DraftListRowProps {
  draft: DraftListItem;
  status: DraftStatus;
  summary: string;
  thumbUrl?: string;
  selected: boolean;
  onSelect: () => void;
}

/** 列表行：缩略图 / 标题+摘要 / 状态徽章 / 相对时间。点击选中，操作都在详情面板。 */
function DraftListRow({ draft: d, status, summary, thumbUrl, selected, onSelect }: DraftListRowProps) {
  const badge = badgeFor(status);
  return (
    <div className={selected ? 'kx-drow kx-drow-sel' : 'kx-drow'} onClick={onSelect}>
      <div className="kx-thumb">{thumbUrl ? <img src={thumbUrl} alt="" /> : <FileIcon size={18} />}</div>
      <div className="kx-drow-main">
        <div className="kx-drow-title">{d.title || '(无标题)'}</div>
        <div className="kx-drow-sum">{summary || ' '}</div>
      </div>
      <span className={`kx-badge ${badge.cls}`}>{badge.label}</span>
      <div className="kx-dtime">{formatRelativeTime(d.createdAt)}</div>
    </div>
  );
}

interface DetailViewProps {
  draft: DraftListItem;
  status: DraftStatus;
  bundles: BundleCache;
  assetUrls: AssetUrls;
  uploadState?: UploadState;
  /** relay 断连时禁用全部操作。 */
  disabled: boolean;
  onClose: () => void;
  onUpload: () => void;
  onDelete: () => Promise<void>;
  onSetCover: (file: File) => Promise<void>;
}

type DeletePhase = 'idle' | 'confirm' | 'deleting';

/** 详情面板：顶栏图标（预览/删除/收起）+ 封面 + 统计卡 + Markdown 摘要 + 图片网格 + 上传/复制。
 *  以 key={draft.id} 渲染，切换草稿时内部确认态自动重置。 */
function DetailView({
  draft: d,
  status,
  bundles,
  assetUrls,
  uploadState,
  disabled,
  onClose,
  onUpload,
  onDelete,
  onSetCover,
}: DetailViewProps) {
  const [delPhase, setDelPhase] = useState<DeletePhase>('idle');
  const [delErr, setDelErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverErr, setCoverErr] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const bundle = bundles.get(d.id);
  const bundleFailed = !bundle && bundles.failed(d.id);
  const sum = bundle ? summarize(bundle.markdown) : null;
  const coverUrl = bundle?.cover ? assetUrls.get(d.id, bundle.cover.fileName, bundle.cover.mime) : undefined;
  const badge = badgeFor(status);
  const counts: StyleReport['counts'] | undefined = d.counts ?? bundle?.styleReport?.counts;
  const checkOk = !counts || (!counts.error && !counts.warning);
  // 与统计卡「通过」同口径：只列 error/warning，info 不打扰。
  const fmtIssues = (bundle?.styleReport?.issues ?? []).filter((i) => i.severity !== 'info');
  const uploading = uploadState?.phase === 'uploading';

  const doCopy = async () => {
    if (!bundle) return;
    try {
      await navigator.clipboard.writeText(bundle.markdown);
    } catch {
      // clipboard API 被拒时退回隐藏 textarea + execCommand
      const ta = document.createElement('textarea');
      ta.value = bundle.markdown;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const doDelete = async () => {
    setDelPhase('deleting');
    setDelErr('');
    try {
      await onDelete(); // 成功后父级清空选中，本组件随之卸载
    } catch (err: any) {
      setDelPhase('idle');
      setDelErr(`删除失败：${err?.message ?? err}`);
    }
  };

  /** 选图后先进 5:2 裁切弹窗（X 封面比例要求），确认裁切才真正上传。 */
  const onPickCover = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file || coverBusy) return;
    setCropFile(file);
  };

  const applyCover = async (file: File) => {
    setCoverBusy(true);
    setCoverErr('');
    try {
      await onSetCover(file);
    } catch (err: any) {
      setCoverErr(`封面上传失败：${err?.message ?? err}`);
    }
    setCoverBusy(false);
  };

  /** 裁切当前封面：字节从 assetUrls 的 blob URL 取回，送进裁切弹窗。
   *  剥掉 relay 存储加的 cover- 前缀，避免反复裁切后文件名叠前缀。 */
  const cropExistingCover = async () => {
    const cover = bundle?.cover;
    if (!cover || !coverUrl) return;
    try {
      const blob = await (await fetch(coverUrl)).blob();
      const name = cover.fileName.replace(/^cover-/, '');
      setCropFile(new File([blob], name, { type: cover.mime }));
    } catch (err: any) {
      setCoverErr(`封面读取失败：${err?.message ?? err}`);
    }
  };

  // 上传/删除/封面提示行：本地操作错误优先，其次 relay 记录的失败信息。
  let note: { text: string; kind: 'info' | 'ok' | 'error' } | null = null;
  if (coverErr) note = { text: coverErr, kind: 'error' };
  else if (delErr) note = { text: delErr, kind: 'error' };
  else if (uploadState) {
    note = {
      text: uploadState.message,
      kind: uploadState.phase === 'error' ? 'error' : uploadState.phase === 'success' ? 'ok' : 'info',
    };
  } else if (status === 'failed') {
    note = { text: `上一次上传失败${bundle?.error ? `：${bundle.error}` : ''}`, kind: 'error' };
  }

  return (
    <>
      <div className="kx-detail-top">
        {delPhase === 'confirm' ? (
          <div className="kx-del-confirm">
            <span>确认删除？</span>
            <button className="kx-btn-danger" type="button" onClick={() => void doDelete()}>
              删除
            </button>
            <button className="kx-btn-gray kx-btn-sm" type="button" onClick={() => setDelPhase('idle')}>
              取消
            </button>
          </div>
        ) : (
          <>
            <button
              className="kx-icon-btn34"
              type="button"
              title="预览"
              disabled={!bundle}
              onClick={() => setPreviewOpen(true)}
            >
              <EyeIcon size={18} />
            </button>
            <button
              className="kx-icon-btn34 kx-icon-danger"
              type="button"
              title={delPhase === 'deleting' ? '删除中…' : '删除草稿'}
              disabled={disabled || uploading || delPhase === 'deleting'}
              onClick={() => setDelPhase('confirm')}
            >
              <TrashIcon size={17} />
            </button>
          </>
        )}
        <button className="kx-icon-btn34" type="button" title="收起详情" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </div>

      <div className="kx-hero">
        {coverUrl && <img src={coverUrl} alt="" />}
        {bundle?.cover && <span className="kx-hero-chip">封面：{bundle.cover.fileName}</span>}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={onPickCover}
        />
        {/* 已上传（done）的草稿在 relay 侧已迁入 sent/ 只读，封面不可再改 */}
        {bundle && !bundle.cover && status !== 'done' && (
          <button
            className="kx-cover-add"
            type="button"
            disabled={disabled || coverBusy}
            onClick={() => coverInputRef.current?.click()}
          >
            <ImageIcon size={16} /> {coverBusy ? '上传中…' : '上传封面'}
          </button>
        )}
        {bundle?.cover && status !== 'done' && (
          <div className="kx-cover-btns">
            <button
              className="kx-cover-swap"
              type="button"
              disabled={disabled || coverBusy || !coverUrl}
              onClick={() => void cropExistingCover()}
            >
              裁切
            </button>
            <button
              className="kx-cover-swap"
              type="button"
              disabled={disabled || coverBusy}
              onClick={() => coverInputRef.current?.click()}
            >
              {coverBusy ? '上传中…' : '更换封面'}
            </button>
          </div>
        )}
      </div>

      <div className="kx-dhead">
        <h2 className="kx-dtitle">{d.title || '(无标题)'}</h2>
        <div className="kx-dmeta">
          <span className={`kx-badge ${badge.cls}`}>{badge.label}</span>
          <span>
            {d.mode === 'plaintext' ? '纯文本' : '富文本'} · {formatRelativeTime(d.createdAt)}
          </span>
        </div>
      </div>

      <div className="kx-stats">
        <div className="kx-stat">
          <div className="kx-stat-label">来源</div>
          <div className="kx-stat-value">{sourceLabel(d.source)}</div>
        </div>
        <div className="kx-stat">
          <div className="kx-stat-label">图片</div>
          <div className="kx-stat-value">{d.assetCount}</div>
        </div>
        <div className="kx-stat">
          <div className="kx-stat-label">格式检查</div>
          <div className={`kx-stat-value ${checkOk ? 'kx-stat-ok' : counts!.error ? 'kx-stat-err' : 'kx-stat-warn'}`}>
            {checkOk ? '通过' : `${counts!.error} 错 / ${counts!.warning} 警`}
          </div>
        </div>
      </div>

      {fmtIssues.length > 0 && (
        <>
          <div className="kx-sumlabel">格式检查 · {fmtIssues.length} 处</div>
          <div className="kx-fmt-list">
            {fmtIssues.map((it, i) => (
              <div key={i} className="kx-fmt-item">
                <span className={`kx-fmt-sev ${it.severity === 'error' ? 'kx-fmt-err' : 'kx-fmt-warn'}`}>
                  {it.severity === 'error' ? '错误' : '警告'}
                </span>
                <div className="kx-fmt-body">
                  <div className="kx-fmt-msg">
                    {it.line ? <span className="kx-fmt-line">L{it.line}</span> : null}
                    {it.message}
                  </div>
                  {it.suggestion && <div className="kx-fmt-sug">↳ {it.suggestion}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="kx-sumlabel">Markdown 摘要</div>
      <div className="kx-sumbox">
        {sum ? sum.excerpt || '（正文为空）' : bundleFailed ? '摘要加载失败，稍后自动重试。' : '加载中…'}
      </div>
      {sum && <div className="kx-sumcount">（共 {sum.charCount.toLocaleString()} 字）</div>}

      {d.assetCount > 0 && (
        <>
          <div className="kx-assets-label">
            图片 · {d.assetCount}
            {bundle?.cover && <span>（封面：{bundle.cover.fileName}）</span>}
          </div>
          <div className="kx-assets">
            {(bundle?.assets ?? []).map((a) => {
              const url = assetUrls.get(d.id, a.fileName, a.mime);
              return (
                <div key={a.key} className="kx-asset">
                  {url && <img src={url} alt="" />}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="kx-actions">
        {note && <div className={`kx-note kx-note-${note.kind}`}>{note.text}</div>}
        {(status === 'pending' || status === 'failed' || uploading) && (
          <button
            className="kx-btn-primary"
            type="button"
            disabled={disabled || uploading || delPhase === 'deleting'}
            onClick={onUpload}
          >
            {uploading ? '上传中…' : status === 'failed' ? '重试上传' : '上传草稿'}
          </button>
        )}
        <button className="kx-btn-gray" type="button" disabled={!bundle} onClick={() => void doCopy()}>
          {copied ? (
            <>
              已复制 <CheckIcon size={15} />
            </>
          ) : (
            '复制 Markdown'
          )}
        </button>
      </div>

      {previewOpen && bundle && (
        <PreviewModal draft={d} bundle={bundle} assetUrls={assetUrls} onClose={() => setPreviewOpen(false)} />
      )}

      {cropFile && (
        <CoverCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={(f) => {
            setCropFile(null);
            void applyCover(f);
          }}
        />
      )}
    </>
  );
}
