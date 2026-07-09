/**
 * 「推送到草稿箱」。点击后：若样式检查有任何问题（含 info 提示）或未设置封面，先弹出
 * 一份确认清单，用户点「仍然推送」后再把草稿 POST 到本地 relay 队列；一切正常则直接推送。
 * 推送完成即展示成功态。Chrome 扩展随后在已登录的 x.com 会话里接力创建草稿。这里不做
 * 账号选择/服务端定时（架构不支持）。
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
    // 样式检查有问题或未设置封面时，先让用户过一遍确认清单；否则直接推送。
    if (this.needsConfirm()) this.renderConfirm();
    else void this.doPush();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  /** 是否需要推送前确认：样式检查有任何问题（含 info），或没有封面。 */
  private needsConfirm(): boolean {
    const hasIssues = (this.ctx.report?.issues.length ?? 0) > 0;
    const noCover = !this.ctx.cover;
    return hasIssues || noCover;
  }

  /** 推送前确认清单：逐条列出样式问题、缺封面、未解析引用，让用户确认后再推送。 */
  private renderConfirm(): void {
    const { contentEl } = this;
    contentEl.empty();
    const box = contentEl.createDiv({ cls: 'kx-confirm' });

    const head = box.createDiv({ cls: 'kx-confirm-head' });
    const hic = head.createSpan({ cls: 'kx-ic kx-confirm-ic' });
    setIcon(hic, 'alert-triangle');
    const htxt = head.createDiv();
    htxt.createDiv({ cls: 'kx-confirm-title', text: '推送前确认' });
    htxt.createDiv({
      cls: 'kx-confirm-sub',
      text: '这篇笔记有几处需要你留意，确认后再推送到草稿箱',
    });

    const scroll = box.createDiv({ cls: 'kx-confirm-body' });

    const c = this.ctx.report?.counts ?? { error: 0, warning: 0, info: 0 };
    const chips = scroll.createDiv({ cls: 'kx-chips' });
    if (!this.ctx.cover) chips.createSpan({ cls: 'kx-chip is-warn', text: '未设置封面' });
    if (c.error) chips.createSpan({ cls: 'kx-chip is-error', text: `${c.error} 处错误` });
    if (c.warning) chips.createSpan({ cls: 'kx-chip is-warn', text: `${c.warning} 处提示` });
    if (c.info) chips.createSpan({ cls: 'kx-chip is-info', text: `${c.info} 条信息` });

    const list = scroll.createDiv({ cls: 'kx-issues' });

    if (!this.ctx.cover) {
      const row = list.createDiv({ cls: 'kx-issue is-warning' });
      const ic = row.createSpan({ cls: 'kx-ic kx-issue-ic' });
      setIcon(ic, 'image-off');
      const txt = row.createDiv({ cls: 'kx-issue-txt' });
      txt.createDiv({ cls: 'kx-issue-msg', text: '未设置封面' });
      txt.createDiv({
        cls: 'kx-issue-meta',
        text: '没有封面也能推送，X 文章会用默认样式；可在预览面板顶部上传封面',
      });
    }

    for (const issue of this.ctx.report?.issues ?? []) {
      const sev = issue.severity; // error | warning | info
      const row = list.createDiv({ cls: `kx-issue is-${sev}` });
      const ic = row.createSpan({ cls: 'kx-ic kx-issue-ic' });
      setIcon(ic, sev === 'error' ? 'x-circle' : sev === 'warning' ? 'alert-triangle' : 'info');
      const txt = row.createDiv({ cls: 'kx-issue-txt' });
      txt.createDiv({ cls: 'kx-issue-msg', text: issue.message });
      const meta: string[] = [];
      if (issue.suggestion) meta.push(issue.suggestion);
      if (issue.line) meta.push(`第 ${issue.line} 行`);
      if (meta.length) txt.createDiv({ cls: 'kx-issue-meta', text: meta.join(' · ') });
    }

    if (this.ctx.unresolved.length) {
      const row = list.createDiv({ cls: 'kx-issue is-error' });
      const ic = row.createSpan({ cls: 'kx-ic kx-issue-ic' });
      setIcon(ic, 'image-off');
      const txt = row.createDiv({ cls: 'kx-issue-txt' });
      txt.createDiv({
        cls: 'kx-issue-msg',
        text: `${this.ctx.unresolved.length} 个引用解析不到，将被跳过`,
      });
      txt.createDiv({ cls: 'kx-issue-meta', text: this.ctx.unresolved.join(' · ') });
    }

    const actions = box.createDiv({ cls: 'kx-modal-actions' });
    const cancel = actions.createEl('button', { cls: 'kx-ghost', text: '返回修改' });
    cancel.onclick = () => this.close();
    const confirm = actions.createEl('button', { cls: 'kx-primary kx-grow', text: '仍然推送' });
    const cic = confirm.createSpan({ cls: 'kx-ic' });
    setIcon(cic, 'send');
    confirm.onclick = () => void this.doPush();
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
    box.createDiv({
      cls: 'kx-success-sub',
      text: `${msg}。若未安装，先 npm i -g @kaitox/cli，再执行 kaitox relay --daemon 后重试。`,
    });

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
