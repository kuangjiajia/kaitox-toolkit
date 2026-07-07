/**
 * mermaid 代码块 → 图片引用的 markdown 变换。
 *
 * X Article 没有原生 mermaid 支持（原样上传只会变成一段代码原文），所以上传端的
 * 默认行为是：把顶层 ```mermaid 围栏替换成 `![...](mermaid://diagram-N)` 图片引用，
 * 渲染出的 PNG 走正常的图片上传通道。本文件只做纯文本变换（框架无关、Node 可测）；
 * 实际的 mermaid → 图片渲染需要浏览器 DOM，由消费方提供（Chrome 插件里是
 * mermaid.js 渲染 SVG 后经 canvas 转 PNG）。
 *
 * 注意：只处理「顶层」mermaid 围栏；嵌在引用/列表里的保持原样（仍按代码块降级）。
 */

import { marked } from 'marked';

/** 合成图片 src 的协议前缀；带此前缀的 src 一定来自本变换。 */
export const MERMAID_SRC_PREFIX = 'mermaid://';

export interface MermaidBlock {
  /** 合成的图片 src（mermaid://diagram-N），也是 fetchImage 收到的 key。 */
  src: string;
  /** 围栏内的 mermaid 源码（不含 ``` 行）。 */
  code: string;
}

export interface ExtractMermaidResult {
  /** 替换后的 markdown：每个顶层 mermaid 围栏变成一段图片引用。 */
  markdown: string;
  /** 提取出的 mermaid 块，按文档出现顺序。空数组 = 原文没有 mermaid。 */
  blocks: MermaidBlock[];
}

/** marked token 的宽松结构（与 contentState.ts 同一策略）。 */
interface MdToken {
  type: string;
  raw?: string;
  lang?: string;
  text?: string;
}

/**
 * 提取顶层 mermaid 围栏并替换为图片引用。
 * 顶层 token 的 raw 逐段拼接可精确还原原文，因此替换不会伤及其他内容。
 */
export function extractMermaidBlocks(markdown: string): ExtractMermaidResult {
  const tokens = marked.lexer(markdown) as unknown as MdToken[];
  const blocks: MermaidBlock[] = [];
  let out = '';
  for (const token of tokens) {
    const lang = (token.lang ?? '').trim().split(/\s+/)[0].toLowerCase();
    if (token.type === 'code' && lang === 'mermaid') {
      const src = `${MERMAID_SRC_PREFIX}diagram-${blocks.length + 1}`;
      blocks.push({ src, code: token.text ?? '' });
      // 独立成段，前后补空行，避免与相邻块粘连。
      out += `\n![mermaid diagram ${blocks.length}](${src})\n\n`;
    } else {
      out += token.raw ?? '';
    }
  }
  return blocks.length ? { markdown: out, blocks } : { markdown, blocks };
}
