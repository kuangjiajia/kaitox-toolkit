/**
 * Standalone smoke test for @kaitox/relay-protocol: exercises only the
 * package's public exports (HttpRelayClient + base64 helpers) against an
 * in-process relay, the way a third-party integration would.
 *
 * Lives at the repo root (not inside the package) so relay-protocol never
 * grows a devDependency back onto @kaitox/relay.
 *
 * Usage: npm run test:protocol (builds first).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Must be set before importing the relay — config reads env on each call.
const home = await mkdtemp(join(tmpdir(), 'kaitox-ptest-'));
process.env.KAITOX_HOME = home;
process.env.KAITOX_RELAY_PORT = '8790';

const { startRelay } = await import('@kaitox/relay');
const { HttpRelayClient, RelayHttpError, bytesToBase64, base64ToBytes } = await import('@kaitox/relay-protocol');

const BASE = 'http://127.0.0.1:8790';
let pass = 0,
  fail = 0;
const check = (n, c, extra = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '✅' : '❌'} ${n} ${extra}`);
};

const bytes = Uint8Array.from([137, 80, 78, 71, 0, 255, 1, 2]);

const handle = await startRelay();
try {
  // 第三方集成方式：client 以自己的 kind 为作用域（走 /my-feature/drafts），relay 零改动。
  const client = new HttpRelayClient(BASE, { kind: 'my-feature' });

  // base64 round-trip (both directions of the wire encoding).
  const back = base64ToBytes(bytesToBase64(bytes));
  check('base64 round-trip', back.length === bytes.length && back.every((b, i) => b === bytes[i]));

  // health
  const health = await client.health();
  check('health ok', health.ok === true && typeof health.version === 'string');

  // postDraft (third-party kind/source pass through untouched)
  const { id } = await client.postDraft({
    title: 'protocol smoke',
    markdown: 'hello ![i](a.bin)',
    mode: 'rich',
    source: 'my-service',
    assets: [{ key: 'img-0', src: 'a.bin', fileName: 'a.bin', mime: 'application/octet-stream', bytes }],
  });
  check('postDraft returns id', typeof id === 'string' && id.length > 0);

  // listDrafts
  const listed = (await client.listDrafts()).find((d) => d.id === id);
  check('listDrafts contains draft', !!listed);
  check('kind passes through', listed?.kind === 'my-feature');
  check('source passes through', listed?.source === 'my-service');

  // getDraft
  const draft = await client.getDraft(id);
  check('getDraft returns bundle', draft.markdown === 'hello ![i](a.bin)' && draft.status === 'pending');

  // getAsset
  const got = await client.getAsset(id, 'a.bin');
  check('getAsset bytes round-trip', got.length === bytes.length && got.every((b, i) => b === bytes[i]));

  // setCover（无封面 → 设置 → 替换，旧封面文件被清理）
  check('draft starts without cover', !draft.cover);
  await client.setCover(id, { fileName: 'c1.png', mime: 'image/png', bytes });
  const withCover = await client.getDraft(id);
  check(
    'setCover persists cover meta',
    withCover.cover?.fileName === 'cover-c1.png' &&
      withCover.cover?.mime === 'image/png' &&
      withCover.cover?.bytesLen === bytes.length,
  );
  const coverBytes = await client.getAsset(id, 'cover-c1.png');
  check('cover bytes round-trip', coverBytes.length === bytes.length && coverBytes.every((b, i) => b === bytes[i]));
  await client.setCover(id, { fileName: 'c2.png', mime: 'image/png', bytes });
  const swapped = await client.getDraft(id);
  check('setCover replaces cover', swapped.cover?.fileName === 'cover-c2.png');
  check('setCover without original keeps coverOriginal absent', !swapped.coverOriginal);
  const oldCoverGone = await client.getAsset(id, 'cover-c1.png').then(
    () => false,
    () => true,
  );
  check('old cover file cleaned up', oldCoverGone);

  // setCover 带 original（用户新选图裁切）→ 原图随成品一起落盘
  const origBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  await client.setCover(id, {
    fileName: 'c3.png',
    mime: 'image/png',
    bytes,
    original: { fileName: 'o1.png', mime: 'image/png', bytes: origBytes },
  });
  const withOrig = await client.getDraft(id);
  check(
    'setCover persists original meta',
    withOrig.coverOriginal?.fileName === 'cover-original-o1.png' &&
      withOrig.coverOriginal?.mime === 'image/png' &&
      withOrig.coverOriginal?.bytesLen === origBytes.length,
  );
  const gotOrig = await client.getAsset(id, 'cover-original-o1.png');
  check('original bytes round-trip', gotOrig.length === origBytes.length && gotOrig.every((b, i) => b === origBytes[i]));

  // 再 setCover 不带 original（基于原图重裁）→ 只换成品，原图保留
  await client.setCover(id, { fileName: 'c4.png', mime: 'image/png', bytes });
  const recropped = await client.getDraft(id);
  check(
    'recrop keeps original',
    recropped.cover?.fileName === 'cover-c4.png' && recropped.coverOriginal?.fileName === 'cover-original-o1.png',
  );
  const origStillThere = await client.getAsset(id, 'cover-original-o1.png').then(
    () => true,
    () => false,
  );
  check('original file survives recrop', origStillThere);

  // setCover 带新 original（更换封面）→ 原图替换，旧原图文件被清理
  await client.setCover(id, {
    fileName: 'c5.png',
    mime: 'image/png',
    bytes,
    original: { fileName: 'o2.png', mime: 'image/png', bytes: origBytes },
  });
  const swappedOrig = await client.getDraft(id);
  check('new original replaces old', swappedOrig.coverOriginal?.fileName === 'cover-original-o2.png');
  const oldOrigGone = await client.getAsset(id, 'cover-original-o1.png').then(
    () => false,
    () => true,
  );
  check('old original file cleaned up', oldOrigGone);

  // ack
  await client.ack(id, { status: 'done', restId: 'R_1' });
  const done = await client.getDraft(id);
  check('ack persists status + restId', done.status === 'done' && done.restId === 'R_1');
  // done 草稿迁入 sent/ 后必须仍出现在列表里（草稿箱「已上传」Tab 依赖这一点）
  const doneInList = (await client.listDrafts()).find((d) => d.id === id);
  check('done draft stays in list', doneInList?.status === 'done');
  // 迁入 sent/ 后资产（含原图）随目录走，仍可读
  const origAfterDone = await client.getAsset(id, 'cover-original-o2.png').then(
    () => true,
    () => false,
  );
  check('original readable after done migration', origAfterDone);

  // deleteDraft
  await client.deleteDraft(id);
  const goneFromList = !(await client.listDrafts()).some((d) => d.id === id);
  check('deleteDraft removes from list', goneFromList);

  // 错误形态：404 → RelayHttpError（消费方可按 status 程序化分支）
  const notFoundErr = await client.getDraft(id).then(
    () => null,
    (e) => e,
  );
  check(
    '404 抛 RelayHttpError 且带 status',
    notFoundErr instanceof RelayHttpError && notFoundErr.status === 404,
  );

  // v0.4 前的旧根路由回 410 + 迁移提示
  const legacy = await fetch(`${BASE}/drafts`);
  check('旧根路由 /drafts → 410 Gone', legacy.status === 410);

  // kind 命名空间隔离：默认（x-article）作用域的 client 看不到 my-feature 的草稿
  const xClient = new HttpRelayClient(BASE);
  const { id: id2 } = await client.postDraft({
    title: 'isolation',
    markdown: 'x',
    mode: 'rich',
    source: 'my-service',
    assets: [],
  });
  check('跨 kind 不可见（列表）', !(await xClient.listDrafts()).some((d) => d.id === id2));
  const crossKind = await xClient.getDraft(id2).then(
    () => null,
    (e) => e,
  );
  check('跨 kind 不可见（单取 404）', crossKind instanceof RelayHttpError && crossKind.status === 404);
  await client.deleteDraft(id2);
} finally {
  await handle.close();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
