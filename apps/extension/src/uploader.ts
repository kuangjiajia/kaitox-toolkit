/**
 * 上传流水线：把一份草稿包在 x.com 页面上下文里传成 X Article 草稿。
 *
 * 直接复用 @kaitox/x-article 的 publishXArticle，只替换两处：
 *   - fetchImage：从 relay 的 assets 端点取字节，而不是从网络下载 URL。
 *   - clientOptions：同源 fetch + credentials:'include'（页面已登录，自动带 cookie），
 *     并用解析出的 queryId。
 *
 * bundle.markdown 已由上传端按 mode 处理完（plaintext 已降级），这里无需再转换；
 * 唯一的额外变换是 mermaid 围栏：默认渲染成 PNG 走图片通道（X 没有 mermaid 支持）。
 */
import { publishXArticle, extractMermaidBlocks } from '@kaitox/x-article';
import type { ImageFetcher, CoverFetcher } from '@kaitox/x-article';
import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';
import { readCt0, getSettings } from './xsession.js';
import { renderMermaidPng } from './mermaid-render.js';

export interface UploadResult {
  restId?: string;
  skippedImages: string[];
}

export async function uploadDraft(
  draft: DraftBundle,
  client: HttpRelayClient,
  onProgress?: (message: string) => void,
): Promise<UploadResult> {
  const ct0 = readCt0();
  if (!ct0) throw new Error('读取不到 ct0——请确认当前已登录 x.com 再试。');
  const { queryId, coverQueryId } = await getSettings();

  // mermaid 围栏 → 图片引用；先串行预渲染，语法错误在上传前就报清楚（不半途丢图）。
  const { markdown, blocks: mermaidBlocks } = extractMermaidBlocks(draft.markdown);
  const mermaidPngBySrc = new Map<string, { bytes: Uint8Array; mimeType: string }>();
  for (let i = 0; i < mermaidBlocks.length; i++) {
    onProgress?.(`正在渲染 mermaid 图 ${i + 1}/${mermaidBlocks.length}…`);
    try {
      mermaidPngBySrc.set(mermaidBlocks[i].src, await renderMermaidPng(mermaidBlocks[i].code));
    } catch (err: any) {
      throw new Error(`第 ${i + 1} 个 mermaid 图渲染失败：${err?.message ?? err}`);
    }
  }

  const fetchImage: ImageFetcher = async (src: string) => {
    const mermaidPng = mermaidPngBySrc.get(src);
    if (mermaidPng) return mermaidPng;
    const asset = draft.assets.find((a) => a.src === src);
    if (!asset) throw new Error(`草稿包内找不到图片资源：${src}`);
    const bytes = await client.getAsset(draft.id, asset.fileName);
    return { bytes, mimeType: asset.mime };
  };

  // 有封面才拉封面字节（在建草稿拿到 rest_id 后 publishXArticle 才会调用它）。
  const cover = draft.cover;
  const fetchCover: CoverFetcher | undefined = cover
    ? async () => ({ bytes: await client.getAsset(draft.id, cover.fileName), mimeType: cover.mime })
    : undefined;

  const result = await publishXArticle({
    markdown,
    title: draft.title,
    credentials: { bearerToken: '', csrfToken: ct0 },
    clientOptions: {
      fetchImpl: window.fetch.bind(window) as any,
      credentialsMode: 'include',
      articleDraftCreateQueryId: queryId,
      updateCoverMediaQueryId: coverQueryId,
    },
    fetchImage,
    fetchCover,
    // 各阶段映射成人话，实时刷新详情面板的提示行。
    onProgress: (p) => {
      if (p.stage === 'images') {
        if (p.total > 0) onProgress?.(`正在上传图片 ${p.done}/${p.total}…`);
      } else if (p.stage === 'draft') {
        onProgress?.('正在创建草稿…');
      } else {
        onProgress?.('正在设置封面…');
      }
    },
  });

  return { restId: result.restId, skippedImages: result.skippedImages };
}
