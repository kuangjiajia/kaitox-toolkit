/**
 * 按需注入的设置脚本：在非 x.com 文章页点工具栏图标时，由 background 用
 * chrome.scripting 注入到当前页（配合 activeTab），注入即打开右侧设置浮窗。
 * content.ts 已常驻的页面不会走到这里（background 先 sendMessage 成功就不注入）。
 */
import { toggleSettingsPanel } from './settings-panel.js';

declare global {
  interface Window {
    __kaitoxSettingsInjected?: boolean;
  }
}

if (!window.__kaitoxSettingsInjected) {
  window.__kaitoxSettingsInjected = true;
  chrome.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type === 'kaitox-toggle-settings') toggleSettingsPanel();
  });
}
toggleSettingsPanel(true);
