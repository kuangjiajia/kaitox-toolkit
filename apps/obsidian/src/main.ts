/**
 * kaitox Obsidian 插件：把当前笔记一键同步为 X Article 草稿。
 *
 * 流程：读笔记 → 解析 ![[wikilink]] 嵌入与相对/远程图片成字节 → styleCheck →
 * 不友好弹 modal（修改/纯文本/原样）→ 通过 requestUrl POST 到本地 relay。
 * 真正的上传由 Chrome 插件在 x.com 页面完成。
 */
import {
  Plugin,
  Notice,
  Modal,
  Setting,
  PluginSettingTab,
  TFile,
  requestUrl,
  type App,
} from 'obsidian';
import {
  checkMarkdownStyle,
  toPlaintextMarkdown,
  deriveTitle,
} from '@kaitox/x-article';
import type { AssetMeta } from '@kaitox/x-article';
import { HttpRelayClient } from '@kaitox/relay-protocol';
import type { DraftMode, StyleReport, DraftAssetInput } from '@kaitox/relay-protocol';

interface KaitoxSettings {
  relayBase: string;
  relayToken: string;
}
const DEFAULT_SETTINGS: KaitoxSettings = { relayBase: 'http://127.0.0.1:8765', relayToken: '' };

interface Resolved {
  title: string;
  body: string;
  assets: DraftAssetInput[];
  assetMap: Record<string, AssetMeta>;
  unresolved: string[];
  /** frontmatter cover: 解析出的封面图（可选）。 */
  cover?: DraftAssetInput;
}

export default class KaitoxPlugin extends Plugin {
  settings: KaitoxSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addRibbonIcon('paper-plane', 'kaitox：同步到 X 草稿', () => this.syncActiveNote());
    this.addCommand({
      id: 'kaitox-sync-x-article',
      name: '同步当前笔记为 X Article 草稿',
      callback: () => this.syncActiveNote(),
    });
    this.addSettingTab(new KaitoxSettingTab(this.app, this));
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private makeClient(): HttpRelayClient {
    const relayFetch = async (url: string, init: any = {}) => {
      const res = await requestUrl({
        url: String(url),
        method: init.method ?? 'GET',
        headers: init.headers,
        body: init.body,
        throw: false,
      });
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        async text() {
          return res.text;
        },
        async json() {
          return res.json;
        },
        async arrayBuffer() {
          return res.arrayBuffer;
        },
      };
    };
    return new HttpRelayClient(this.settings.relayBase, {
      fetchImpl: relayFetch as any,
      token: this.settings.relayToken || undefined,
    });
  }

  private async syncActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') {
      new Notice('kaitox：请先打开一个 Markdown 笔记。');
      return;
    }
    new Notice('kaitox：正在解析笔记与图片…');
    let resolved: Resolved;
    try {
      resolved = await this.resolveAndRewrite(file);
    } catch (e: any) {
      new Notice(`kaitox：解析失败——${e?.message ?? e}`);
      return;
    }
    const report = checkMarkdownStyle(resolved.body, { assetMap: resolved.assetMap });

    if (report.friendly) {
      await this.doUpload(file, resolved, report, 'rich');
      return;
    }
    new ReportModal(this.app, report, async (decision) => {
      if (decision === 'fix' || decision === 'cancel') {
        new Notice('kaitox：已取消。修改后再同步。');
        return;
      }
      await this.doUpload(file, resolved, report, decision === 'plaintext' ? 'plaintext' : 'rich');
    }).open();
  }

  private async doUpload(file: TFile, resolved: Resolved, report: StyleReport, mode: DraftMode): Promise<void> {
    // 纯文本模式在上传端一次性降级；图片 src 被 toPlaintextMarkdown 原样保留，assets 不变。
    const markdown = mode === 'plaintext' ? toPlaintextMarkdown(resolved.body) : resolved.body;
    try {
      const client = this.makeClient();
      await client.health();
      await client.postDraft({
        title: resolved.title,
        markdown,
        mode,
        source: 'obsidian',
        sourceMeta: { notePath: file.path, vault: this.app.vault.getName() },
        styleReport: report,
        assets: resolved.assets,
        cover: resolved.cover,
      });
      new Notice(`kaitox：已投递「${resolved.title}」。打开 x.com 文章页，在 kaitox 插件里点「上传草稿」。`, 8000);
      if (resolved.unresolved.length) {
        new Notice(`kaitox：⚠ ${resolved.unresolved.length} 张图片未解析，将被跳过。`);
      }
    } catch (e: any) {
      new Notice(`kaitox：投递失败——${e?.message ?? e}。确认本地已运行 kaitox relay。`, 8000);
    }
  }

  /** 读笔记、把嵌入/图片解析成字节、改写成标准 ![alt](fileName)。 */
  private async resolveAndRewrite(file: TFile): Promise<Resolved> {
    const raw = await this.app.vault.cachedRead(file);
    const { title: fmTitle, cover: fmCover, body } = parseFrontmatter(raw);

    const assets: DraftAssetInput[] = [];
    const assetMap: Record<string, AssetMeta> = {};
    const unresolved: string[] = [];
    const taken = new Set<string>();
    const byIdentity = new Map<string, string>(); // 解析出的文件身份 → 已分配 src（去重复引用）

    const addAsset = (bytes: Uint8Array, rawName: string, mime: string, identity: string): string => {
      const existing = byIdentity.get(identity);
      if (existing) return existing; // 同一文件被多次引用 → 复用一个资源，避免重复上传
      const fileName = safeFileName(rawName, taken);
      const src = fileName;
      assets.push({ key: `img-${assets.length}`, src, fileName, mime, bytes });
      assetMap[src] = { bytesLen: bytes.byteLength, mime, resolved: true };
      byIdentity.set(identity, src);
      return src;
    };

    // 1) ![[wikilink]] 嵌入
    let work = await replaceAsync(body, /!\[\[([^\]\n]+?)\]\]/g, async (whole, inner) => {
      const { link, alias } = splitWiki(inner);
      const tfile = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
      if (!tfile || !isImageExt(tfile.extension)) {
        unresolved.push(inner);
        return whole;
      }
      const bytes = new Uint8Array(await this.app.vault.readBinary(tfile));
      const src = addAsset(bytes, tfile.name, mimeOf(tfile.extension), tfile.path);
      return `![${alias ?? ''}](${src})`;
    });

    // 2) 标准 ![alt](src)
    work = await replaceAsync(work, /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, async (whole, alt, src) => {
      if (assetMap[src]) return whole; // 已是我们改写过的资源
      try {
        if (/^https?:\/\//i.test(src)) {
          const r = await requestUrl({ url: src });
          const bytes = new Uint8Array(r.arrayBuffer);
          const mime = (r.headers['content-type'] || r.headers['Content-Type'] || '').split(';')[0] || mimeOf(extOf(src));
          const newSrc = addAsset(bytes, baseOf(src) || 'image', mime, src);
          return `![${alt}](${newSrc})`;
        }
        const dec = decodeURIComponent(src);
        const tfile = this.app.metadataCache.getFirstLinkpathDest(dec, file.path);
        if (!tfile) {
          unresolved.push(src);
          return whole;
        }
        const bytes = new Uint8Array(await this.app.vault.readBinary(tfile));
        const newSrc = addAsset(bytes, tfile.name, mimeOf(tfile.extension), tfile.path);
        return `![${alt}](${newSrc})`;
      } catch {
        unresolved.push(src);
        return whole;
      }
    });

    // frontmatter cover: 解析封面图（wikilink / 相对路径 / 远程 URL）。不进正文。
    let cover: DraftAssetInput | undefined;
    if (fmCover) {
      cover = (await this.resolveCover(fmCover, file, taken)) ?? undefined;
      if (!cover) unresolved.push(`cover: ${fmCover}`);
    }

    const title = fmTitle || deriveTitle(work) || file.basename;
    return { title, body: work, assets, assetMap, unresolved, cover };
  }

  /** 解析封面图为字节。支持 [[wikilink]]、相对路径、http(s) URL。失败返回 null。 */
  private async resolveCover(ref: string, file: TFile, taken: Set<string>): Promise<DraftAssetInput | null> {
    try {
      let bytes: Uint8Array;
      let mime: string;
      let rawName: string;
      if (/^https?:\/\//i.test(ref)) {
        const r = await requestUrl({ url: ref });
        bytes = new Uint8Array(r.arrayBuffer);
        mime = (r.headers['content-type'] || r.headers['Content-Type'] || '').split(';')[0] || mimeOf(extOf(ref));
        rawName = baseOf(ref) || 'cover';
      } else {
        const wiki = ref.match(/^!?\[\[([^\]]+?)\]\]$/);
        const link = wiki ? splitWiki(wiki[1]).link : ref;
        const tfile = this.app.metadataCache.getFirstLinkpathDest(link, file.path);
        if (!tfile || !isImageExt(tfile.extension)) return null;
        bytes = new Uint8Array(await this.app.vault.readBinary(tfile));
        mime = mimeOf(tfile.extension);
        rawName = tfile.name;
      }
      const fileName = safeFileName(`cover-${rawName}`, taken);
      return { key: 'cover', src: '__cover__', fileName, mime, bytes };
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Modal + 设置页
// ---------------------------------------------------------------------------

type Decision = 'fix' | 'plaintext' | 'upload' | 'cancel';

class ReportModal extends Modal {
  constructor(app: App, private report: StyleReport, private onDecide: (d: Decision) => void) {
    super(app);
  }
  private decided = false;

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: '推特友好度检查' });
    const c = this.report.counts;
    contentEl.createEl('p', { text: `${c.error} 错误 · ${c.warning} 警告 · ${c.info} 提示` });

    const ul = contentEl.createEl('ul');
    for (const i of this.report.issues) {
      const li = ul.createEl('li');
      li.createEl('strong', { text: `[${i.severity}] ` });
      li.appendText(i.message + (i.line ? ` (L${i.line})` : ''));
      if (i.suggestion) li.createEl('div', { text: '↳ ' + i.suggestion });
    }

    const btns = contentEl.createDiv({ cls: 'modal-button-container' });
    const mk = (label: string, val: Decision, cta = false) => {
      const b = btns.createEl('button', { text: label });
      if (cta) b.addClass('mod-cta');
      b.onclick = () => {
        this.decided = true;
        this.close();
        this.onDecide(val);
      };
    };
    mk('我去修改', 'fix', true);
    mk('纯文本兜底上传', 'plaintext');
    mk('原样上传', 'upload');
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.onDecide('cancel');
  }
}

class KaitoxSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: KaitoxPlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('relay 地址')
      .setDesc('本地 kaitox relay 的地址，一般是 http://127.0.0.1:8765')
      .addText((t) =>
        t
          .setValue(this.plugin.settings.relayBase)
          .onChange(async (v) => {
            this.plugin.settings.relayBase = v.trim() || DEFAULT_SETTINGS.relayBase;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName('relay token（可选）')
      .setDesc('如果你给 relay 配了 token，这里填一样的。')
      .addText((t) =>
        t.setValue(this.plugin.settings.relayToken).onChange(async (v) => {
          this.plugin.settings.relayToken = v.trim();
          await this.plugin.saveSettings();
        }),
      );
  }
}

// ---------------------------------------------------------------------------
// 纯工具（不依赖 node:path，浏览器环境安全）
// ---------------------------------------------------------------------------

function parseFrontmatter(md: string): { title?: string; cover?: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: md };
  const yaml = m[1];
  const body = md.slice(m[0].length);
  const lines = yaml.split(/\r?\n/);
  const field = (name: string): string | undefined => {
    const line = lines.find((l) => new RegExp(`^${name}\\s*:`).test(l));
    if (!line) return undefined;
    return line.replace(new RegExp(`^${name}\\s*:`), '').trim().replace(/^["']|["']$/g, '') || undefined;
  };
  return { title: field('title'), cover: field('cover'), body };
}

async function replaceAsync(
  str: string,
  regex: RegExp,
  fn: (whole: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
  const matches = [...str.matchAll(regex)];
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += str.slice(last, m.index);
    out += await fn(m[0], ...m.slice(1));
    last = (m.index ?? 0) + m[0].length;
  }
  out += str.slice(last);
  return out;
}

function splitWiki(inner: string): { link: string; alias?: string } {
  let link = inner;
  let alias: string | undefined;
  const pipe = inner.indexOf('|');
  if (pipe >= 0) {
    link = inner.slice(0, pipe);
    alias = inner.slice(pipe + 1).trim();
  }
  const hash = link.indexOf('#');
  if (hash >= 0) link = link.slice(0, hash);
  return { link: link.trim(), alias };
}

function baseOf(p: string): string {
  return p.split('?')[0].split('#')[0].split('/').pop() || '';
}
function extOf(p: string): string {
  const b = baseOf(p);
  const dot = b.lastIndexOf('.');
  return dot >= 0 ? b.slice(dot + 1) : '';
}
function isImageExt(ext: string): boolean {
  return /^(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(ext.replace(/^\./, ''));
}
function mimeOf(ext: string): string {
  const e = ext.replace(/^\./, '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[e] ?? 'application/octet-stream';
}
function safeFileName(rawName: string, taken: Set<string>): string {
  let n = (rawName || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!/\.[a-z0-9]+$/i.test(n)) n += '.bin';
  let cand = n;
  let i = 1;
  while (taken.has(cand)) {
    const dot = n.lastIndexOf('.');
    cand = `${n.slice(0, dot)}-${i}${n.slice(dot)}`;
    i++;
  }
  taken.add(cand);
  return cand;
}
