/**
 * 预览渲染层验证：previewModel（切分/分组）+ previewHtml（HTML 输出/转义/占位）。
 *
 * 用法：npm test （会先 build 再跑，接在 validate.mjs 之后）
 */
import { buildPreviewModel, segmentText, groupBlocks } from '../dist/previewModel.js';
import { renderPreviewHtml, renderModelHtml } from '../dist/previewHtml.js';
import { markdownToContentState } from '../dist/contentState.js';
import { extractMermaidBlocks } from '../dist/mermaid.js';

let pass = 0,
  fail = 0;
const check = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✅' : '❌'} ${name} ${extra}`);
};

// --- segmentText：边界集切分 -------------------------------------------------

// '普通 粗体 粗斜体 斜体 尾巴'（CJK 每字 1 个 code unit）：
// Bold 覆盖 [3,9) = '粗体 粗斜体'，Italic 覆盖 [6,12) = '粗斜体 斜体'，重叠区 [6,9) = '粗斜体'
const segs = segmentText(
  '普通 粗体 粗斜体 斜体 尾巴',
  [
    { offset: 3, length: 6, style: 'Bold' },
    { offset: 6, length: 6, style: 'Italic' },
  ],
  [],
);
check(
  '重叠样式切成 5 段',
  segs.length === 5,
  `(got ${segs.length}: ${JSON.stringify(segs.map((s) => s.text))})`,
);
check('段1 纯文本', segs[0] && segs[0].text === '普通 ' && !segs[0].bold && !segs[0].italic);
check('段2 仅 Bold', segs[1] && segs[1].text === '粗体 ' && segs[1].bold && !segs[1].italic);
check('段3 Bold+Italic 重叠', segs[2] && segs[2].text === '粗斜体' && segs[2].bold && segs[2].italic);
check('段4 仅 Italic', segs[3] && segs[3].text === ' 斜体' && !segs[3].bold && segs[3].italic);
check('段5 纯文本尾部', segs[4] && segs[4].text === ' 尾巴' && !segs[4].bold && !segs[4].italic);

// 相邻同样式段合并：两个 Bold 区间紧挨
const mergedSegs = segmentText(
  'abcdef',
  [
    { offset: 0, length: 3, style: 'Bold' },
    { offset: 3, length: 3, style: 'Bold' },
  ],
  [],
);
check('相邻同样式段合并为 1 段', mergedSegs.length === 1 && mergedSegs[0].text === 'abcdef' && mergedSegs[0].bold);

// entity range 切分：链接文字带 entityKey
const linkSegs = segmentText('看这里详情', [], [{ key: 7, offset: 1, length: 3 }]);
check(
  'entity range 切出带 entityKey 的段',
  linkSegs.length === 3 && linkSegs[1].text === '这里详' && linkSegs[1].entityKey === 7 && linkSegs[0].entityKey === undefined,
);

check('空文本返回空段列表', segmentText('', [], []).length === 0);

// --- buildPreviewModel：与发布同路径、图片不被 skip ---------------------------

const md = `# 主标题在此

**Harness Engineering** 与 [链接](https://example.com/a) 同段。

![图一](https://cdn.example.com/a.png)

- 甲
- 乙

1. 第一
2. 第二

---

\`\`\`js
const x = 1;
\`\`\`
`;

const model = buildPreviewModel(md);
check('derivedTitle 提取第一个 H1', model.derivedTitle === '主标题在此');
const mediaEntity = [...model.entities.values()].find((e) => e.type === 'MEDIA');
check('图片不被 skip 且 media_id === src', mediaEntity?.data.media_items[0].media_id === 'https://cdn.example.com/a.png');
check('entities 是 Map 且含 LINK', [...model.entities.values()].some((e) => e.type === 'LINK'));

// --- groupBlocks ------------------------------------------------------------

const groups = groupBlocks(model.blocks);
const listGroups = groups.filter((g) => g.kind === 'list');
check('连续同型列表项归并、ul/ol 分组', listGroups.length === 2, `(got ${listGroups.length})`);
check('无序组 2 项', listGroups[0]?.ordered === false && listGroups[0]?.items.length === 2);
check('有序组 2 项', listGroups[1]?.ordered === true && listGroups[1]?.items.length === 2);

// --- renderModelHtml / renderPreviewHtml -------------------------------------

const html = renderModelHtml(model, {
  resolveImage: (src) => (src === 'https://cdn.example.com/a.png' ? 'blob:chrome-extension/abc' : null),
});
check('输出 xp-article 容器', html.startsWith('<article class="xp-article">') && html.endsWith('</article>'));
check('标题用 derivedTitle', html.includes('<h1 class="xp-title">主标题在此</h1>'));
check('Bold → <strong>', html.includes('<strong>Harness Engineering</strong>'));
check(
  'LINK → 安全 <a>',
  html.includes('<a class="xp-link" href="https://example.com/a" target="_blank" rel="noopener noreferrer">链接</a>'),
);
check('图片解析为 blob URL', html.includes('<img class="xp-img" src="blob:chrome-extension/abc"'));
check('分割线 → hr', html.includes('<hr class="xp-divider">'));
check('代码块 → pre 只留代码（剥掉围栏行）', html.includes('<pre class="xp-md">const x = 1;</pre>'));
const tableHtml = renderPreviewHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
check(
  '表格 → 原生 <table> 渲染',
  tableHtml.includes('<table class="xp-table">') && tableHtml.includes('<th>a</th>') && tableHtml.includes('<td>2</td>'),
);
const richTable = renderPreviewHtml(
  '| `type` | 说明 |\n| --- | --- |\n| `message.delta` | **追加** [文档](https://example.com/d) |\n|  |  |\n',
);
check(
  '表格单元格行内 markdown 渲染（code/bold/link）',
  richTable.includes('<th><code class="xp-code">type</code></th>') &&
    richTable.includes('<td><code class="xp-code">message.delta</code></td>') &&
    richTable.includes('<strong>追加</strong>') &&
    richTable.includes('href="https://example.com/d"'),
);
check('空单元格行保留', (richTable.match(/<td><\/td>/g) ?? []).length === 2);
// 表格实体格式对齐 X 编辑器实测载荷：Mutable + 换行包裹
const tableCs = markdownToContentState('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
const tableEnt = tableCs.contentState.entity_map.find((e) => e.value.type === 'MARKDOWN');
check(
  '表格实体 Mutable 且换行包裹',
  tableEnt?.value.mutability === 'Mutable' && tableEnt?.value.data.markdown.startsWith('\n|') && tableEnt?.value.data.markdown.endsWith('\n'),
);
const multiFence = renderPreviewHtml('```text\n第一行\n```内文反引号\n最后一行\n```\n');
check('代码内容含 ``` 时仍只剥外层围栏', multiFence.includes('第一行') && multiFence.includes('```内文反引号') && !multiFence.includes('```text'));
check('列表 → ul/ol + li', html.includes('<ul class="xp-ul"><li>甲</li><li>乙</li></ul>') && html.includes('<ol class="xp-ol"><li>第一</li><li>第二</li></ol>'));

// title 覆盖 + 封面
const withTitle = renderModelHtml(model, { title: '外部标题优先', coverUrl: 'blob:cover' });
check('opts.title 覆盖 derivedTitle', withTitle.includes('<h1 class="xp-title">外部标题优先</h1>'));
check('coverUrl → xp-cover', withTitle.includes('<img class="xp-cover" src="blob:cover"'));

// resolveImage 三态
const loading = renderPreviewHtml('![a](https://i/x.png)', { resolveImage: () => undefined });
check('resolveImage=undefined → 加载中占位', loading.includes('xp-img-loading'));
const missing = renderPreviewHtml('![a](https://i/x.png)', { resolveImage: () => null });
check('resolveImage=null → 未打包占位（含 src）', missing.includes('xp-img-missing') && missing.includes('https://i/x.png'));
const passthrough = renderPreviewHtml('![a](https://i/x.png)');
check('不传 resolveImage → 原样用 src', passthrough.includes('<img class="xp-img" src="https://i/x.png"'));

// HTML 转义
const xss = renderPreviewHtml('正文有 <script>alert(1)</script> 与 "引号"');
check('文本经转义（无裸 <script>）', !xss.includes('<script>') && xss.includes('&lt;script&gt;'));
const evilLink = renderPreviewHtml('[点我](javascript:alert(1))');
check('javascript: 链接不产出 <a>', !evilLink.includes('<a '));

// 空正文 / 无标题
const empty = renderPreviewHtml('');
check('空 markdown → 无标题 + 正文为空', empty.includes('xp-title-empty') && empty.includes('xp-empty'));
const h1Only = renderPreviewHtml('# 只有标题\n');
check('仅 H1 → 标题 + 正文为空', h1Only.includes('<h1 class="xp-title">只有标题</h1>') && h1Only.includes('xp-empty'));

// 引用与标题层级
const levels = renderPreviewHtml('# t\n\n## 大\n\n### 小\n\n> 引用');
check('## → h2.xp-h1、### → h3.xp-h2', levels.includes('<h2 class="xp-h1">大</h2>') && levels.includes('<h3 class="xp-h2">小</h3>'));
check('引用 → blockquote.xp-quote', levels.includes('<blockquote class="xp-quote">引用</blockquote>'));

// --- extractMermaidBlocks：mermaid 围栏 → 图片引用 ---------------------------

const mmdMd = `# 标题

前文段落。

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

\`\`\`js
const keep = true;
\`\`\`

> 引用里的：
> \`\`\`mermaid
> A --> B
> \`\`\`
`;

const ex = extractMermaidBlocks(mmdMd);
check('提取出 1 个顶层 mermaid 块', ex.blocks.length === 1, `(got ${ex.blocks.length})`);
check('合成 src 带协议前缀', ex.blocks[0]?.src === 'mermaid://diagram-1');
check('块内是围栏内源码', ex.blocks[0]?.code === 'flowchart LR\n  A --> B');
check('markdown 中围栏被替换为图片引用', ex.markdown.includes('![mermaid diagram 1](mermaid://diagram-1)') && !/```mermaid\nflowchart/.test(ex.markdown));
check('非 mermaid 代码块原样保留', ex.markdown.includes('```js\nconst keep = true;\n```'));
check('引用内的 mermaid 不动（保持代码块降级）', ex.markdown.includes('> ```mermaid'));

// 变换后经发布转换：合成 src 成为 MEDIA 实体
const exCs = markdownToContentState(ex.markdown, { 'mermaid://diagram-1': '123' });
const exMedia = exCs.contentState.entity_map.find((e) => e.value.type === 'MEDIA');
check('合成 src 走 MEDIA 实体', exMedia?.value.data.media_items[0].media_id === '123');

const noMmd = extractMermaidBlocks('# 无 mermaid\n\n正文。\n');
check('无 mermaid 时原文原样返回', noMmd.blocks.length === 0 && noMmd.markdown === '# 无 mermaid\n\n正文。\n');

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
