/**
 * 「推送到草稿箱」。点击后直接把草稿（含封面与图片字节）POST 到本地 relay 队列，
 * 不再有二次确认弹窗；推送完成即展示成功态。Chrome 扩展随后在已登录的 x.com 会话里
 * 接力创建草稿。这里不做账号选择/服务端定时（架构不支持）。
 */
import { Modal, setIcon, type App } from 'obsidian';
import { toPlaintextMarkdown } from '@kaitox/x-article';
import type { DraftAssetInput, DraftKind, DraftMode, StyleReport } from '@kaitox/relay-protocol';
import type KaitoxPlugin from './main.js';
import { openXComposer } from './view.js';

export interface PushContext {
  kind: DraftKind;
  channelLabel: string;
  title: string;
  body: string;
  assets: DraftAssetInput[];
  cover?: DraftAssetInput;
  report?: StyleReport;
  unresolved: string[];
  notePath: string;
  vault: string;
}

export class PushModal extends Modal {
  // 跳过确认表单后不再暴露上传方式选择，沿用默认富文本。
  private mode: DraftMode = 'rich';

  constructor(
    app: App,
    private plugin: KaitoxPlugin,
    private ctx: PushContext,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass('kx-modal');
    // 直接推送，不再渲染确认表单。
    void this.doPush();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderPushing(): void {
    const { contentEl } = this;
    contentEl.empty();
    const box = contentEl.createDiv({ cls: 'kx-success' });
    const spin = box.createDiv({ cls: 'kx-success-check kx-success-check-pending' });
    const ic = spin.createSpan({ cls: 'kx-spin' });
    setIcon(ic, 'loader-2');
    box.createDiv({ cls: 'kx-success-title', text: '推送中…' });
    box.createDiv({ cls: 'kx-success-sub', text: '正在把草稿推送到本地 relay 队列' });
  }

  private async doPush(): Promise<void> {
    this.renderPushing();
    const markdown = this.mode === 'plaintext' ? toPlaintextMarkdown(this.ctx.body) : this.ctx.body;
    try {
      const client = this.plugin.makeClient();
      await client.health();
      await client.postDraft({
        kind: this.ctx.kind,
        title: this.ctx.title,
        markdown,
        mode: this.mode,
        source: 'obsidian',
        sourceMeta: { notePath: this.ctx.notePath, vault: this.ctx.vault },
        styleReport: this.ctx.report,
        assets: this.ctx.assets,
        cover: this.ctx.cover,
      });
      let pending = 1;
      try {
        const list = await client.listDrafts();
        pending = list.filter((d) => d.status === 'pending').length || 1;
      } catch {
        /* 列表失败不影响成功态 */
      }
      this.renderSuccess(pending);
      if (this.plugin.settings.openXAfterPush) openXComposer();
    } catch (e) {
      this.renderError(errMsg(e));
    }
  }

  private renderError(msg: string): void {
    const { contentEl } = this;
    contentEl.empty();
    const box = contentEl.createDiv({ cls: 'kx-success' });
    const check = box.createDiv({ cls: 'kx-success-check kx-success-check-error' });
    setIcon(check, 'alert-triangle');
    box.createDiv({ cls: 'kx-success-title', text: '推送失败' });
    box.createDiv({ cls: 'kx-success-sub', text: `${msg}。确认本地已运行 kaitox relay。` });

    const actions = box.createDiv({ cls: 'kx-modal-actions' });
    const cancel = actions.createEl('button', { cls: 'kx-ghost', text: '取消' });
    cancel.onclick = () => this.close();
    const retry = actions.createEl('button', { cls: 'kx-primary kx-grow', text: '重试' });
    retry.onclick = () => void this.doPush();
  }

  private renderSuccess(pending: number): void {
    const { contentEl } = this;
    contentEl.empty();
    const box = contentEl.createDiv({ cls: 'kx-success' });
    const check = box.createDiv({ cls: 'kx-success-check' });
    setIcon(check, 'check');
    box.createDiv({ cls: 'kx-success-title', text: '已推送到草稿箱' });
    box.createDiv({
      cls: 'kx-success-sub',
      text: '打开 X 文章编辑器，Kaitox 扩展会自动识别并在你已登录的账号下创建草稿',
    });
    if (this.ctx.unresolved.length) {
      box.createDiv({ cls: 'kx-success-warn', text: `⚠ ${this.ctx.unresolved.length} 个引用未解析，已跳过` });
    }
    box.createDiv({ cls: 'kx-success-queue', text: `队列中 · ${pending} 篇待发布` });

    const actions = box.createDiv({ cls: 'kx-modal-actions' });
    const done = actions.createEl('button', { cls: 'kx-ghost', text: '完成' });
    done.onclick = () => this.close();
    const open = actions.createEl('button', { cls: 'kx-primary kx-grow', text: '打开 X 编辑器' });
    const ic = open.createSpan({ cls: 'kx-ic' });
    setIcon(ic, 'external-link');
    open.onclick = () => {
      openXComposer();
      this.close();
    };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
