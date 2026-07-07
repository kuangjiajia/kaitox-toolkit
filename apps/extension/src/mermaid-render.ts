/**
 * mermaid → 图片渲染（浏览器内）。
 *
 * mermaid.js 渲染出 SVG，再经 <img> + canvas 转成 PNG 字节：
 *   - htmlLabels 关掉，标签走纯 SVG <text>——含 foreignObject 的 SVG 画进 canvas
 *     在部分场景会被拒/污染，纯 SVG 最稳。
 *   - securityLevel: 'strict'，源码来自用户 markdown，不放行内嵌 HTML/点击。
 *   - 白底导出（mermaid default 主题按浅色设计），2x 缩放保证清晰度。
 *
 * 上传与预览共用：上传要 PNG 字节（renderMermaidPng），预览用 SVG blob URL 即可
 * （renderMermaidSvgUrl，免走 canvas）。
 *
 * mermaid 本体（约 8MB）不进 content.js：单独打包为 dist/mermaid-lib.js
 *（web_accessible_resource），首次渲染时动态 import() 懒加载。
 */

type MermaidAPI = typeof import('mermaid').default;

const EXPORT_SCALE = 2;
const MAX_EXPORT_WIDTH = 1600;

let mermaidPromise: Promise<MermaidAPI> | null = null;
let seq = 0;

function loadMermaid(): Promise<MermaidAPI> {
  if (!mermaidPromise) {
    mermaidPromise = import(chrome.runtime.getURL('mermaid-lib.js')).then((m) => {
      const mermaid = m.default as MermaidAPI;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        flowchart: { htmlLabels: false },
        class: { htmlLabels: false },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

/** 渲染为 SVG 字符串。语法错误会抛出（带 mermaid 的报错信息）。 */
export async function renderMermaidSvg(code: string): Promise<string> {
  const mermaid = await loadMermaid();
  const { svg } = await mermaid.render(`kx-mmd-${++seq}`, code);
  return svg;
}

/** 渲染为 SVG blob URL（预览用；调用方负责 revoke）。 */
export async function renderMermaidSvgUrl(code: string): Promise<string> {
  const { xml } = await renderStandaloneSvg(code);
  return URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
}

/** 渲染为 PNG 字节（上传用）。 */
export async function renderMermaidPng(code: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { xml, w, h } = await renderStandaloneSvg(code);
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * mermaid 的 SVG → 可独立加载、可无污染光栅化的 SVG 文档。
 *
 * mermaid 输出面向「塞进 HTML DOM」，直接拿去光栅化有三个坑，这里统一规范化：
 *   1. &nbsp; 这类 HTML-only 实体在独立 XML 里未定义，<img> 加载直接解析失败
 *      → 换成数值实体后经 DOMParser 严格校验；
 *   2. 根节点 width="100%"，独立加载时固有尺寸不可靠 → 从 viewBox 写死宽高；
 *   3. flowchart 边标签无视 htmlLabels:false 仍产出 <foreignObject>（内嵌 HTML），
 *      Chrome 里含 foreignObject 的 SVG 画进 canvas 会污染画布、toBlob 被拒
 *      → 光栅化前把 foreignObject 降级成等价的 SVG <text>。
 */
async function renderStandaloneSvg(code: string): Promise<{ xml: string; w: number; h: number }> {
  const svg = await renderMermaidSvg(code);
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
 * <foreignObject>（内嵌 HTML 标签）→ SVG <text>：按 <br>/块级元素分行，
 * 文本居中放在原 foreignObject 的框内；把 nodeLabel/edgeLabel 类名搬过来，
 * 让 mermaid 内嵌样式表继续管字体和颜色。标签背景块会丢（导出本来就是白底）。
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
