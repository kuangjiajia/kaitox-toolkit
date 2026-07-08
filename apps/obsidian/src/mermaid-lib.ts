/**
 * mermaid 独立打包入口（dist/mermaid.js，CJS）。
 *
 * mermaid 全量内联约 8MB——不进 main.js（每次启动 Obsidian 都要解析）。这里单独出包，
 * mermaid.ts 在首次渲染时用 Node require 从插件目录懒加载（插件 isDesktopOnly，
 * require 可用）。
 */
import mermaid from 'mermaid';

export default mermaid;
