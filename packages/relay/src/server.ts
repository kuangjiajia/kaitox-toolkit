/**
 * 本地 relay 的 HTTP 服务（零第三方依赖，纯 node:http）。
 *
 * 实现 @kaitox/core 里 RelayClient 的线上契约：
 *   GET    /health
 *   POST   /drafts                        （body: PostDraftWireBody）
 *   GET    /drafts
 *   GET    /drafts/:id
 *   GET    /drafts/:id/assets/:fileName    （回二进制）
 *   PATCH  /drafts/:id                     （body: { status, restId?, error? }）
 *   DELETE /drafts/:id
 *
 * CORS 只放行 x.com / twitter.com / chrome-extension:// / Obsidian（见 config.isAllowedOrigin）。
 * 若 ~/.kaitox/config.json 里配了 token，则非 OPTIONS 请求须带 x-kaitox-token。
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import type { PostDraftWireBody } from '@kaitox/core';
import {
  HOST,
  RELAY_VERSION,
  relayPort,
  kaitoxHome,
  pidPath,
  loadConfig,
  isAllowedOrigin,
} from './config.js';
import {
  saveDraft,
  listDrafts,
  getDraft,
  getAssetPath,
  patchDraft,
  deleteDraft,
} from './storage.js';

export interface RelayServerHandle {
  port: number;
  close(): Promise<void>;
}

/** 起 relay 服务，监听 127.0.0.1:port，写 pidfile。返回可 close 的句柄。 */
export async function startRelay(port = relayPort()): Promise<RelayServerHandle> {
  const { token } = await loadConfig();
  const server: Server = createServer((req, res) => {
    handle(req, res, token).catch((err) => {
      sendJson(req, res, 500, { error: String(err?.message ?? err) });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });

  // 先确保 ~/.kaitox 存在，否则 pidfile 写不进去（stop 会找不到）。
  await mkdir(kaitoxHome(), { recursive: true }).catch(() => {});
  await writeFile(pidPath(), String(process.pid), 'utf8').catch(() => {});

  return {
    port,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(pidPath(), { force: true }).catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin as string | undefined;
  if (isAllowedOrigin(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-kaitox-token');
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  setCors(req, res);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function handle(req: IncomingMessage, res: ServerResponse, token?: string): Promise<void> {
  const method = req.method ?? 'GET';

  // CORS 预检
  if (method === 'OPTIONS') {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const parts = url.pathname.split('/').filter(Boolean); // e.g. ['drafts', ':id', 'assets', ':name']

  // GET /health —— 仅存活探测，不校验 token（daemon 探活、status 都靠它）。
  if (method === 'GET' && parts.length === 1 && parts[0] === 'health') {
    sendJson(req, res, 200, { ok: true, version: RELAY_VERSION, port: relayPort() });
    return;
  }

  // token 校验（配置了才校验）
  if (token && req.headers['x-kaitox-token'] !== token) {
    sendJson(req, res, 401, { error: 'unauthorized' });
    return;
  }

  if (parts[0] === 'drafts') {
    // GET /drafts
    if (method === 'GET' && parts.length === 1) {
      sendJson(req, res, 200, await listDrafts());
      return;
    }
    // POST /drafts
    if (method === 'POST' && parts.length === 1) {
      const wire = JSON.parse(await readBody(req)) as PostDraftWireBody;
      const id = await saveDraft(wire);
      sendJson(req, res, 201, { id });
      return;
    }

    const id = parts[1] ? decodeURIComponent(parts[1]) : '';

    // GET /drafts/:id/assets/:fileName
    if (method === 'GET' && parts.length === 4 && parts[2] === 'assets') {
      const fileName = decodeURIComponent(parts[3]);
      let p: string | null;
      try {
        p = await getAssetPath(id, fileName);
      } catch {
        sendJson(req, res, 400, { error: '非法文件名' });
        return;
      }
      if (!p) {
        sendJson(req, res, 404, { error: 'asset not found' });
        return;
      }
      setCors(req, res);
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      createReadStream(p).pipe(res);
      return;
    }

    // GET /drafts/:id
    if (method === 'GET' && parts.length === 2) {
      const d = await getDraft(id);
      if (!d) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      sendJson(req, res, 200, d);
      return;
    }

    // PATCH /drafts/:id
    if (method === 'PATCH' && parts.length === 2) {
      const patch = JSON.parse(await readBody(req));
      const updated = await patchDraft(id, patch);
      if (!updated) {
        sendJson(req, res, 404, { error: 'not found' });
        return;
      }
      sendJson(req, res, 200, updated);
      return;
    }

    // DELETE /drafts/:id
    if (method === 'DELETE' && parts.length === 2) {
      const ok = await deleteDraft(id);
      sendJson(req, res, ok ? 200 : 404, { deleted: ok });
      return;
    }
  }

  sendJson(req, res, 404, { error: `no route: ${method} ${url.pathname}` });
}
