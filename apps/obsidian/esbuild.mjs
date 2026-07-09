/** 把插件打成 Obsidian 需要的 CommonJS main.js，并拷贝 manifest。 */
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

// mermaid 本体（约 8MB）直接内联进 main.js：社区版安装时 Obsidian 只从 Release 下发
// main.js/manifest.json/styles.css，额外文件不会被下发，所以不能单独出包（见 src/mermaid.ts）。
await esbuild.build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2018',
  // Obsidian / Electron 内建模块由宿主提供，标 external 不打进包。
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', 'node:*'],
  logLevel: 'info',
  legalComments: 'none',
});

// version 从 package.json 盖章，避免每次发布手工同步 manifest。
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
manifest.version = pkg.version;
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');

// styles.css = 面板 chrome 样式 + X 文章预览样式（.xp-*，来自 @kaitox/x-article，
// 单一真相源，构建时拼接，避免复制粘贴分叉）。Obsidian 自动加载插件目录下的 styles.css。
const panelCss = await readFile('src/styles.css', 'utf8');
const previewCss = await readFile('../../packages/x-article/preview.css', 'utf8');
await writeFile(
  'dist/styles.css',
  `${panelCss}\n/* --- @kaitox/x-article preview.css (bundled) --- */\n${previewCss}`,
);

console.log('✓ Obsidian 插件已构建 → apps/obsidian/dist/（把该目录拷进 vault 的 .obsidian/plugins/kaitox/）');
