/**
 * 草稿预览弹窗：近似 X Article 阅读页效果。
 *
 * 薄壳组件——正文 HTML 全部来自 @kaitox/x-article 的 renderPreviewHtml()
 *（与发布共用同一条 markdownToContentState 转换路径，预览即发布效果），
 * 配套排版样式在包自带的 preview.css（经 esbuild cp 进 dist、manifest 注入）。
 * 本文件只负责：弹窗骨架、键盘/遮罩交互、styleReport 警告条、图片 URL 解析。
 */
import { useEffect, useMemo, useState } from 'react';
import type { DraftBundle, DraftListItem } from '@kaitox/relay-protocol';
import { renderPreviewHtml, extractMermaidBlocks, MERMAID_SRC_PREFIX } from '@kaitox/x-article';
import { renderMermaidSvgUrl } from './mermaid-render.js';
import { CloseIcon } from './icons.js';
import type { AssetUrls } from './bundle-cache.js';
import { useClosing } from './use-closing.js';

interface PreviewModalProps {
  draft: DraftListItem;
  /** 调用方保证已加载（预览按钮在 bundle 就绪前是 disabled）。 */
  bundle: DraftBundle;
  assetUrls: AssetUrls;
  onClose: () => void;
}

export function PreviewModal({ draft, bundle, assetUrls, onClose }: PreviewModalProps) {
  // 关闭一律先播退场动画，动画播完 onClose 才真正卸载本组件。
  const { closing, requestClose } = useClosing(onClose);

  // Esc 只关预览、不关草稿箱：PanelApp 的 Esc 监听挂在 document 的 capture 阶段
  //（panel.tsx），同节点同阶段按注册顺序触发、抢不到先手；而事件传播必经
  // window → document，window 的 capture 一定先于 document 触发，
  // 所以挂 window capture + stopPropagation 才能拦在 PanelApp 前面。
  // 顺带吞掉 ⌘/Ctrl+K，防止 PanelApp 聚焦被预览遮住的搜索框。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [requestClose]);

  // 与上传同一变换：mermaid 围栏 → 图片引用（预览即发布效果）。
  const { markdown, blocks: mermaidBlocks } = useMemo(
    () => extractMermaidBlocks(bundle.markdown),
    [bundle.markdown],
  );

  // mermaid 块异步渲染为 SVG blob URL；url 就绪逐个替换「加载中」占位。
  // null = 渲染失败（真实上传时会直接报错中断，预览里以缺图占位提示）。
  const [mermaidUrls, setMermaidUrls] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (mermaidBlocks.length === 0) return;
    let alive = true;
    const created: string[] = [];
    void (async () => {
      for (const b of mermaidBlocks) {
        try {
          const u = await renderMermaidSvgUrl(b.code);
          if (!alive) {
            URL.revokeObjectURL(u);
            return;
          }
          created.push(u);
          setMermaidUrls((m) => ({ ...m, [b.src]: u }));
        } catch {
          if (!alive) return;
          setMermaidUrls((m) => ({ ...m, [b.src]: null }));
        }
      }
    })();
    return () => {
      alive = false;
      for (const u of created) URL.revokeObjectURL(u);
      setMermaidUrls({});
    };
  }, [mermaidBlocks]);

  // 每次渲染直接重算（毫秒级）：blob URL 就绪时 useAssetUrls / mermaidUrls 触发重渲染，
  // 「加载中」占位自动换成图片。
  const html = renderPreviewHtml(markdown, {
    title: bundle.title,
    coverUrl: bundle.cover ? assetUrls.get(draft.id, bundle.cover.fileName, bundle.cover.mime) : undefined,
    resolveImage: (src) => {
      if (src.startsWith(MERMAID_SRC_PREFIX)) return mermaidUrls[src]; // undefined = 渲染中
      const asset = bundle.assets.find((a) => a.src === src);
      // 找不到资源 = 未随草稿包提供字节，上传时也会被跳过；undefined = 字节加载中。
      return asset ? assetUrls.get(draft.id, asset.fileName, asset.mime) : null;
    },
  });

  // 有 error/warning 时提示「预览即降级后效果」；info 级不打扰。
  const report = bundle.styleReport;
  const warnTotal = report ? report.counts.error + report.counts.warning : 0;
  const warnMsgs = warnTotal
    ? report!.issues.filter((i) => i.severity !== 'info').slice(0, 2).map((i) => i.message)
    : [];

  return (
    <div
      className={closing ? 'kx-overlay kx-prev-overlay kx-closing' : 'kx-overlay kx-prev-overlay'}
      onMouseDown={(e) => {
        e.stopPropagation(); // 别让 mousedown 冒到草稿箱遮罩把整个弹窗关掉
        requestClose();
      }}
    >
      <div className="kx-prev-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="kx-prev-top">
          <div className="kx-prev-caption">
            预览<span className="kx-prev-hint">近似 X Article 渲染效果</span>
          </div>
          <button className="kx-icon-btn34" type="button" title="关闭预览" onClick={requestClose}>
            <CloseIcon size={20} />
          </button>
        </div>
        <div className="kx-prev-scroll">
          {warnTotal > 0 && (
            <div className="kx-prev-warnbar">
              {warnMsgs.map((m, i) => (
                <div key={i}>{m}</div>
              ))}
              {warnTotal > warnMsgs.length && <div>等共 {warnTotal} 处格式提示。</div>}
              <div>以下预览即为降级后的实际效果。</div>
            </div>
          )}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
