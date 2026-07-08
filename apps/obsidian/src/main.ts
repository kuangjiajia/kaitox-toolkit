/**
 * Kaitox Obsidian 插件入口。
 *
 * 提供一块常驻「发布预览」面板：实时把当前笔记渲染成 X 文章的样子、跑样式检查、
 * 一键「推送到草稿箱」（POST 到本地 relay）。真正的发布由 Chrome 扩展在已登录的
 * x.com 会话里接力完成。
 */
import { Plugin, Notice, WorkspaceLeaf, requestUrl } from 'obsidian';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import { KaitoxView, VIEW_TYPE_KAITOX } from './view.js';
import { PushModal } from './pushModal.js';
import { resolveActiveNote, type Resolved } from './resolve.js';
import { KaitoxSettingTab, DEFAULT_SETTINGS, type KaitoxSettings } from './settings.js';

export default class KaitoxPlugin extends Plugin {
  settings: KaitoxSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_KAITOX, (leaf) => new KaitoxView(leaf, this));

    this.addRibbonIcon('send', 'Kaitox：发布预览', () => void this.activateView());

    this.addCommand({
      id: 'kaitox-open-panel',
      name: '打开发布预览面板',
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: 'kaitox-push-active-note',
      name: '推送当前笔记到草稿箱',
      callback: () => void this.pushActiveNote(),
    });

    this.addSettingTab(new KaitoxSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 打开（或聚焦）右侧的发布预览面板。 */
  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_KAITOX)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_KAITOX, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  /** 命令：不经面板，直接解析当前笔记并打开推送弹窗。 */
  private async pushActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      new Notice('Kaitox：请先打开一篇 Markdown 笔记。');
      return;
    }
    let resolved: Resolved;
    try {
      resolved = await resolveActiveNote(this.app, file);
    } catch (e) {
      new Notice(`Kaitox：解析失败——${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    new PushModal(this.app, this, {
      kind: 'x-article',
      channelLabel: 'X 文章',
      title: resolved.title,
      body: resolved.body,
      assets: resolved.assets,
      cover: resolved.cover,
      unresolved: resolved.unresolved,
      notePath: file.path,
      vault: this.app.vault.getName(),
    }).open();
  }

  /** 构造一个走 Obsidian requestUrl 的 relay 客户端（绕过 CORS/证书限制）。 */
  makeClient(): HttpRelayClient {
    const relayFetch = async (url: string, init: any = {}) => {
      const res = await requestUrl({
        url: String(url),
        method: init.method ?? 'GET',
        headers: init.headers,
        body: init.body,
        throw: false,
      });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        async text() {
          return res.text;
        },
        async json() {
          return res.json;
        },
        async arrayBuffer() {
          return res.arrayBuffer;
        },
      };
    };
    return new HttpRelayClient(this.settings.relayBase, {
      fetchImpl: relayFetch as any,
      token: this.settings.relayToken || undefined,
    });
  }
}
