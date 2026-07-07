/**
 * 端到端集成测试（自包含）：进程内起 relay，跑三条链路的断言。
 *   1. relay CRUD + 封面字节 + 目录穿越防护 + done→sent
 *   2. 插件上传流水线（relay 拉字节 → publishXArticle mock 掉 X 接口 → content_state 正确 + 封面 mutation）
 *   3. styleCheck + 纯文本兜底通用不变量
 *
 * 用法：npm run test:integration（需先 npm run build）
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import relay 之前设好，config 每次读 env。
const home = await mkdtemp(join(tmpdir(), 'kaitox-itest-'));
process.env.KAITOX_HOME = home;
process.env.KAITOX_RELAY_PORT = '8788';

const { startRelay } = await import('@kaitox/relay');
const { HttpRelayClient } = await import('@kaitox/relay-protocol');
const {
  publishXArticle,
  collectImageSources,
  checkMarkdownStyle,
  toPlaintextMarkdown,
  DEFAULT_COVER_MEDIA_FEATURES,
} = await import('@kaitox/x-article');

const BASE = 'http://127.0.0.1:8788';
let pass = 0,
  fail = 0;
const check = (n, c, extra = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '✅' : '❌'} ${n} ${extra}`);
};

const pngBytes = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const handle = await startRelay();
try {
  const client = new HttpRelayClient(BASE);

  // ---- 1. relay CRUD（含封面）----
  console.log('\n[1] relay CRUD + 封面字节');
  const { id } = await client.postDraft({
    title: '集成测试', mode: 'rich', source: 'cli',
    markdown: '# 集成测试\n\n正文 **粗**。\n\n![图](images/a.png)\n',
    assets: [{ key: 'img-0', src: 'images/a.png', fileName: 'a.png', mime: 'image/png', bytes: pngBytes }],
    cover: { key: 'cover', src: '__cover__', fileName: 'cover-c.png', mime: 'image/png', bytes: pngBytes },
  });
  check('post 返回 id', typeof id === 'string');
  check('list 含草稿', (await client.listDrafts()).some((d) => d.id === id));
  const got = await client.getAsset(id, 'a.png');
  check('正文图字节回读一致', got.length === pngBytes.length && got[0] === pngBytes[0]);
  const gotCover = await client.getAsset(id, 'cover-c.png');
  check('封面字节回读一致', gotCover.length === pngBytes.length);
  const draftMeta = await client.getDraft(id);
  check('bundle.cover 元信息保留', draftMeta.cover?.fileName === 'cover-c.png');
  check('kind 缺省时按 x-article 落盘', draftMeta.kind === 'x-article');
  const listedItem = (await client.listDrafts()).find((d) => d.id === id);
  check('list 条目带 kind', listedItem?.kind === 'x-article');
  // 自定义 kind 原样经 relay 往返（relay 只存转不解释）。
  const { id: kindId } = await client.postDraft({
    kind: 'demo-feature', title: 'kind 往返', mode: 'rich', source: 'my-service',
    markdown: 'hello', assets: [],
  });
  check('自定义 kind 往返保留', (await client.getDraft(kindId)).kind === 'demo-feature');
  await client.deleteDraft(kindId);
  let traversalBlocked = false;
  try { await client.getAsset(id, '../../etc/passwd'); } catch { traversalBlocked = true; }
  check('目录穿越被拦', traversalBlocked);

  // ---- 2. 上传流水线（含封面）----
  console.log('\n[2] 插件上传流水线 + 封面');
  const draft = await client.getDraft(id);
  const calls = [];
  const ok = (obj) => ({ ok: true, status: 200, async text() { return JSON.stringify(obj); }, async json() { return obj; } });
  let initN = 0;
  const mockFetch = async (url, init = {}) => {
    calls.push({ url, headers: init.headers, credentials: init.credentials, body: init.body });
    if (url.includes('command=INIT')) return ok({ media_id_string: `MID_${++initN}` }); // 正文图=MID_1，封面=MID_2
    if (url.includes('command=APPEND')) return ok({});
    if (url.includes('command=FINALIZE')) {
      const m = url.match(/[?&]media_id=([^&]+)/);
      return ok({ media_id_string: m ? m[1] : 'MID_x' });
    }
    if (url.includes('/ArticleEntityDraftCreate')) return ok({ data: { article_entity_draft_create: { rest_id: 'ART_777' } } });
    if (url.includes('/ArticleEntityUpdateCoverMedia')) return ok({ data: { articleentity_update_cover_media: { rest_id: 'ART_777' } } });
    throw new Error('unexpected ' + url);
  };
  const result = await publishXArticle({
    markdown: draft.markdown, title: draft.title,
    credentials: { bearerToken: '', csrfToken: 'CT0' },
    clientOptions: { fetchImpl: mockFetch, credentialsMode: 'include', articleDraftCreateQueryId: 'QID_1', updateCoverMediaQueryId: 'COVER_QID' },
    fetchImage: async (src) => {
      const a = draft.assets.find((x) => x.src === src);
      return { bytes: await client.getAsset(draft.id, a.fileName), mimeType: a.mime };
    },
    fetchCover: async () => ({ bytes: await client.getAsset(draft.id, draft.cover.fileName), mimeType: draft.cover.mime }),
  });
  const init = calls.find((c) => c.url.includes('command=INIT'));
  check('INIT media_category=tweet_image', init.url.includes('media_category=tweet_image'));
  const create = calls.find((c) => c.url.includes('/ArticleEntityDraftCreate'));
  check('create 用了 queryId', create.url.includes('QID_1'));
  check('create credentials=include', create.credentials === 'include');
  check('create 无手动 cookie 头', !('cookie' in create.headers));
  const cs = JSON.parse(create.body).variables.content_state;
  const media = cs.entity_map.find((e) => e.value.type === 'MEDIA');
  check('MEDIA.media_id=正文图上传值', media.value.data.media_items[0].media_id === 'MID_1');
  check('MEDIA.category=DraftTweetImage', media.value.data.media_items[0].media_category === 'DraftTweetImage');
  check('restId 解析', result.restId === 'ART_777');

  // 封面：上传发生在建草稿之后，且用独立的 UpdateCoverMedia mutation
  check('result.coverMediaId=封面上传值', result.coverMediaId === 'MID_2');
  const coverCall = calls.find((c) => c.url.includes('/ArticleEntityUpdateCoverMedia'));
  check('调用了 UpdateCoverMedia', !!coverCall);
  check('cover mutation 用了 coverQueryId', coverCall.url.includes('COVER_QID'));
  const coverBody = JSON.parse(coverCall.body);
  check('cover.articleEntityId=草稿 restId', coverBody.variables.articleEntityId === 'ART_777');
  check('cover.media_id=封面上传值', coverBody.variables.coverMedia.media_id === 'MID_2');
  check('cover.media_category=DraftTweetImage', coverBody.variables.coverMedia.media_category === 'DraftTweetImage');
  check('cover 无 fieldToggles', !('fieldToggles' in coverBody));
  check('cover 用封面专属 features', coverBody.features.profile_label_improvements_pcf_label_in_post_enabled === DEFAULT_COVER_MEDIA_FEATURES.profile_label_improvements_pcf_label_in_post_enabled && DEFAULT_COVER_MEDIA_FEATURES.profile_label_improvements_pcf_label_in_post_enabled === true);
  // 建草稿 → 设封面的先后顺序
  const idxCreate = calls.findIndex((c) => c.url.includes('/ArticleEntityDraftCreate'));
  const idxCover = calls.findIndex((c) => c.url.includes('/ArticleEntityUpdateCoverMedia'));
  check('先建草稿再设封面', idxCreate >= 0 && idxCover > idxCreate);

  // done → sent（迁移目录归档，但列表仍要能看到——草稿箱「已上传」Tab 依赖）
  await client.ack(id, { status: 'done', restId: 'ART_777' });
  const doneItem = (await client.listDrafts()).find((d) => d.id === id);
  check('done 后仍在列表且 status=done', doneItem?.status === 'done');
  await client.deleteDraft(id);

  // ---- 3. styleCheck + plaintext ----
  console.log('\n[3] styleCheck + plaintext');
  const md = '# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- x\n  - nested\n\n![r](https://cdn.x/y.png)\n';
  const rep = checkMarkdownStyle(md);
  check('表格降为 info（X 原生渲染表格）', rep.issues.some((i) => i.rule === 'table' && i.severity === 'info'));
  check('检测到嵌套列表 warning', rep.issues.some((i) => i.rule === 'nested-list'));
  check('不友好', rep.friendly === false);
  const pt = toPlaintextMarkdown(md);
  check('纯文本降级保留表格（不再打平）', /\| a \| b \|/.test(pt));
  check('纯文本降级拍平嵌套列表', !/ {2}- nested/.test(pt) && /- nested/.test(pt));
  check('纯文本保留远程图片 src', collectImageSources(pt).includes('https://cdn.x/y.png'));
} finally {
  await handle.close();
  await rm(home, { recursive: true, force: true });
}

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
