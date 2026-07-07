/** 把 content/background 打成自包含单文件（含 @kaitox/x-article、@kaitox/relay-protocol 与 marked），并拷贝静态资源。 */
import * as esbuild from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const buildStamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  jsx: 'automatic',
  logLevel: 'info',
  legalComments: 'none',
  define: {
    // React 生产构建（去掉开发态告警与检查）。
    'process.env.NODE_ENV': '"production"',
    // 构建时间戳：content script 加载时打到控制台，用来确认 Chrome 跑的是不是最新构建。
    __KX_BUILD__: JSON.stringify(buildStamp),
  },
};

await mkdir('dist', { recursive: true });

await esbuild.build({ ...common, entryPoints: ['src/content.ts'], outfile: 'dist/content.js' });
await esbuild.build({ ...common, entryPoints: ['src/background.ts'], outfile: 'dist/background.js' });
// mermaid 单独出 ESM 包，content.js 里动态 import() 懒加载（见 mermaid-render.ts）。
await esbuild.build({ ...common, format: 'esm', entryPoints: ['src/mermaid-lib.ts'], outfile: 'dist/mermaid-lib.js' });
await esbuild.build({ ...common, entryPoints: ['src/settings.tsx'], outfile: 'dist/settings.js' });
await esbuild.build({ ...common, entryPoints: ['src/settings-content.ts'], outfile: 'dist/settings-content.js' });

await cp('manifest.json', 'dist/manifest.json');
await cp('src/panel.css', 'dist/panel.css');
// 预览正文样式来自 @kaitox/x-article（与渲染器同源发布），随插件静态注入。
await cp('../../packages/x-article/preview.css', 'dist/preview.css');
await cp('settings.html', 'dist/settings.html');
await cp('src/settings.css', 'dist/settings.css');

console.log('✓ extension 已构建 → apps/extension/dist/（在 chrome://extensions 里「加载已解压」这个目录）');
