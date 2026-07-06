/** content script 入口：在 x.com Articles 列表页的标题行注入 kaitox 按钮，并在 SPA 重绘后保活。 */
import { Panel } from './panel.js';

// esbuild define 注入的构建时间戳。页面控制台可看到当前生效的构建版本；
// 若与最近一次 npm run build:extension 的时间不符，说明插件/页面没重新加载。
declare const __KX_BUILD__: string;
console.log(`[kaitox] 插件已加载，构建于 ${__KX_BUILD__}`);

let panel: Panel | null = null;

function isArticlesPage(): boolean {
  return /^\/compose\/articles/.test(location.pathname);
}

/** 幂等：不在文章页则拆掉；在的话确保 panel 存在并把按钮插进 header（缺了会补）。 */
function ensurePanel(): void {
  if (!isArticlesPage()) {
    panel?.destroy();
    panel = null;
    return;
  }
  if (!panel) panel = new Panel();
  panel.mount();
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

ensurePanel();
patchHistory(ensurePanel);
new MutationObserver(scheduleEnsure).observe(document.body, { childList: true, subtree: true });
setInterval(ensurePanel, 3000);
