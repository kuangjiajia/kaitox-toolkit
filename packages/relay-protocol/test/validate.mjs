/**
 * wire 校验器验证：只 import 本包 dist（不依赖 @kaitox/relay，遵守分层规则）。
 *
 * 用法：npm test -w @kaitox/relay-protocol（会先 build 再跑）
 */
import {
  validatePostDraftWireBody,
  validateSetCoverWireBody,
  validateAckPatch,
  validateSettingPatch,
  isValidKindSegment,
} from '../dist/index.js';

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
};
const issuePaths = (r) => (r.ok ? [] : r.issues.map((i) => i.path));

// --- validatePostDraftWireBody ------------------------------------------------

const validBody = {
  bundle: {
    schemaVersion: 1,
    id: 'abc-123',
    kind: 'x-article',
    title: 't',
    markdown: 'hello',
    mode: 'rich',
    assets: [{ key: 'img-0', src: 'a.png', fileName: 'a.png', mime: 'image/png', bytesLen: 8 }],
    createdAt: '2026-07-07T00:00:00.000Z',
    source: 'cli',
  },
  assets: [{ fileName: 'a.png', mime: 'image/png', base64: 'AAAA' }],
};

check('合法 body 通过', validatePostDraftWireBody(validBody).ok);
check('非对象 → $ issue', issuePaths(validatePostDraftWireBody('nope')).includes('$'));
check('缺 bundle → $.bundle issue', issuePaths(validatePostDraftWireBody({ assets: [] })).includes('$.bundle'));

const noId = structuredClone(validBody);
delete noId.bundle.id;
check('缺 id → $.bundle.id issue', issuePaths(validatePostDraftWireBody(noId)).includes('$.bundle.id'));

const badMode = structuredClone(validBody);
badMode.bundle.mode = 'fancy';
check('非法 mode → $.bundle.mode issue', issuePaths(validatePostDraftWireBody(badMode)).includes('$.bundle.mode'));

const badAsset = structuredClone(validBody);
badAsset.bundle.assets[0].bytesLen = 'big';
check(
  '资产元信息错 → 带下标路径',
  issuePaths(validatePostDraftWireBody(badAsset)).includes('$.bundle.assets[0].bytesLen'),
);

const badWireAsset = structuredClone(validBody);
badWireAsset.assets[0].mime = '';
check('wire 资产错 → $.assets[0].mime', issuePaths(validatePostDraftWireBody(badWireAsset)).includes('$.assets[0].mime'));

const badSchema = structuredClone(validBody);
badSchema.bundle.schemaVersion = 'v1';
check('schemaVersion 非数字 → issue', issuePaths(validatePostDraftWireBody(badSchema)).includes('$.bundle.schemaVersion'));
const noSchema = structuredClone(validBody);
delete noSchema.bundle.schemaVersion;
check('schemaVersion 缺席允许（v0.2 兼容）', validatePostDraftWireBody(noSchema).ok);

// 刻意宽松：未知字段、更高 schemaVersion、第三方 kind/source 都放行
const forward = structuredClone(validBody);
forward.bundle.schemaVersion = 99;
forward.bundle.kind = 'my-blog';
forward.bundle.source = 'my-service';
forward.bundle.futureField = { nested: true };
forward.extraTopLevel = 1;
check('向前兼容：未知字段/高版本/自定义 kind 放行', validatePostDraftWireBody(forward).ok);

const withCover = structuredClone(validBody);
withCover.bundle.cover = { key: 'cover', src: '__cover__', fileName: 'cover-a.png', mime: 'image/png', bytesLen: 8 };
check('cover 元信息合法通过', validatePostDraftWireBody(withCover).ok);
withCover.bundle.cover.mime = '';
check('cover 元信息错 → $.bundle.cover.mime', issuePaths(validatePostDraftWireBody(withCover)).includes('$.bundle.cover.mime'));

const withCoverOriginal = structuredClone(validBody);
withCoverOriginal.bundle.coverOriginal = {
  key: 'cover-original',
  src: 'cover-original-a.png',
  fileName: 'cover-original-a.png',
  mime: 'image/png',
  bytesLen: 8,
};
check('coverOriginal 元信息合法通过', validatePostDraftWireBody(withCoverOriginal).ok);
withCoverOriginal.bundle.coverOriginal.mime = '';
check(
  'coverOriginal 元信息错 → $.bundle.coverOriginal.mime',
  issuePaths(validatePostDraftWireBody(withCoverOriginal)).includes('$.bundle.coverOriginal.mime'),
);

// --- validateSetCoverWireBody -------------------------------------------------

check('合法 cover body 通过', validateSetCoverWireBody({ fileName: 'c.png', mime: 'image/png', base64: 'AA' }).ok);
check(
  '缺 base64 → $.base64 issue',
  issuePaths(validateSetCoverWireBody({ fileName: 'c.png', mime: 'image/png' })).includes('$.base64'),
);
check(
  '带合法 original 通过',
  validateSetCoverWireBody({
    fileName: 'c.png',
    mime: 'image/png',
    base64: 'AA',
    original: { fileName: 'o.png', mime: 'image/png', base64: 'BB' },
  }).ok,
);
check(
  'original 非对象 → $.original issue',
  issuePaths(
    validateSetCoverWireBody({ fileName: 'c.png', mime: 'image/png', base64: 'AA', original: 'nope' }),
  ).includes('$.original'),
);
check(
  'original 缺 base64 → $.original.base64 issue',
  issuePaths(
    validateSetCoverWireBody({
      fileName: 'c.png',
      mime: 'image/png',
      base64: 'AA',
      original: { fileName: 'o.png', mime: 'image/png' },
    }),
  ).includes('$.original.base64'),
);
check(
  'original mime 空串 → $.original.mime issue',
  issuePaths(
    validateSetCoverWireBody({
      fileName: 'c.png',
      mime: 'image/png',
      base64: 'AA',
      original: { fileName: 'o.png', mime: '', base64: 'BB' },
    }),
  ).includes('$.original.mime'),
);

// --- validateAckPatch -----------------------------------------------------------

check('合法 ack 通过', validateAckPatch({ status: 'done', restId: 'R_1' }).ok);
check('全部 status 枚举通过', ['pending', 'uploading', 'done', 'failed'].every((s) => validateAckPatch({ status: s }).ok));
check('非法 status → $.status issue', issuePaths(validateAckPatch({ status: 'oops' })).includes('$.status'));
check('缺 status → $.status issue', issuePaths(validateAckPatch({})).includes('$.status'));
check('restId 非字符串 → issue', issuePaths(validateAckPatch({ status: 'done', restId: 5 })).includes('$.restId'));

// --- validateSettingPatch -------------------------------------------------------

check('空 patch 通过', validateSettingPatch({}).ok);
check('token 字符串通过', validateSettingPatch({ token: 'secret' }).ok);
check('token null（清除）通过', validateSettingPatch({ token: null }).ok);
check('token 非字符串 → $.token issue', issuePaths(validateSettingPatch({ token: 5 })).includes('$.token'));

// --- isValidKindSegment ---------------------------------------------------------

check('x-article 合法', isValidKindSegment('x-article'));
check('第三方 kind 合法', isValidKindSegment('my-blog') && isValidKindSegment('linkedin'));
check('大写/下划线/空串非法', !isValidKindSegment('X-Article') && !isValidKindSegment('a_b') && !isValidKindSegment(''));
check('连字符开头非法', !isValidKindSegment('-abc'));
check('含路径分隔非法', !isValidKindSegment('a/b') && !isValidKindSegment('..'));
check(
  '保留段非法（health/setting/drafts）',
  !isValidKindSegment('health') && !isValidKindSegment('setting') && !isValidKindSegment('drafts'),
);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
