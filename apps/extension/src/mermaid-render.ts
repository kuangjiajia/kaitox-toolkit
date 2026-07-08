/**
 * mermaid → 图片渲染（浏览器内，扩展侧薄壳）。
 *
 * 渲染逻辑（SVG 规范化、foreignObject 降级、光栅化、init 配置）全部来自
 * @kaitox/x-article 的 mermaidRender —— 与 Obsidian 插件共用同一套，保证预览/发布
 * 出来的图逐像素一致。本文件只负责扩展特有的一件事：懒加载 mermaid 本体。
 *
 * mermaid 本体（约 8MB）不进 content.js：单独打包为 dist/mermaid-lib.js
 * （web_accessible_resource），首次渲染时经 chrome.runtime.getURL 动态 import() 拉起。
 *
 * 上传与预览共用：上传要 PNG 字节（renderMermaidPng），预览用 SVG blob URL 即可
 * （renderMermaidSvgUrl，免走 canvas）。
 */

import {
  MERMAID_INIT_CONFIG,
  renderMermaidSvgUrl as renderSvgUrl,
  renderMermaidPng as renderPng,
} from '@kaitox/x-article';

type MermaidAPI = typeof import('mermaid').default;

let mermaidPromise: Promise<MermaidAPI> | null = null;

function loadMermaid(): Promise<MermaidAPI> {
  if (!mermaidPromise) {
    mermaidPromise = import(chrome.runtime.getURL('mermaid-lib.js')).then((m) => {
      const mermaid = m.default as MermaidAPI;
      mermaid.initialize(MERMAID_INIT_CONFIG);
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** 渲染为 SVG blob URL（预览用；调用方负责 revoke）。 */
export async function renderMermaidSvgUrl(code: string): Promise<string> {
  return renderSvgUrl(await loadMermaid(), code);
}

/** 渲染为 PNG 字节（上传用）。 */
export async function renderMermaidPng(code: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return renderPng(await loadMermaid(), code);
}
