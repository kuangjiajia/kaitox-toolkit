/** 把插件打成 Obsidian 需要的 CommonJS main.js，并拷贝 manifest。 */
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });

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

console.log('✓ Obsidian 插件已构建 → apps/obsidian/dist/（把该目录拷进 vault 的 .obsidian/plugins/kaitox/）');
