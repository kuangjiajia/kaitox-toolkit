/**
 * mermaid → image rendering (browser side).
 *
 * The framework-free half of mermaid support: given a mermaid instance (loaded by
 * the consumer — Chrome extension, Obsidian plugin, …), turn diagram source into a
 * standalone SVG blob URL (preview) or PNG bytes (upload). Pair with
 * `extractMermaidBlocks` (mermaid.ts) which produces the diagram sources.
 *
 * Sharing this here keeps every consumer's preview pixel-identical to what gets
 * published: same init config, same SVG normalization, same rasterization. The
 * mermaid library itself is heavy (~8MB) so it is injected rather than depended on —
 * each consumer lazy-loads it however its packaging allows and passes the instance in.
 *
 * Browser-only: needs DOM (`DOMParser`, `document`, `Image`, canvas). Node callers of
 * @kaitox/x-article can import the barrel freely — nothing here runs until called.
 */

/** Minimal shape of the mermaid instance the renderers need (mermaid's own type is assignable). */
export interface MermaidRenderer {
  render(id: string, code: string): Promise<{ svg: string }>;
}

/**
 * Shared mermaid init config — the source of truth for how diagrams look, so every
 * consumer renders identically (and identically to the published article).
 *
 *   - htmlLabels off: labels become plain SVG <text>; SVG containing foreignObject
 *     can taint the canvas / be rejected when rasterized, plain SVG is the safe path.
 *   - securityLevel 'strict': source comes from user markdown, no inline HTML/clicks.
 *   - default (light) theme: exported on a white background at 2x for crisp output.
 *
 * Pass to `mermaid.initialize()` once after loading the library.
 */
export const MERMAID_INIT_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  theme: 'default' as const,
  fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  flowchart: { htmlLabels: false },
  class: { htmlLabels: false },
};

const EXPORT_SCALE = 2;
const MAX_EXPORT_WIDTH = 1600;
const SVG_NS = 'http://www.w3.org/2000/svg';

let seq = 0;

/** Render to an SVG string. Syntax errors throw (with mermaid's error message). */
export async function renderMermaidSvg(mermaid: MermaidRenderer, code: string): Promise<string> {
  const { svg } = await mermaid.render(`kx-mmd-${++seq}`, code);
  return svg;
}

/** Render to an SVG blob URL (preview use; caller revokes). */
export async function renderMermaidSvgUrl(mermaid: MermaidRenderer, code: string): Promise<string> {
  const { xml } = await renderStandaloneSvg(mermaid, code);
  return URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
}

/** Render to PNG bytes (upload use). */
export async function renderMermaidPng(
  mermaid: MermaidRenderer,
  code: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { xml, w, h } = await renderStandaloneSvg(mermaid, code);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const scale = Math.min(EXPORT_SCALE, MAX_EXPORT_WIDTH / w);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('canvas 导出失败');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: 'image/png' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * mermaid's SVG → a standalone, taint-free rasterizable SVG document.
 *
 * mermaid outputs SVG meant to live inside an HTML DOM; rasterizing it directly has
 * three pitfalls, normalized here:
 *   1. HTML-only entities like &nbsp; are undefined in standalone XML, so <img> load
 *      fails outright → replaced with numeric entities, then validated via DOMParser;
 *   2. the root uses width="100%", so intrinsic size is unreliable when loaded
 *      standalone → width/height are pinned from the viewBox;
 *   3. flowchart edge labels emit <foreignObject> (inline HTML) even with
 *      htmlLabels:false; SVG containing foreignObject taints the canvas and toBlob is
 *      rejected in Chrome → foreignObject is downgraded to an equivalent SVG <text>.
 */
async function renderStandaloneSvg(
  mermaid: MermaidRenderer,
  code: string,
): Promise<{ xml: string; w: number; h: number }> {
  const svg = await renderMermaidSvg(mermaid, code);
  const cleaned = svg.replace(/&nbsp;/g, '&#160;').replace(/<br\s*>/gi, '<br/>');
  const doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`SVG 不是合法 XML：${err.textContent?.slice(0, 120) ?? '未知解析错误'}`);
  const root = doc.documentElement;

  for (const fo of Array.from(doc.getElementsByTagName('foreignObject'))) {
    replaceForeignObjectWithText(doc, fo);
  }

  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  let w = vb.length === 4 && vb[2] > 0 ? Math.ceil(vb[2]) : 0;
  let h = vb.length === 4 && vb[3] > 0 ? Math.ceil(vb[3]) : 0;
  if (!w || !h) {
    w = Math.ceil(parseFloat(root.getAttribute('width') ?? '')) || 800;
    h = Math.ceil(parseFloat(root.getAttribute('height') ?? '')) || 600;
  }
  root.setAttribute('width', String(w));
  root.setAttribute('height', String(h));
  root.removeAttribute('style'); // 去掉 max-width:100% 之类，避免干扰固有尺寸

  return { xml: new XMLSerializer().serializeToString(root), w, h };
}

/**
 * <foreignObject> (inline HTML labels) → SVG <text>: split into lines on <br> /
 * block elements, center the text in the original foreignObject box, and carry over
 * the nodeLabel/edgeLabel class so mermaid's embedded stylesheet keeps managing font
 * and color. The label background block is lost (export is white-background anyway).
 */
function replaceForeignObjectWithText(doc: Document, fo: Element): void {
  const w = parseFloat(fo.getAttribute('width') ?? '0') || 0;
  const h = parseFloat(fo.getAttribute('height') ?? '0') || 0;
  const lines = extractLines(fo);

  const text = doc.createElementNS(SVG_NS, 'text');
  const cls =
    fo.querySelector('.nodeLabel, .edgeLabel')?.getAttribute('class') ??
    fo.querySelector('[class]')?.getAttribute('class');
  if (cls) text.setAttribute('class', cls);
  text.setAttribute('x', String(w / 2));
  text.setAttribute('y', String(h / 2));
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');

  const LINE_EM = 1.2;
  lines.forEach((line, i) => {
    const tspan = doc.createElementNS(SVG_NS, 'tspan');
    tspan.setAttribute('x', String(w / 2));
    // 首行向上偏移半个总行高，使多行整体垂直居中
    tspan.setAttribute('dy', i === 0 ? `${(-(lines.length - 1) / 2) * LINE_EM}em` : `${LINE_EM}em`);
    tspan.textContent = line;
    text.appendChild(tspan);
  });

  fo.replaceWith(text);
}

/** foreignObject 内的 HTML → 文本行（<br> 与 p/div 边界换行）。 */
function extractLines(el: Element): string[] {
  const out: string[] = [''];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      out[out.length - 1] += n.textContent ?? '';
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const tag = (n as Element).tagName.toLowerCase();
      if (tag === 'br') {
        out.push('');
      } else {
        if ((tag === 'p' || tag === 'div') && out[out.length - 1].trim() !== '') out.push('');
        n.childNodes.forEach(walk);
      }
    }
  };
  el.childNodes.forEach(walk);
  const lines = out.map((s) => s.trim()).filter((s) => s !== '');
  return lines.length ? lines : [''];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('SVG 位图化失败'));
    img.src = url;
  });
}
