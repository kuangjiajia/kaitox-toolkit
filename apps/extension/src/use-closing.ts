/**
 * 弹窗退场动画 hook：requestClose() 先置 closing（调用方据此加 .kx-closing
 * 播放退场动画），动画时长后才真正回调 onClosed 卸载。
 * 组件随 onClosed 一起卸载，closing 状态自然归零，无需手动重置。
 */
import { useCallback, useEffect, useState } from 'react';

/** 与 panel.css 里 kx-fade-out / kx-pop-out / kx-slide-out 的时长保持一致（略放宽）。 */
export const KX_CLOSE_MS = 160;

export function useClosing(onClosed: () => void, ms: number = KX_CLOSE_MS): {
  closing: boolean;
  requestClose: () => void;
} {
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClosed, ms);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed, ms]);

  return { closing, requestClose };
}
