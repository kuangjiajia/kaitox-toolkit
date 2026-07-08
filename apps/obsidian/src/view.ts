/**
 * Kaitox 发布预览面板（Obsidian ItemView）。
 *
 * 一块常驻侧栏/主区面板：顶部工具栏（发布渠道分段 · 设置 · relay 绿点 ·
 * 推送到草稿箱），下面实时把当前笔记渲染成 X 文章该有的样子。预览与推送共用同一份
 * resolveActiveNote 结果——所见即所得。样式检查在「推送到草稿箱」前的确认清单里跑。
 *
 * 真正的发布仍由 Chrome 扩展在已登录的 x.com 会话里完成；本面板只负责「推送到草稿箱」
 * （POST 到本地 relay 队列）。
 */
import { FileSystemAdapter, ItemView, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import { checkMarkdownStyle, renderPreviewHtml, extractMermaidBlocks, MERMAID_SRC_PREFIX } from '@kaitox/x-article';
import type { MermaidBlock } from '@kaitox/x-article';
import type { DraftKind, StyleReport } from '@kaitox/relay-protocol';
import type KaitoxPlugin from './main.js';
import { resolveActiveNote, bytesToBlobUrl, type Resolved } from './resolve.js';
import { renderMermaidSvgUrl } from './mermaid.js';
import { LOGO_WHITE } from './brand.js';
import { makeCoverAsset } from '@kaitox/x-article';
import type { DraftAssetInput } from '@kaitox/relay-protocol';
import { PushModal } from './pushModal.js';
import { X_ARTICLE_COMPOSE_URL } from './settings.js';

export const VIEW_TYPE_KAITOX = 'kaitox-publish-view';

/** 发布渠道注册表。X 已实现；微信占位，加引擎时把 enabled 置真即可（架构上 kind 命名空间化）。 */
interface Channel {
  id: string;
  label: string;
  kind: DraftKind;
  enabled: boolean;
}
const CHANNELS: Channel[] = [
  { id: 'x', label: 'X 文章', kind: 'x-article', enabled: true },
  { id: 'wechat', label: '微信公众号', kind: 'wechat', enabled: false },
];

export class KaitoxView extends ItemView {
  private plugin: KaitoxPlugin;
  private channelId = 'x';

  private currentFile: TFile | null = null;
  private resolved: Resolved | null = null;
  private report: StyleReport | null = null;

  /** src → 可显示的 blob URL（预览图片）。 */
  private imgUrlBySrc: Record<string, string> = {};
  private coverUrl?: string;
  private objectUrls: string[] = [];
  /** undefined = 用 frontmatter 封面；null = 用户移除了封面；对象 = 用户上传的封面。 */
  private coverOverride?: DraftAssetInput | null;

  // mermaid：与扩展一致，把 ```mermaid 围栏渲染成图（发布真值），而非当代码块。
  /** 提取 mermaid 后的正文（围栏 → mermaid:// 图片引用）；预览用它渲染。 */
  private previewMarkdown = '';
  private mermaidBlocks: MermaidBlock[] = [];
  /** mermaid src → SVG blob URL；缺键 = 渲染中，string = 就绪，null = 渲染失败。 */
  private mermaidUrls: Record<string, string | null> = {};
  private mermaidObjectUrls: string[] = [];
  /** 换笔记/换文件即自增，作废在途的 mermaid 异步渲染，避免旧图落到新预览上。 */
  private renderGen = 0;
  /** 正在渲染的代号（防同代重复起循环）；换代时新代照常启动、旧循环自行作废。 */
  private mermaidRenderingGen: number | null = null;
  /** 当前预览的正文容器（mermaid 就绪后就地重渲染这一块）。 */
  private articleHostEl: HTMLElement | null = null;

  private relayOnline = false;
  private healthTimer = 0;
  private refreshTimer = 0;
  private busy = false;

  // DOM refs
  private ctxEl!: HTMLElement;
  private dotEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private coverInput!: HTMLInputElement;

  constructor(leaf: WorkspaceLeaf, plugin: KaitoxPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_KAITOX;
  }
  getDisplayText(): string {
    return 'Kaitox 发布预览';
  }
  getIcon(): string {
    return 'drum';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('kx-view');
    this.buildChrome();

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRefresh()));
    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor, info) => {
        if (info?.file && info.file === this.currentFile) this.scheduleRefresh(500);
      }),
    );

    this.healthTimer = window.setInterval(() => void this.pingHealth(), 8000);
    this.registerInterval(this.healthTimer);
    void this.pingHealth();
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.renderGen++; // 作废在途 mermaid 渲染
    this.revokeUrls();
    this.revokeMermaidUrls();
    window.clearTimeout(this.refreshTimer);
  }

  // -------------------------------------------------------------------------
  // Chrome
  // -------------------------------------------------------------------------

  private buildChrome(): void {
    const root = this.contentEl;

    // hidden cover file input
    this.coverInput = root.createEl('input', {
      type: 'file',
      attr: { accept: 'image/*', style: 'display:none' },
    });
    this.coverInput.addEventListener('change', () => void this.onCoverFile());

    // toolbar
    const bar = root.createDiv({ cls: 'kx-toolbar' });

    const left = bar.createDiv({ cls: 'kx-toolbar-left' });
    // Logo: no brand-blue container. The white PNG is used as a CSS mask so the
    // mark takes the theme's text color — reads as white on dark themes, stays
    // visible on light ones.
    const logoMark = left
      .createDiv({ cls: 'kx-logo' })
      .createDiv({ cls: 'kx-logo-img', attr: { role: 'img', 'aria-label': 'Kaitox' } });
    logoMark.style.setProperty('-webkit-mask-image', `url("${LOGO_WHITE}")`);
    logoMark.style.setProperty('mask-image', `url("${LOGO_WHITE}")`);
    const seg = left.createDiv({ cls: 'kx-seg', attr: { title: '发布渠道' } });
    for (const ch of CHANNELS) {
      const b = seg.createEl('button', { cls: 'kx-seg-btn' });
      if (ch.id === this.channelId) b.addClass('is-on');
      if (!ch.enabled) {
        b.addClass('kx-soon');
        b.disabled = true;
        b.createSpan({ text: ch.label });
        b.createSpan({ cls: 'kx-soontag', text: 'soon' });
      } else {
        b.setText(ch.label);
        b.onclick = () => this.setChannel(ch.id);
      }
    }

    const right = bar.createDiv({ cls: 'kx-toolbar-right' });

    const push = right.createEl('button', { cls: 'kx-primary kx-push' });
    const pushIcon = push.createSpan({ cls: 'kx-ic' });
    setIcon(pushIcon, 'send');
    push.createSpan({ text: '推送到草稿箱' });
    push.onclick = () => this.openPush();

    const gear = right.createEl('button', { cls: 'kx-icon-btn', attr: { 'aria-label': '设置' } });
    setIcon(gear, 'settings');
    gear.onclick = () => this.openSettings();

    // relay status dot lives at the far right edge
    this.dotEl = right.createDiv({ cls: 'kx-dot is-off', attr: { title: 'relay 未连接' } });

    // context strip
    this.ctxEl = root.createDiv({ cls: 'kx-ctx' });

    // body
    this.bodyEl = root.createDiv({ cls: 'kx-body' });
  }

  // -------------------------------------------------------------------------
  // Data / refresh
  // -------------------------------------------------------------------------

  private scheduleRefresh(delay = 250): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    if (this.busy) {
      this.scheduleRefresh(200);
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      this.currentFile = null;
      this.resolved = null;
      this.report = null;
      this.resetMermaid('');
      this.setContext(null);
      this.renderEmpty();
      return;
    }
    if (file !== this.currentFile) {
      this.currentFile = file;
      this.coverOverride = undefined; // 换笔记时重置封面覆盖
    }
    this.busy = true;
    try {
      const resolved = await resolveActiveNote(this.app, file);
      this.resolved = resolved;
      this.report = checkMarkdownStyle(resolved.body, { assetMap: resolved.assetMap });
      this.rebuildUrls();
      this.resetMermaid(resolved.body);
      this.setContext(file);
      this.renderBody();
      this.maybeRenderMermaids();
    } catch (e) {
      this.resolved = null;
      this.report = null;
      this.resetMermaid('');
      this.renderError(errMsg(e));
    } finally {
      this.busy = false;
    }
  }

  /** 换文件/解析后重置 mermaid 状态：作废在途渲染、撤旧图、重新提取围栏。 */
  private resetMermaid(body: string): void {
    this.renderGen++;
    this.revokeMermaidUrls();
    this.mermaidUrls = {};
    this.articleHostEl = null;
    const { markdown, blocks } = extractMermaidBlocks(body);
    this.previewMarkdown = markdown;
    this.mermaidBlocks = blocks;
  }

  private revokeMermaidUrls(): void {
    for (const u of this.mermaidObjectUrls) URL.revokeObjectURL(u);
    this.mermaidObjectUrls = [];
  }

  /** 用当前 resolved 的字节重建 blob URL（先撤销旧的）。 */
  private rebuildUrls(): void {
    this.revokeUrls();
    this.imgUrlBySrc = {};
    if (!this.resolved) return;
    for (const a of this.resolved.assets) {
      const url = bytesToBlobUrl(a.bytes, a.mime);
      this.imgUrlBySrc[a.src] = url;
      this.objectUrls.push(url);
    }
    const cover = this.effectiveCover();
    if (cover) {
      this.coverUrl = bytesToBlobUrl(cover.bytes, cover.mime);
      this.objectUrls.push(this.coverUrl);
    } else {
      this.coverUrl = undefined;
    }
  }

  private revokeUrls(): void {
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls = [];
  }

  /** 生效封面：用户覆盖优先（null = 主动移除），否则用 frontmatter 解析出的。 */
  private effectiveCover(): DraftAssetInput | undefined {
    if (this.coverOverride !== undefined) return this.coverOverride ?? undefined;
    return this.resolved?.cover;
  }

  private setContext(file: TFile | null): void {
    this.ctxEl.empty();
    const icon = this.ctxEl.createSpan({ cls: 'kx-ic' });
    setIcon(icon, 'file-text');
    if (!file) {
      this.ctxEl.createSpan({ text: '未打开 Markdown 笔记' });
      return;
    }
    this.ctxEl.createSpan({ text: `正在预览 · ${file.name}` });
    const body = this.resolved?.body ?? '';
    const words = body.replace(/\s+/g, '').length;
    this.ctxEl.createSpan({ cls: 'kx-ctx-sep', text: '·' });
    this.ctxEl.createSpan({ text: `约 ${words.toLocaleString()} 字` });
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderBody(): void {
    if (!this.resolved) {
      this.renderEmpty();
      return;
    }
    this.bodyEl.empty();
    this.renderPreview();
  }

  private renderPreview(): void {
    const wrap = this.bodyEl.createDiv({ cls: 'kx-preview-wrap' });
    const card = wrap.createDiv({ cls: 'kx-card' });

    // cover hero
    const hero = card.createDiv({ cls: 'kx-cover-hero' });
    if (this.coverUrl) {
      hero.createEl('img', { cls: 'kx-cover-img', attr: { src: this.coverUrl, alt: '' } });
      const replace = hero.createEl('button', { cls: 'kx-cover-btn kx-cover-replace', text: '更换封面' });
      replace.onclick = () => this.coverInput.click();
      const remove = hero.createEl('button', { cls: 'kx-cover-btn kx-cover-remove', text: '移除封面' });
      remove.onclick = () => this.removeCover();
    } else {
      const add = hero.createEl('button', { cls: 'kx-cover-add' });
      const ic = add.createSpan({ cls: 'kx-ic' });
      setIcon(ic, 'image-plus');
      add.createSpan({ text: '上传封面' });
      add.onclick = () => this.coverInput.click();
    }

    // article (WYSIWYG X preview)
    const host = card.createDiv({ cls: 'kx-article-host' });
    this.articleHostEl = host;
    host.innerHTML = this.buildArticleHtml();
  }

  /** 正文 HTML：mermaid 提取后的 markdown + 图片/mermaid src 解析（与扩展预览一致）。 */
  private buildArticleHtml(): string {
    return renderPreviewHtml(this.previewMarkdown, {
      title: this.resolved?.title,
      resolveImage: (src) => {
        // mermaid：缺键=渲染中（加载中占位），string=就绪，null=渲染失败（跳过占位）。
        if (src.startsWith(MERMAID_SRC_PREFIX)) return this.mermaidUrls[src];
        // 普通图片：找不到=未打包（上传时跳过）。Obsidian 端字节已同步解析，无「加载中」态。
        return this.imgUrlBySrc[src] ?? null;
      },
    });
  }

  /** mermaid 就绪后就地重渲染正文（容器仍在文档里才动）。 */
  private refreshArticleHtml(): void {
    if (!this.articleHostEl?.isConnected) return;
    this.articleHostEl.innerHTML = this.buildArticleHtml();
  }

  /** 有未渲染的 mermaid 块时，异步渲染成图。 */
  private maybeRenderMermaids(): void {
    if (this.mermaidRenderingGen === this.renderGen) return; // 同代已有循环在跑
    if (this.mermaidBlocks.length === 0) return;
    if (this.mermaidBlocks.every((b) => b.src in this.mermaidUrls)) return;
    void this.renderMermaids(this.renderGen);
  }

  /**
   * 逐个把 mermaid 块渲染成 SVG blob URL，就绪一个就地换掉「加载中」占位。
   * gen 变了（换了笔记）就作废剩余渲染，撤掉已生成的 URL，避免旧图落到新预览。
   */
  private async renderMermaids(gen: number): Promise<void> {
    this.mermaidRenderingGen = gen;
    try {
      const base = this.pluginBaseDir();
      const relDir = this.plugin.manifest.dir ?? '';
      for (const b of this.mermaidBlocks) {
        if (b.src in this.mermaidUrls) continue;
        let url: string | null;
        try {
          url = await renderMermaidSvgUrl(base, relDir, b.code);
        } catch {
          url = null; // 渲染失败：与扩展一致，落成「上传时将被跳过」占位
        }
        if (gen !== this.renderGen) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        this.mermaidUrls[b.src] = url;
        if (url) this.mermaidObjectUrls.push(url);
        this.refreshArticleHtml();
      }
    } finally {
      // 仅清自己这一代；换代时新循环已接管，别把它的标记抹掉。
      if (this.mermaidRenderingGen === gen) this.mermaidRenderingGen = null;
    }
  }

  /** vault 绝对路径（desktop-only，一定是 FileSystemAdapter）。 */
  private pluginBaseDir(): string {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }

  private renderEmpty(): void {
    this.bodyEl.empty();
    const box = this.bodyEl.createDiv({ cls: 'kx-empty' });
    const ic = box.createSpan({ cls: 'kx-empty-ic' });
    setIcon(ic, 'file-text');
    box.createDiv({ cls: 'kx-empty-title', text: '打开一篇 Markdown 笔记' });
    box.createDiv({ cls: 'kx-empty-sub', text: '这里会实时预览它作为 X 文章的样子' });
  }

  private renderError(msg: string): void {
    this.bodyEl.empty();
    const box = this.bodyEl.createDiv({ cls: 'kx-empty' });
    const ic = box.createSpan({ cls: 'kx-empty-ic' });
    setIcon(ic, 'alert-triangle');
    box.createDiv({ cls: 'kx-empty-title', text: '解析失败' });
    box.createDiv({ cls: 'kx-empty-sub', text: msg });
  }

  // -------------------------------------------------------------------------
  // Interactions
  // -------------------------------------------------------------------------

  private setChannel(id: string): void {
    if (id === this.channelId) return;
    const ch = CHANNELS.find((c) => c.id === id);
    if (!ch || !ch.enabled) return;
    this.channelId = id;
    for (const b of Array.from(this.contentEl.querySelectorAll<HTMLButtonElement>('.kx-seg-btn'))) {
      b.toggleClass('is-on', (b.textContent ?? '').startsWith(ch.label));
    }
    void this.refresh();
  }

  private openSettings(): void {
    const setting = (this.app as any).setting;
    if (setting?.open) {
      setting.open();
      setting.openTabById?.(this.plugin.manifest.id);
    } else {
      new Notice('在「设置 → 第三方插件 → Kaitox」里配置。');
    }
  }

  private async onCoverFile(): Promise<void> {
    const f = this.coverInput.files?.[0];
    this.coverInput.value = '';
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const taken = new Set(this.resolved?.assets.map((a) => a.fileName) ?? []);
    this.coverOverride = makeCoverAsset(bytes, f.type || 'image/png', f.name || 'cover', taken);
    this.rebuildUrls();
    this.renderBody();
  }

  private removeCover(): void {
    this.coverOverride = null;
    this.rebuildUrls();
    this.renderBody();
  }

  private openPush(): void {
    if (!this.resolved || !this.currentFile) {
      new Notice('Kaitox：请先打开一篇 Markdown 笔记。');
      return;
    }
    const channel = CHANNELS.find((c) => c.id === this.channelId)!;
    new PushModal(this.app, this.plugin, {
      kind: channel.kind,
      channelLabel: channel.label,
      title: this.resolved.title,
      body: this.resolved.body,
      assets: this.resolved.assets,
      cover: this.effectiveCover(),
      report: this.report ?? undefined,
      unresolved: this.resolved.unresolved,
      notePath: this.currentFile.path,
      vault: this.app.vault.getName(),
    }).open();
  }

  // -------------------------------------------------------------------------
  // Health
  // -------------------------------------------------------------------------

  private async pingHealth(): Promise<void> {
    let ok = false;
    try {
      const res = await this.plugin.makeClient().health();
      ok = !!res?.ok;
    } catch {
      ok = false;
    }
    if (ok === this.relayOnline && this.dotEl.hasClass(ok ? 'is-on' : 'is-off')) return;
    this.relayOnline = ok;
    this.dotEl.toggleClass('is-on', ok);
    this.dotEl.toggleClass('is-off', !ok);
    this.dotEl.setAttr('title', ok ? 'relay 已连接' : 'relay 未连接');
  }
}

/** 打开 x.com 文章编辑器。 */
export function openXComposer(): void {
  window.open(X_ARTICLE_COMPOSE_URL, '_blank');
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
