/**
 * kaitox 入口：在 x.com「Articles」列表页的标题行里注入一个「上传草稿」按钮
 *（挨着「新建文章」铅笔按钮），点开是一个下拉的待上传草稿列表。
 *
 * 下拉面板用 position:fixed 挂在 body 上、按按钮位置对齐，避免被 X 的滚动容器裁切；
 * 注入的按钮在 X 重绘 header 后会被 content.ts 的观察器/轮询重新插回。
 */
import type { DraftListItem, HttpRelayClient } from '@kaitox/core';
import { getRelayClient } from './xsession.js';
import { uploadDraft } from './uploader.js';
import { LOGO_SVG } from './logo.js';

const BTN_ID = 'kaitox-hdr-btn';
const DROPDOWN_ID = 'kaitox-dropdown';
const POLL_MS = 5000;

/** esbuild define 注入的构建时间戳（按钮 title 可见，用于确认构建版本）。 */
declare const __KX_BUILD__: string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) node.className = cls;
  Object.assign(node, rest);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

export class Panel {
  private btnWrap: HTMLElement;
  private btn: HTMLButtonElement;
  private countBadge: HTMLElement;
  private dropdown: HTMLElement;
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private client: HttpRelayClient | null = null;
  private pollTimer: number | null = null;
  private open = false;
  private busy = new Set<string>();

  constructor() {
    // --- 注入到 header 的按钮 ---
    this.countBadge = el('span', { class: 'kx-hdr-count kx-hidden' });
    const logo = el('span', { class: 'kx-hdr-logo' });
    logo.innerHTML = LOGO_SVG; // 我们自己的静态可信标记，内联 SVG 跟随文字色
    this.btn = el(
      'button',
      { class: 'kx-hdr-btn', type: 'button', title: `kaitox 待上传草稿 · build ${__KX_BUILD__}` },
      [logo, '上传草稿', this.countBadge],
    );
    this.btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });
    this.btnWrap = el('div', { id: BTN_ID, class: 'kx-hdr-wrap' }, [this.btn]);

    // --- 下拉面板（fixed，挂 body）---
    this.statusEl = el('div', { class: 'kx-status' });
    this.listEl = el('div', { class: 'kx-list' });
    const closeBtn = el('button', { class: 'kx-icon-btn', title: '收起' }, ['×']);
    closeBtn.addEventListener('click', () => this.toggle(false));
    const refreshBtn = el('button', { class: 'kx-icon-btn', title: '刷新' }, ['⟳']);
    refreshBtn.addEventListener('click', () => this.refresh());
    const header = el('div', { class: 'kx-header' }, [
      el('span', { class: 'kx-title-main' }, ['kaitox 待上传草稿']),
      el('span', { class: 'kx-header-actions' }, [refreshBtn, closeBtn]),
    ]);
    this.dropdown = el('div', { id: DROPDOWN_ID, class: 'kx-panel kx-hidden' }, [header, this.statusEl, this.listEl]);
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

  /** 幂等挂载：把按钮插进 header（缺了才插），并确保下拉在 body 上。X 重绘后可反复调用。 */
  mount(): void {
    if (!this.btnWrap.isConnected) {
      const anchor = this.headerAnchor();
      if (anchor?.parentElement) anchor.parentElement.insertBefore(this.btnWrap, anchor);
    }
    if (!this.dropdown.isConnected) document.body.append(this.dropdown);
    if (this.btnWrap.isConnected && this.pollTimer == null) this.startPolling();
  }

  isMounted(): boolean {
    return this.btnWrap.isConnected;
  }

  destroy(): void {
    this.stopPolling();
    this.detachOutsideClose();
    window.removeEventListener('resize', this.reposition);
    window.removeEventListener('scroll', this.reposition, true);
    this.btnWrap.remove();
    this.dropdown.remove();
    this.open = false;
  }

  private toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.dropdown.classList.toggle('kx-hidden', !this.open);
    if (this.open) {
      this.reposition();
      this.refresh();
      window.addEventListener('resize', this.reposition);
      window.addEventListener('scroll', this.reposition, true);
      this.attachOutsideClose();
    } else {
      window.removeEventListener('resize', this.reposition);
      window.removeEventListener('scroll', this.reposition, true);
      this.detachOutsideClose();
    }
  }

  /** 下拉对齐到按钮正下方，右边缘对齐；越界则夹到视口内。 */
  private reposition = (): void => {
    if (!this.open) return;
    const r = this.btn.getBoundingClientRect();
    const width = 320;
    let left = r.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    this.dropdown.style.top = `${Math.round(r.bottom + 6)}px`;
    this.dropdown.style.left = `${Math.round(left)}px`;
  };

  private onDocClick = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (this.dropdown.contains(t) || this.btnWrap.contains(t)) return;
    this.toggle(false);
  };
  private attachOutsideClose(): void {
    document.addEventListener('mousedown', this.onDocClick, true);
  }
  private detachOutsideClose(): void {
    document.removeEventListener('mousedown', this.onDocClick, true);
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = window.setInterval(() => this.refresh(), POLL_MS);
    this.refresh();
  }
  private stopPolling(): void {
    if (this.pollTimer != null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** 拉取待上传草稿：更新按钮角标；展开时渲染列表。 */
  private async refresh(): Promise<void> {
    try {
      if (!this.client) this.client = await getRelayClient();
      await this.client.health();
    } catch {
      this.setCount(null);
      if (this.open) {
        this.setStatus('本地 relay 未运行。请在终端运行 `kaitox relay`（或 `kaitox push` 时会自动拉起）。', 'error');
        this.listEl.replaceChildren();
      }
      return;
    }
    try {
      const items = (await this.client!.listDrafts()).filter((d) => d.status !== 'done');
      this.setCount(items.length);
      if (this.open) this.render(items);
    } catch (err: any) {
      if (this.open) this.setStatus(`拉取草稿失败：${err?.message ?? err}`, 'error');
    }
  }

  private setCount(n: number | null): void {
    if (!n) {
      this.countBadge.classList.add('kx-hidden');
      this.countBadge.textContent = '';
    } else {
      this.countBadge.classList.remove('kx-hidden');
      this.countBadge.textContent = String(n);
    }
  }

  private setStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
    this.statusEl.textContent = text;
    this.statusEl.className = `kx-status kx-status-${kind}`;
  }

  private render(items: DraftListItem[]): void {
    if (!items.length) {
      this.setStatus('暂无待上传草稿。用 `kaitox push` 或 Obsidian 同步一份过来。', 'info');
      this.listEl.replaceChildren();
      return;
    }
    this.setStatus(`${items.length} 份待上传`, 'ok');
    this.listEl.replaceChildren(...items.map((d) => this.renderRow(d)));
  }

  private renderRow(d: DraftListItem): HTMLElement {
    const meta: string[] = [d.source, d.mode];
    if (d.counts && (d.counts.error || d.counts.warning)) {
      meta.push(`${d.counts.error}错/${d.counts.warning}警`);
    }
    const badge = d.mode === 'plaintext' ? el('span', { class: 'kx-badge kx-badge-plain' }, ['纯文本']) : el('span', { class: 'kx-badge' }, ['富文本']);

    const btn = el('button', { class: 'kx-upload-btn' }, [d.status === 'failed' ? '重试上传' : '上传草稿']);
    const statusLine = el('div', { class: 'kx-row-status' });
    if (d.status === 'failed') statusLine.textContent = '上一次上传失败';

    btn.addEventListener('click', () => this.doUpload(d, btn, statusLine));

    const delBtn = el('button', { class: 'kx-icon-btn kx-del-btn', title: '删除草稿' }, ['🗑']);
    const actions = el('div', { class: 'kx-row-actions' }, [btn, delBtn]);
    delBtn.addEventListener('click', () => this.confirmDelete(d, actions, statusLine));

    return el('div', { class: 'kx-row' }, [
      el('div', { class: 'kx-row-main' }, [
        el('div', { class: 'kx-row-title' }, [d.title || '(无标题)']),
        el('div', { class: 'kx-row-meta' }, [badge, ' ', meta.join(' · ')]),
        statusLine,
      ]),
      actions,
    ]);
  }

  /** 点删除后就地二次确认，避免误删。 */
  private confirmDelete(d: DraftListItem, actions: HTMLElement, statusLine: HTMLElement): void {
    statusLine.className = 'kx-row-status kx-row-status-info';
    statusLine.textContent = '确认删除这份草稿？';
    const yes = el('button', { class: 'kx-upload-btn kx-danger' }, ['删除']);
    const no = el('button', { class: 'kx-icon-btn', title: '取消' }, ['×']);
    yes.addEventListener('click', () => this.doDelete(d, actions));
    no.addEventListener('click', () => this.refresh());
    actions.replaceChildren(yes, no);
  }

  private async doDelete(d: DraftListItem, actions: HTMLElement): Promise<void> {
    actions.replaceChildren(el('span', { class: 'kx-row-status kx-row-status-info' }, ['删除中…']));
    try {
      await this.client!.deleteDraft(d.id);
    } catch (err: any) {
      await this.refresh();
      this.setStatus(`删除失败：${err?.message ?? err}`, 'error');
      return;
    }
    this.busy.delete(d.id);
    await this.refresh();
  }

  private async doUpload(d: DraftListItem, btn: HTMLButtonElement, statusLine: HTMLElement): Promise<void> {
    if (this.busy.has(d.id)) return;
    this.busy.add(d.id);
    btn.disabled = true;
    btn.textContent = '上传中…';
    statusLine.className = 'kx-row-status kx-row-status-info';
    statusLine.textContent = '正在上传图片并创建草稿…';
    try {
      const client = this.client!;
      await client.ack(d.id, { status: 'uploading' });
      const draft = await client.getDraft(d.id);
      const result = await uploadDraft(draft, client);
      await client.ack(d.id, { status: 'done', restId: result.restId });

      statusLine.className = 'kx-row-status kx-row-status-ok';
      const skipped = result.skippedImages.length ? `（跳过 ${result.skippedImages.length} 张图）` : '';
      statusLine.textContent = `已创建草稿${skipped}，正在打开…`;

      if (result.restId) {
        setTimeout(() => location.assign(`/compose/articles/edit/${result.restId}`), 600);
      } else {
        statusLine.textContent = `已创建草稿${skipped}（未取到 rest_id，请到文章列表查看）。`;
        this.refresh();
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      await this.client?.ack(d.id, { status: 'failed', error: msg }).catch(() => {});
      statusLine.className = 'kx-row-status kx-row-status-error';
      statusLine.textContent = `上传失败：${msg}`;
      btn.disabled = false;
      btn.textContent = '重试上传';
    } finally {
      this.busy.delete(d.id);
    }
  }
}
