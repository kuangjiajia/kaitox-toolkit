/** content script 入口：常驻整个 x.com（SPA 站内跳转不重载文档，必须全站注入），
 * 仅在 Articles 列表页的标题行注入 kaitox 按钮，并在 SPA 重绘后保活。 */
import { Panel } from './panel.js';
import { toggleSettingsPanel } from './settings-panel.js';
import { maybeStartAutoUploadFromUrl } from './auto-upload.js';

// esbuild define 注入的构建时间戳。页面控制台可看到当前生效的构建版本；
// 若与最近一次 npm run build:extension 的时间不符，说明插件/页面没重新加载。
declare const __KX_BUILD__: string;
console.log(`[kaitox] 插件已加载，构建于 ${__KX_BUILD__}`);

let panel: Panel | null = null;
let showButton = true; // 设置页开关（showUploadButton），默认开；变更实时生效。

function isArticlesPage(): boolean {
  return /^\/compose\/articles/.test(location.pathname);
}

/** 幂等：开关关闭或不在文章页则拆掉；否则确保 panel 存在并把按钮插进 header（缺了会补）。 */
function ensurePanel(): void {
  const articlesPage = isArticlesPage();
  if (articlesPage) maybeStartAutoUploadFromUrl();
  if (!showButton || !articlesPage) {
    panel?.destroy();
    panel = null;
    return;
  }
  if (!panel) panel = new Panel();
  panel.mount();
}

/** 读取开关初值并监听设置页的变更（relayBase 变了则重建 panel 让新地址生效）。 */
async function watchSettings(): Promise<void> {
  try {
    const stored = await chrome.storage.sync.get(['showUploadButton']);
    showButton = stored.showUploadButton !== false;
  } catch {
    /* storage 不可用时保持默认 */
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if ('showUploadButton' in changes) showButton = changes.showUploadButton.newValue !== false;
    if ('relayBase' in changes) {
      panel?.destroy();
      panel = null;
    }
    ensurePanel();
  });
  ensurePanel();
}

/** 包一层 history，使 x.com 的 SPA 跳转能触发我们的重挂载。 */
function patchHistory(onChange: () => void): void {
  const wrap = (fn: (...a: any[]) => any) =>
    function (this: History, ...args: any[]) {
      const ret = fn.apply(this, args as any);
      queueMicrotask(onChange);
      return ret;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener('popstate', onChange);
}

// X 会重绘整个 header/DOM，把我们注入的按钮冲掉——用 MutationObserver 快速补回，
// 加一个低频定时器兜底。ensurePanel 本身很轻（只在按钮缺失时才真正插入）。
let scheduled = false;
function scheduleEnsure(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensurePanel();
  });
}

// 点插件工具栏图标 → background 转发过来 → 开/关右侧设置浮窗。
chrome.runtime.onMessage.addListener((msg: any) => {
  if (msg?.type === 'kaitox-toggle-settings') toggleSettingsPanel();
});

void watchSettings();
patchHistory(ensurePanel);
new MutationObserver(scheduleEnsure).observe(document.body, { childList: true, subtree: true });
setInterval(ensurePanel, 3000);
