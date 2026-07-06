/**
 * 转换正确性验证：把一段覆盖各类构造的 Markdown 跑过 markdownToContentState，
 * 逐条比对期望真值（含 CJK 加粗 offset:27,length:19 = "Harness Engineering"）。
 *
 * 用法：npm test （会先 build 再跑）
 */
import { markdownToContentState, collectImageSources } from '../dist/contentState.js';
import { sanitizeContentState } from '../dist/xArticleClient.js';
import { deriveTitle } from '../dist/publishArticle.js';

const md = `# 主标题在此

最近Agent Engineering圈里冒出两个词：**Harness Engineering** 和 **Loop Engineering**。

行内代码 \`codex-ip-image-generator\` 应降级为普通文本。

## 一张图先讲清楚

### 三级标题是 SubHeading

# 文中额外的一级标题按 Heading 处理

> 你以为自己在造一个 Agent，其实你造的多半是 Loop。

- Agentic Loop
- 文件读写、搜索、命令执行

\`\`\`plaintext
Harness Engineering 关心的是 Agent 怎么安全地行动。
\`\`\`

---

![diagram](https://cdn.example.com/a.png)

参考 [Anatoli Kopadze: Loops explained](https://x.com/AnatoliKopadze/status/2068328135611822149)
`;

const { contentState, skippedImages, title } = markdownToContentState(md, {
  'https://cdn.example.com/a.png': '2073636744684015616',
});

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
};

const blocks = contentState.blocks;
const ents = contentState.entity_map;
const byType = (t) => blocks.filter((b) => b.type === t);

check('图片收集正确', JSON.stringify(collectImageSources(md)) === JSON.stringify(['https://cdn.example.com/a.png']));

// CJK 加粗 offset —— 期望值 offset:27 length:19 = "Harness Engineering"
const first = blocks[0];
const b1 = first.inline_style_ranges[0];
check('首段是 unstyled', first.type === 'unstyled');
check('首段 Bold offset=27', b1.offset === 27, `(got ${b1.offset})`);
check('首段 Bold length=19', b1.length === 19, `(got ${b1.length})`);
check(
  'Bold 精确覆盖 "Harness Engineering"',
  first.text.slice(b1.offset, b1.offset + b1.length) === 'Harness Engineering',
);

// 标题层级 —— # = 主标题（不进正文），## = Heading(header-one)，### = SubHeading(header-two)
check('第一个 H1 提取为主标题', title === '主标题在此', `(got ${title})`);
check('主标题不进正文', blocks.every((b) => b.text !== '主标题在此'));
check(
  'header-one ×2（## + 文中额外 H1）',
  byType('header-one').length === 2,
  `(got ${byType('header-one').length})`,
);
check('header-two ×1（### 钳到 SubHeading）', byType('header-two').length === 1, `(got ${byType('header-two').length})`);
check('不产出 header-three', byType('header-three').length === 0);
check('deriveTitle 优先 H1', deriveTitle('## 二级在前\n\n# 一级在后\n') === '一级在后');
check('deriveTitle 无 H1 时退到首个标题', deriveTitle('### 只有三级\n') === '只有三级');
check('blockquote ×1', byType('blockquote').length === 1);
check('unordered-list-item ×2', byType('unordered-list-item').length === 2);
check('atomic ×3 (code+hr+media)', byType('atomic').length === 3, `(got ${byType('atomic').length})`);

// atomic 不变量
check(
  'atomic 满足 text=" " 且单一 range[0,1]',
  byType('atomic').every(
    (b) => b.text === ' ' && b.entity_ranges.length === 1 && b.entity_ranges[0].offset === 0 && b.entity_ranges[0].length === 1,
  ),
);

// 实体顺序 & key 连续
const types = ents.map((e) => e.value.type);
check('实体顺序 MARKDOWN,DIVIDER,MEDIA,LINK', JSON.stringify(types) === JSON.stringify(['MARKDOWN', 'DIVIDER', 'MEDIA', 'LINK']), `(got ${types})`);
check('实体 key 从 0 连续', ents.every((e, i) => e.key === i));

// MEDIA
const media = ents.find((e) => e.value.type === 'MEDIA');
check('MEDIA.local_media_id === key', media.value.data.media_items[0].local_media_id === media.key);
check('MEDIA.media_id 回填', media.value.data.media_items[0].media_id === '2073636744684015616');
check('MEDIA.media_category = DraftTweetImage', media.value.data.media_items[0].media_category === 'DraftTweetImage');

// MARKDOWN / DIVIDER
check('MARKDOWN = ```plaintext 围栏', ents.find((e) => e.value.type === 'MARKDOWN').value.data.markdown.startsWith('```plaintext\n'));
check('DIVIDER.data = {}', JSON.stringify(ents.find((e) => e.value.type === 'DIVIDER').value.data) === '{}');

// LINK
const linkBlock = blocks.find((b) => b.entity_ranges.some((r) => ents[r.key]?.value.type === 'LINK'));
const linkRange = linkBlock.entity_ranges.find((r) => ents[r.key].value.type === 'LINK');
check('LINK mutable', ents[linkRange.key].value.mutability === 'Mutable');
check('LINK url 正确', ents[linkRange.key].value.data.url === 'https://x.com/AnatoliKopadze/status/2068328135611822149');
check('LINK range 覆盖显示文字', linkBlock.text.slice(linkRange.offset, linkRange.offset + linkRange.length) === 'Anatoli Kopadze: Loops explained');

check('无跳过图片', skippedImages.length === 0);

// depth 回归 —— X 的 GraphQL input 强类型，带 depth 会 GRAPHQL_VALIDATION_FAILED
check('转换产物 blocks 不含 depth', blocks.every((b) => !('depth' in b)));
const dirty = {
  blocks: blocks.map((b) => ({ ...b, depth: 0 })),
  entity_map: ents,
};
const cleaned = sanitizeContentState(dirty);
check('sanitize 剥掉外来 depth', cleaned.blocks.every((b) => !('depth' in b)));
check('sanitize 不丢字段', JSON.stringify(cleaned) === JSON.stringify(contentState));

// inline style 回归 —— X 枚举实测只有 Bold/Italic/Strikethrough，Code/Underline 会被拒
const VALID_STYLES = new Set(['Bold', 'Italic', 'Strikethrough']);
check(
  '所有 style 都在实测合法枚举内',
  blocks.every((b) => b.inline_style_ranges.every((r) => VALID_STYLES.has(r.style))),
);
const codeBlock = blocks.find((b) => b.text.includes('codex-ip-image-generator'));
check('行内代码降级为普通文本（保留文字）', codeBlock.text === '行内代码 codex-ip-image-generator 应降级为普通文本。');
check('行内代码不产生 style range', codeBlock.inline_style_ranges.length === 0);
const dirtyStyles = sanitizeContentState({
  blocks: [{ key: 'aaaaa', text: 'abc def', type: 'unstyled', data: {}, entity_ranges: [],
    inline_style_ranges: [
      { offset: 0, length: 3, style: 'Code' },
      { offset: 4, length: 3, style: 'Bold' },
    ] }],
  entity_map: [],
});
check(
  'sanitize 过滤非法 style、保留合法 style',
  JSON.stringify(dirtyStyles.blocks[0].inline_style_ranges) === JSON.stringify([{ offset: 4, length: 3, style: 'Bold' }]),
);

// block 类型回归 —— header-three / code-block 过得了校验但后端 OperationalError
const dirtyTypes = sanitizeContentState({
  blocks: [
    { key: 'aaaaa', text: 'h3', type: 'header-three', data: {}, entity_ranges: [], inline_style_ranges: [] },
    { key: 'bbbbb', text: 'code', type: 'code-block', data: {}, entity_ranges: [], inline_style_ranges: [] },
    { key: 'ccccc', text: 'h2', type: 'header-two', data: {}, entity_ranges: [], inline_style_ranges: [] },
  ],
  entity_map: [],
});
check(
  'sanitize 降级 header-three→header-two、code-block→unstyled',
  dirtyTypes.blocks[0].type === 'header-two' &&
    dirtyTypes.blocks[1].type === 'unstyled' &&
    dirtyTypes.blocks[2].type === 'header-two',
);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
