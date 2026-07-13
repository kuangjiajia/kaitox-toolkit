import type { DraftBundle, HttpRelayClient } from '@kaitox/relay-protocol';
import { uploadDraft, type UploadResult } from './uploader.js';

export interface RelayUploadFlowOptions {
  id: string;
  client: HttpRelayClient;
  onBundle?: (bundle: DraftBundle) => void;
  onProgress?: (message: string) => void;
}

export function uploadErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shared relay lifecycle for both manual and auto upload. */
export async function runRelayUploadFlow({
  id,
  client,
  onBundle,
  onProgress,
}: RelayUploadFlowOptions): Promise<UploadResult> {
  try {
    onProgress?.('正在准备上传…');
    await client.ack(id, { status: 'uploading' });
    const bundle = await client.getDraft(id);
    onBundle?.(bundle);
    const result = await uploadDraft(bundle, client, onProgress);
    await client.ack(id, { status: 'done', restId: result.restId });
    return result;
  } catch (err) {
    const message = uploadErrorMessage(err);
    await client.ack(id, { status: 'failed', error: message }).catch(() => {});
    throw new Error(message);
  }
}
