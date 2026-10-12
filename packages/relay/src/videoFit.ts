/**
 * Video format fitting at ingest, the video counterpart of imageFit.ts.
 *
 * X takes H.264 video (with AAC audio, if any) in MP4 or MOV. Anything else, such as
 * WebM, MKV, AVI, or an iPhone HEVC MOV, is converted to H.264/AAC MP4 with the
 * system ffmpeg before the bundle lands on disk, so the browser extension can upload
 * it unchanged:
 *   - already H.264 + AAC in MP4/MOV → stored as-is;
 *   - H.264 in another container, or with non-AAC audio → remuxed (video stream copied);
 *   - any other video codec → transcoded to H.264.
 * ffmpeg is optional: found via KAITOX_FFMPEG, PATH, or the usual Homebrew locations.
 * Without it, or on any failure, the bytes pass through unchanged — fitting never
 * blocks ingest (the extension then reports the video as skipped if X rejects it).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Containers X accepts as-is (when the codecs are right). */
const X_CONTAINERS = new Set(['video/mp4', 'video/quicktime']);

interface Tools {
  ffmpeg: string;
  ffprobe: string;
}

let foundTools: Tools | undefined;

/**
 * Locates ffmpeg + ffprobe; null when either is missing. Only a hit is cached, so
 * installing ffmpeg while the relay runs takes effect on the next video, no restart.
 */
async function findTools(): Promise<Tools | null> {
  if (foundTools) return foundTools;
  const candidates = [process.env.KAITOX_FFMPEG, 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const ffmpeg of candidates) {
    if (!ffmpeg) continue;
    // A bare name resolves through PATH; a path gets its sibling ffprobe (keeping .exe on Windows).
    const ffprobe = ffmpeg === basename(ffmpeg) ? 'ffprobe' : join(dirname(ffmpeg), `ffprobe${extname(ffmpeg)}`);
    try {
      await run(ffmpeg, ['-version']);
      await run(ffprobe, ['-version']);
      foundTools = { ffmpeg, ffprobe };
      return foundTools;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Codec of the first video and first audio stream, or null when ffprobe can't read the file. */
async function probe(ffprobe: string, input: string): Promise<{ video?: string; audio?: string } | null> {
  try {
    const { stdout } = await run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', input]);
    const streams: Array<{ codec_type?: string; codec_name?: string }> = JSON.parse(stdout).streams ?? [];
    return {
      video: streams.find((s) => s.codec_type === 'video')?.codec_name,
      audio: streams.find((s) => s.codec_type === 'audio')?.codec_name,
    };
  } catch {
    return null;
  }
}

/** Converts a video X can't take to H.264/AAC MP4; anything else is returned unchanged. */
export async function fitVideoBytes(
  bytes: Uint8Array,
  mime: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  if (!mime.startsWith('video/')) return { bytes, mime };
  const tools = await findTools();
  if (!tools) return { bytes, mime };
  const dir = await mkdtemp(join(tmpdir(), 'kaitox-video-'));
  try {
    const input = join(dir, 'input');
    await writeFile(input, bytes);
    const streams = await probe(tools.ffprobe, input);
    if (!streams?.video) return { bytes, mime };
    const videoOk = streams.video === 'h264';
    const audioOk = !streams.audio || streams.audio === 'aac';
    if (videoOk && audioOk && X_CONTAINERS.has(mime)) return { bytes, mime };

    const output = join(dir, 'output.mp4');
    const videoArgs = videoOk
      ? ['-c:v', 'copy']
      : // yuv420p + even dimensions: what H.264 players (and X) expect.
        ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
    const audioArgs = !streams.audio ? [] : audioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k'];
    await run(
      tools.ffmpeg,
      ['-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', ...videoArgs, ...audioArgs, '-movflags', '+faststart', output],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    return { bytes: new Uint8Array(await readFile(output)), mime: 'video/mp4' };
  } catch {
    return { bytes, mime };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
