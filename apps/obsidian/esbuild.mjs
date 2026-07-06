/** 把插件打成 Obsidian 需要的 CommonJS main.js，并拷贝 manifest。 */
import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

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

await cp('manifest.json', 'dist/manifest.json');

console.log('✓ Obsidian 插件已构建 → apps/obsidian/dist/（把该目录拷进 vault 的 .obsidian/plugins/kaitox-x-article/）');
