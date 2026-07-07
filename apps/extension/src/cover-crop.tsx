/**
 * 封面裁切弹窗：X Article 封面要求 5:2 比例，选图后先在这里裁好再上传。
 *
 * 交互：固定 5:2 取景框，拖拽平移 + 滑杆缩放（最小缩放 = 恰好铺满取景框）；
 * 确认时用 canvas 按取景框重绘导出（JPEG/WebP 保持原格式，其余转 PNG——
 * 因此 GIF 裁切后会变成静态图）。无第三方依赖。
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CloseIcon } from './icons.js';
import { useClosing } from './use-closing.js';

/** X Article 封面宽高比。 */
const COVER_RATIO = 5 / 2;
/** 导出上限：过大的源图按此宽度重采样，X 端展示足够。 */
const MAX_OUT_WIDTH = 1600;
const MAX_ZOOM = 4;

interface CoverCropModalProps {
  /** 用户刚选中的原始图片文件。 */
  file: File;
  onCancel: () => void;
  /** 确认后拿到 5:2 成品（命名沿用原文件、扩展名跟随导出格式）；由父级关闭弹窗并上传。 */
  onConfirm: (file: File) => void;
}

export function CoverCropModal({ file, onCancel, onConfirm }: CoverCropModalProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(0);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [url, setUrl] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [scale, setScale] = useState(0);
  const [minScale, setMinScale] = useState(0);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ px: number; py: number; tx: number; ty: number } | null>(null);
  // 取消时先播退场动画再卸载；确认裁切走 onConfirm 直接切到上传流程，不播动画。
  const { closing, requestClose } = useClosing(onCancel);

  // 取景框高度跟随 CSS 的 aspect-ratio: 5/2，数学上直接按宽度换算。
  const viewH = viewW / COVER_RATIO;

  useLayoutEffect(() => {
    setViewW(viewRef.current?.clientWidth ?? 0);
  }, []);

  // object URL 要活到弹窗关闭：取景框 <img> 与 canvas 导出都引用它。
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setLoadErr('图片加载失败，请换一张试试。');
    el.src = u;
    return () => {
      URL.revokeObjectURL(u);
      setImg(null);
      setUrl('');
      setLoadErr('');
    };
  }, [file]);

  // 图片与取景框都就绪后初始化：恰好铺满、居中。
  useEffect(() => {
    if (!img || viewW <= 0) return;
    const s = Math.max(viewW / img.naturalWidth, viewH / img.naturalHeight);
    setMinScale(s);
    setScale(s);
    setTx((viewW - img.naturalWidth * s) / 2);
    setTy((viewH - img.naturalHeight * s) / 2);
  }, [img, viewW]);

  // Esc 只关裁切弹窗（window capture 抢在 PanelApp 的 document capture 之前），
  // 同时吞 ⌘/Ctrl+K，与 PreviewModal 同一套约定。
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

  /** 平移钳制：图片必须始终盖满取景框。 */
  const clampT = (v: number, view: number, imgLen: number) => Math.min(0, Math.max(view - imgLen, v));

  /** 缩放并保持取景框中心对准的图片点不动。 */
  const zoomTo = (next: number) => {
    if (!img || !minScale) return;
    const s = Math.min(Math.max(next, minScale), minScale * MAX_ZOOM);
    const cx = (viewW / 2 - tx) / scale;
    const cy = (viewH / 2 - ty) / scale;
    setScale(s);
    setTx(clampT(viewW / 2 - cx * s, viewW, img.naturalWidth * s));
    setTy(clampT(viewH / 2 - cy * s, viewH, img.naturalHeight * s));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { px: e.clientX, py: e.clientY, tx, ty };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !img) return;
    setTx(clampT(d.tx + (e.clientX - d.px), viewW, img.naturalWidth * scale));
    setTy(clampT(d.ty + (e.clientY - d.py), viewH, img.naturalHeight * scale));
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const doConfirm = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      // 取景框映射回原图坐标，裁切重绘。
      const sx = -tx / scale;
      const sy = -ty / scale;
      const sw = viewW / scale;
      const sh = viewH / scale;
      const outW = Math.min(Math.round(sw), MAX_OUT_WIDTH);
      const outH = Math.round(outW / COVER_RATIO);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      const mime = file.type === 'image/jpeg' || file.type === 'image/webp' ? file.type : 'image/png';
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, mime, 0.92));
      if (!blob) throw new Error('导出失败');
      const base = file.name.replace(/\.[^.]+$/, '') || 'cover';
      const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
      onConfirm(new File([blob], base + ext, { type: mime }));
    } catch (err: any) {
      setLoadErr(`裁切失败：${err?.message ?? err}`);
      setBusy(false);
    }
  };

  return (
    <div
      className={closing ? 'kx-overlay kx-crop-overlay kx-closing' : 'kx-overlay kx-crop-overlay'}
      onMouseDown={(e) => {
        e.stopPropagation(); // 别让 mousedown 冒到草稿箱遮罩把整个弹窗关掉
        requestClose();
      }}
    >
      <div className="kx-crop-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="kx-crop-top">
          <div className="kx-crop-title">
            裁切封面<span className="kx-crop-hint">X 封面固定 5:2 比例</span>
          </div>
          <button className="kx-icon-btn34" type="button" title="取消裁切" onClick={requestClose}>
            <CloseIcon size={20} />
          </button>
        </div>

        <div
          ref={viewRef}
          className={dragging ? 'kx-crop-view kx-crop-dragging' : 'kx-crop-view'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {img && url && (
            <img
              className="kx-crop-img"
              src={url}
              alt=""
              draggable={false}
              style={{ width: img.naturalWidth * scale, left: tx, top: ty }}
            />
          )}
          {loadErr && <div className="kx-crop-err">{loadErr}</div>}
          {!img && !loadErr && <div className="kx-crop-err">图片加载中…</div>}
        </div>

        <div className="kx-crop-zoom-row">
          <span>缩放</span>
          <input
            className="kx-crop-zoom"
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            disabled={!img}
            value={minScale ? scale / minScale : 1}
            onChange={(e) => zoomTo(minScale * parseFloat(e.target.value))}
          />
        </div>

        {file.type === 'image/gif' && <div className="kx-crop-note">GIF 裁切后将变为静态图片。</div>}

        <div className="kx-crop-actions">
          <button className="kx-btn-gray" type="button" onClick={requestClose}>
            取消
          </button>
          <button className="kx-btn-primary" type="button" disabled={!img || busy} onClick={() => void doConfirm()}>
            {busy ? '处理中…' : '确认裁切'}
          </button>
        </div>
      </div>
    </div>
  );
}
