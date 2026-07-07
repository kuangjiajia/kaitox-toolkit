/** 把 Markdown 剥成纯文本，供列表摘要与「共 N 字」统计。不追求完备解析，够展示即可。 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/^\s{0,3}```.*$/gm, ' ') // 代码围栏标记行（保留围栏内的文字，参与字数）
    .replace(/`([^`]*)`/g, '$1') // 行内码保留文字
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片整体去掉
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/<[^>]+>/g, ' ') // HTML 标签
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 标题 #
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, '') // 列表符
    .replace(/(\*\*|__|~~)|(?<![\w*_])([*_])(?=\S)|(?<=\S)([*_])(?![\w*_])/g, '') // 强调标记
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MarkdownSummary {
  excerpt: string;
  charCount: number;
}

/** 摘要（前 max 字符）+ 字数（剥离后的字符数）。 */
export function summarize(md: string, max = 100): MarkdownSummary {
  const text = stripMarkdown(md);
  return {
    excerpt: text.length > max ? `${text.slice(0, max)}…` : text,
    charCount: text.length,
  };
}
