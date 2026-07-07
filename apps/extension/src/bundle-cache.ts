/**
 * DraftBundle / 图片字节的懒加载缓存（草稿箱弹窗用）。
 *
 * DraftListItem 不含摘要与封面文件名，列表行与详情面板都需要 DraftBundle
 *（bundle 是纯 JSON，不带图片字节，getDraft 便宜）；图片字节按需走 getAsset，
 * 转成 blob URL 供 <img> 使用。两个 hook 内部用 useRef Map 存数据、版本号 state
 * 触发重渲；render 期间调用 get() 未命中会在后台发起拉取（去重），完成后自动重渲。
 * 拉取失败记 tombstone，RETRY_MS 内不重试，避免打爆 relay。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';

const RETRY_MS = 30_000;

export interface BundleCache {
  /** 命中返回 bundle；未命中返回 undefined 并在后台拉取（完成后触发重渲）。 */
  get(id: string): DraftBundle | undefined;
  /** 上次拉取失败且未到重试时间时为 true，供 UI 显示「加载失败」。 */
  failed(id: string): boolean;
  /** 直接喂入一份 bundle（如上传流程里刚 getDraft 过的）。 */
  seed(bundle: DraftBundle): void;
  invalidate(id: string): void;
  /** 轮询后清掉已不存在的草稿。 */
  prune(validIds: ReadonlySet<string>): void;
}

export function useBundleCache(client: HttpRelayClient | null): BundleCache {
  const bundles = useRef(new Map<string, DraftBundle>());
  const inflight = useRef(new Set<string>());
  const failedAt = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((v) => v + 1), []);

  const get = useCallback(
    (id: string): DraftBundle | undefined => {
      const hit = bundles.current.get(id);
      if (hit) return hit;
      if (!client || inflight.current.has(id)) return undefined;
      const failTs = failedAt.current.get(id);
      if (failTs !== undefined && Date.now() - failTs < RETRY_MS) return undefined;
      inflight.current.add(id);
      client
        .getDraft(id)
        .then(
          (b) => {
            bundles.current.set(id, b);
            failedAt.current.delete(id);
          },
          () => failedAt.current.set(id, Date.now()),
        )
        .finally(() => {
          inflight.current.delete(id);
          rerender();
        });
      return undefined;
    },
    [client, rerender],
  );

  const failed = useCallback((id: string) => {
    const ts = failedAt.current.get(id);
    return ts !== undefined && Date.now() - ts < RETRY_MS;
  }, []);

  const seed = useCallback((bundle: DraftBundle) => {
    bundles.current.set(bundle.id, bundle);
    failedAt.current.delete(bundle.id);
  }, []);

  const invalidate = useCallback((id: string) => {
    bundles.current.delete(id);
    failedAt.current.delete(id);
  }, []);

  const prune = useCallback((validIds: ReadonlySet<string>) => {
    for (const id of bundles.current.keys()) if (!validIds.has(id)) bundles.current.delete(id);
    for (const id of failedAt.current.keys()) if (!validIds.has(id)) failedAt.current.delete(id);
  }, []);

  return useMemo(() => ({ get, failed, seed, invalidate, prune }), [get, failed, seed, invalidate, prune]);
}

export interface AssetUrls {
  /** 命中返回 blob URL；未命中返回 undefined 并在后台拉字节（完成后触发重渲）。 */
  get(id: string, fileName: string, mime: string): string | undefined;
  /** 释放某份草稿的全部 blob URL。 */
  revoke(id: string): void;
  revokeAll(): void;
  prune(validIds: ReadonlySet<string>): void;
}

export function useAssetUrls(client: HttpRelayClient | null): AssetUrls {
  const urls = useRef(new Map<string, string>()); // key = `${id}/${fileName}`
  const inflight = useRef(new Set<string>());
  const failedAt = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((v) => v + 1), []);

  const get = useCallback(
    (id: string, fileName: string, mime: string): string | undefined => {
      const key = `${id}/${fileName}`;
      const hit = urls.current.get(key);
      if (hit) return hit;
      if (!client || inflight.current.has(key)) return undefined;
      const failTs = failedAt.current.get(key);
      if (failTs !== undefined && Date.now() - failTs < RETRY_MS) return undefined;
      inflight.current.add(key);
      client
        .getAsset(id, fileName)
        .then(
          (bytes) => {
            const old = urls.current.get(key);
            if (old) URL.revokeObjectURL(old);
            // TS 5.7 起 Uint8Array 带 ArrayBufferLike 泛型，与 BlobPart 不兼容，这里断言收窄
            urls.current.set(key, URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })));
            failedAt.current.delete(key);
            rerender();
          },
          () => failedAt.current.set(key, Date.now()),
        )
        .finally(() => inflight.current.delete(key));
      return undefined;
    },
    [client, rerender],
  );

  const revokeKeys = useCallback((match: (key: string) => boolean) => {
    for (const [key, url] of urls.current) {
      if (match(key)) {
        URL.revokeObjectURL(url);
        urls.current.delete(key);
      }
    }
  }, []);

  const revoke = useCallback((id: string) => revokeKeys((k) => k.startsWith(`${id}/`)), [revokeKeys]);
  const revokeAll = useCallback(() => revokeKeys(() => true), [revokeKeys]);
  const prune = useCallback(
    (validIds: ReadonlySet<string>) => {
      revokeKeys((k) => !validIds.has(k.slice(0, k.indexOf('/'))));
      for (const key of failedAt.current.keys()) {
        if (!validIds.has(key.slice(0, key.indexOf('/')))) failedAt.current.delete(key);
      }
    },
    [revokeKeys],
  );

  // 组件卸载（Panel.destroy）时兜底释放全部 URL。
  useEffect(() => revokeAll, [revokeAll]);

  return useMemo(() => ({ get, revoke, revokeAll, prune }), [get, revoke, revokeAll, prune]);
}
