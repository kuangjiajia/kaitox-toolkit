/** Kaitox 插件设置：relay 连接 + 推送后行为。原生 Obsidian 设置页。 */
import { PluginSettingTab, Setting, type App } from 'obsidian';
import { DEFAULT_RELAY_BASE } from '@kaitox/relay-protocol';
import type KaitoxPlugin from './main.js';

export interface KaitoxSettings {
  relayBase: string;
  relayToken: string;
  /** 推送成功后自动打开 x.com 文章编辑器（扩展会在那里接力创建草稿）。 */
  openXAfterPush: boolean;
}

export const DEFAULT_SETTINGS: KaitoxSettings = {
  relayBase: DEFAULT_RELAY_BASE,
  relayToken: '',
  openXAfterPush: true,
};

/** x.com 文章编辑器地址——扩展在这里轮询本地队列并创建草稿。 */
export const X_ARTICLE_COMPOSE_URL = 'https://x.com/compose/articles';
export const X_ARTICLE_AUTO_UPLOAD_PARAM = 'kaitoxAutoUpload';
export const X_ARTICLE_DRAFT_ID_PARAM = 'kaitoxDraftId';

export function xArticleComposeUrl(draftId?: string): string {
  if (!draftId) return X_ARTICLE_COMPOSE_URL;
  const url = new URL(X_ARTICLE_COMPOSE_URL);
  url.searchParams.set(X_ARTICLE_AUTO_UPLOAD_PARAM, '1');
  url.searchParams.set(X_ARTICLE_DRAFT_ID_PARAM, draftId);
  return url.toString();
}

export class KaitoxSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KaitoxPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('连接').setHeading();

    new Setting(containerEl)
      .setName('relay 地址')
      .setDesc(`本地 Kaitox relay 的地址，一般是 ${DEFAULT_RELAY_BASE}`)
      .addText((t) =>
        t
          .setPlaceholder(DEFAULT_RELAY_BASE)
          .setValue(this.plugin.settings.relayBase)
          .onChange(async (v) => {
            this.plugin.settings.relayBase = v.trim() || DEFAULT_SETTINGS.relayBase;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('relay token（可选）')
      .setDesc('如果你给 relay 配了 token，这里填一样的。')
      .addText((t) =>
        t.setValue(this.plugin.settings.relayToken).onChange(async (v) => {
          this.plugin.settings.relayToken = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName('推送').setHeading();

    new Setting(containerEl)
      .setName('推送后打开 X 文章编辑器')
      .setDesc('推送到草稿箱后自动在浏览器打开 x.com/compose/articles，方便扩展接力创建草稿。')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openXAfterPush).onChange(async (v) => {
          this.plugin.settings.openXAfterPush = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
