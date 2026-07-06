/**
 * 上传流水线：把一份草稿包在 x.com 页面上下文里传成 X Article 草稿。
 *
 * 直接复用 @kaitox/x-article 的 publishXArticle，只替换两处：
 *   - fetchImage：从 relay 的 assets 端点取字节，而不是从网络下载 URL。
 *   - clientOptions：同源 fetch + credentials:'include'（页面已登录，自动带 cookie），
 *     并用解析出的 queryId。
 *
 * bundle.markdown 已由上传端按 mode 处理完（plaintext 已降级），这里无需再转换。
 */
import { publishXArticle } from '@kaitox/x-article';
import type { ImageFetcher, CoverFetcher } from '@kaitox/x-article';
import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';
import { readCt0, getSettings } from './xsession.js';

export interface UploadResult {
  restId?: string;
  skippedImages: string[];
}

export async function uploadDraft(draft: DraftBundle, client: HttpRelayClient): Promise<UploadResult> {
  const ct0 = readCt0();
  if (!ct0) throw new Error('读取不到 ct0——请确认当前已登录 x.com 再试。');
  const { queryId, coverQueryId } = await getSettings();

  const fetchImage: ImageFetcher = async (src: string) => {
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
    markdown: draft.markdown,
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
  });

  return { restId: result.restId, skippedImages: result.skippedImages };
}
