/**
 * mermaid 独立打包入口（dist/mermaid-lib.js，ESM）。
 *
 * mermaid 全量内联约 8MB——content.js 注入在所有 x.com 页面上，不能让每次
 * 开推特都背着它解析执行。这里单独出包并登记为 web_accessible_resource，
 * mermaid-render.ts 在首次渲染时经 chrome.runtime.getURL 动态 import() 拉起。
 */
import mermaid from 'mermaid';

export default mermaid;
