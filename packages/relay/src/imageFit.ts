/**
 * 图片体积适配：X 媒体上传（tweet_image）单张上限 5MB（5,242,880 字节），
 * 超限的 INIT 会被 400 拒掉（maxFileSizeExceeded）。在草稿入库时静默重编码，
 * 让落盘的图天然合规，下游（浏览器插件）无需感知：
 *   - 不透明图 → JPEG（白底、质量 90）；
 *   - 带透明图 → WebP（保留 alpha）；
 *   - 体积仍超限就按比例逐级缩小重编码；
 *   - GIF / SVG 等不重编码（会丢动画/矢量），限内图原样返回。
 * 任何一步失败都原样放行——体积适配绝不阻断入库。
 */
import sharp from 'sharp';

export const MAX_X_IMAGE_BYTES = 5_242_880;

const ENCODE_QUALITY = 90;
const SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2];
/** 只重编码这几类位图；其余格式原样放行。 */
const FITTABLE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 超过 X 上传上限的图片重编码到限内；限内 / 不可处理 / 处理失败的原样返回。 */
export async function fitImageBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (bytes.byteLength <= MAX_X_IMAGE_BYTES || !FITTABLE_MIMES.has(mime)) return { bytes, mime };
  try {
    const meta = await sharp(bytes).metadata();
    const width = meta.width ?? 0;
    if (!width) return { bytes, mime };
    // metadata.hasAlpha 只说明有 alpha 通道；stats.isOpaque 看实际像素，全不透明的 PNG 也能走 JPEG。
    const { isOpaque } = await sharp(bytes).stats();
    const targetMime = isOpaque ? 'image/jpeg' : 'image/webp';
    for (const scale of SCALE_STEPS) {
      const resized = sharp(bytes).resize(Math.max(1, Math.round(width * scale)));
      const out = isOpaque
        ? await resized.flatten({ background: '#ffffff' }).jpeg({ quality: ENCODE_QUALITY }).toBuffer()
        : await resized.webp({ quality: ENCODE_QUALITY }).toBuffer();
      if (out.byteLength <= MAX_X_IMAGE_BYTES) return { bytes: new Uint8Array(out), mime: targetMime };
    }
    return { bytes, mime };
  } catch {
    return { bytes, mime };
  }
}
