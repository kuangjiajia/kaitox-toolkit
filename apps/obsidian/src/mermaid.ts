/**
 * mermaid 渲染（Obsidian 侧薄壳）。
 *
 * 渲染逻辑与 init 配置全部来自 @kaitox/x-article 的 mermaidRender —— 与 Chrome 扩展
 * 共用同一套，保证预览出来的图与扩展/真正发布出去的逐像素一致。本文件只负责
 * Obsidian 特有的一件事：懒加载 mermaid 本体。
 *
 * mermaid 本体（约 8MB）单独打包为 dist/mermaid.js，不进 main.js（否则每次启动
 * Obsidian 都要解析）。插件 isDesktopOnly，运行时有 Electron 的 Node require——首次
 * 渲染时用绝对路径 require 进来，只加载一次。
 */

import {
  MERMAID_INIT_CONFIG,
  renderMermaidSvgUrl as renderSvgUrl,
  type MermaidRenderer,
} from '@kaitox/x-article';

interface MermaidModule extends MermaidRenderer {
  initialize(config: unknown): void;
}

let mermaidPromise: Promise<MermaidRenderer> | null = null;

/** 懒加载单独打包的 mermaid（dist/mermaid.js），初始化一次后缓存。 */
function loadMermaid(baseDir: string, relDir: string): Promise<MermaidRenderer> {
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const req = (window as unknown as { require: (id: string) => unknown }).require;
      const path = req('path') as { join: (...parts: string[]) => string };
      const mod = req(path.join(baseDir, relDir, 'mermaid.js')) as
        | MermaidModule
        | { default: MermaidModule };
      const mermaid = ('default' in mod ? mod.default : mod) as MermaidModule;
      mermaid.initialize(MERMAID_INIT_CONFIG);
      return mermaid;
    })();
  }
  return mermaidPromise;
}

/**
 * 渲染为 SVG blob URL（预览用；调用方负责 revoke）。
 * baseDir = vault 绝对路径，relDir = 插件目录（manifest.dir，vault 相对）。
 */
export async function renderMermaidSvgUrl(baseDir: string, relDir: string, code: string): Promise<string> {
  return renderSvgUrl(await loadMermaid(baseDir, relDir), code);
}
