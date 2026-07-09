/**
 * mermaid 渲染（Obsidian 侧薄壳）。
 *
 * 渲染逻辑与 init 配置全部来自 @kaitox/x-article 的 mermaidRender —— 与 Chrome 扩展
 * 共用同一套，保证预览出来的图与扩展/真正发布出去的逐像素一致。本文件只负责
 * Obsidian 特有的一件事：初始化 mermaid 本体。
 *
 * mermaid 本体（约 8MB）直接静态 import，随 esbuild 一起打进 main.js。社区版安装时
 * Obsidian 只会从 Release 下发 main.js/manifest.json/styles.css 三个文件，额外的
 * mermaid.js 不会被下发，所以必须内联。initialize() 延迟到首次渲染再做，避免拖慢
 * 插件加载。
 */

import mermaid from 'mermaid';
import {
  MERMAID_INIT_CONFIG,
  renderMermaidSvgUrl as renderSvgUrl,
  type MermaidRenderer,
} from '@kaitox/x-article';

interface MermaidModule extends MermaidRenderer {
  initialize(config: unknown): void;
}

let initialized = false;

/** 首次渲染时初始化内联的 mermaid（只做一次）。 */
function ensureMermaid(): MermaidRenderer {
  const m = mermaid as unknown as MermaidModule;
  if (!initialized) {
    m.initialize(MERMAID_INIT_CONFIG);
    initialized = true;
  }
  return m;
}

/**
 * 渲染为 SVG blob URL（预览用；调用方负责 revoke）。
 */
export async function renderMermaidSvgUrl(code: string): Promise<string> {
  return renderSvgUrl(ensureMermaid(), code);
}
