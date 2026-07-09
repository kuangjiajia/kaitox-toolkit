/**
 * Project a standalone, open-source snapshot of the Obsidian plugin into a target
 * directory (a clone of the kuangjiajia/kaitox-obsidian distribution repo).
 *
 * Why this exists: Obsidian's community-plugin review requires the SUBMITTED repo to
 * contain the buildable source — closed-source plugins (repo holding only a manifest +
 * a prebuilt release asset) are rejected. The monorepo here stays the source of truth;
 * this script projects a self-contained, `npm install && npm run build`-able copy of the
 * plugin into the distribution repo on every release.
 *
 * The projected repo differs from apps/obsidian in exactly two ways, both so it builds
 * outside the monorepo: a standalone package.json (plain `node esbuild.mjs` build, no
 * `--prefix ../..`, @kaitox/* pulled from npm) and a flattened tsconfig.json (the monorepo
 * one extends ../../tsconfig.base.json, which won't exist there). esbuild.mjs itself is
 * copied verbatim — it already resolves @kaitox/x-article/preview.css via node module
 * resolution, so the same file builds in both places.
 *
 * Usage (run after `npm run build:obsidian`, which stamps dist/manifest.json):
 *   node apps/obsidian/scripts/make-release-repo.mjs <absoluteTargetDir>
 */
import { cp, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url)); // apps/obsidian/scripts
const appDir = resolve(scriptDir, '..'); // apps/obsidian
const repoRoot = resolve(appDir, '..', '..'); // monorepo root

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/make-release-repo.mjs <absoluteTargetDir>');
  process.exit(1);
}
if (!isAbsolute(target)) {
  console.error(`target dir must be absolute, got: ${target}`);
  process.exit(1);
}

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const pkg = await readJson(join(appDir, 'package.json'));
// dist/manifest.json is the version-stamped manifest emitted by esbuild.mjs.
const manifest = await readJson(join(appDir, 'dist', 'manifest.json'));

// Files this script owns in the distribution repo. Clear then re-project so that a file
// removed from the monorepo also disappears downstream (leaves .git/.github untouched).
const owned = [
  'src',
  'esbuild.mjs',
  'tsconfig.json',
  'package.json',
  'manifest.json',
  'versions.json',
  'README.md',
  'LICENSE',
  '.gitignore',
];
for (const p of owned) await rm(join(target, p), { recursive: true, force: true });

// Source + build script, verbatim from the monorepo.
await cp(join(appDir, 'src'), join(target, 'src'), { recursive: true });
await cp(join(appDir, 'esbuild.mjs'), join(target, 'esbuild.mjs'));
// Version-stamped manifest (from the build) + the plugin→minAppVersion history Obsidian reads.
await cp(join(appDir, 'dist', 'manifest.json'), join(target, 'manifest.json'));
await cp(join(appDir, 'versions.json'), join(target, 'versions.json'));
await cp(join(repoRoot, 'LICENSE'), join(target, 'LICENSE'));

// Standalone package.json: same runtime deps as the monorepo plugin, but built with a
// plain `node esbuild.mjs` (esbuild + typescript become explicit devDeps here, since they
// come from the monorepo root otherwise) and @kaitox/* resolved from npm.
const standalonePkg = {
  name: 'kaitox-obsidian',
  version: pkg.version,
  description: manifest.description,
  type: 'module',
  license: 'MIT',
  author: manifest.author,
  homepage: 'https://github.com/kuangjiajia/kaitox-obsidian',
  repository: {
    type: 'git',
    url: 'git+https://github.com/kuangjiajia/kaitox-obsidian.git',
  },
  scripts: {
    build: 'node esbuild.mjs',
    typecheck: 'tsc -p tsconfig.json --noEmit',
  },
  dependencies: pkg.dependencies,
  devDependencies: {
    esbuild: '^0.20.0',
    obsidian: pkg.devDependencies?.obsidian ?? '^1.4.11',
    typescript: '^5.4.0',
  },
};
await writeFile(
  join(target, 'package.json'),
  JSON.stringify(standalonePkg, null, 2) + '\n',
);

// Standalone tsconfig: the monorepo one extends ../../tsconfig.base.json — inline it so the
// distribution repo type-checks on its own.
const tsconfig = {
  compilerOptions: {
    target: 'ES2020',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    lib: ['ES2020', 'DOM'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
    noEmit: true,
  },
  include: ['src/**/*.ts'],
};
await writeFile(
  join(target, 'tsconfig.json'),
  JSON.stringify(tsconfig, null, 2) + '\n',
);

await writeFile(join(target, '.gitignore'), ['node_modules/', 'dist/', ''].join('\n'));

const readme = `# Kaitox for Obsidian

Preview the active note as an **X (Twitter) Article** and push it to your drafts — straight from your vault. Part of the [Kaitox](https://github.com/kuangjiajia/kaitox-toolkit) personal toolkit.

The plugin previews, style-checks, and packages the note, then hands off to the browser: the [Kaitox Chrome extension](https://github.com/kuangjiajia/kaitox-toolkit/tree/main/apps/extension) picks the draft up on \`x.com/compose/articles\` inside your logged-in session and creates the Article draft there. No official API and no keys.

## Install

**From Community plugins** (once listed): Settings → Community plugins → Browse → search **Kaitox**.

**Manual:** download \`main.js\`, \`manifest.json\`, and \`styles.css\` from the [latest release](https://github.com/kuangjiajia/kaitox-obsidian/releases) into your vault at \`.obsidian/plugins/kaitox/\`, then enable **Kaitox** in Settings → Community plugins.

## Build from source

\`\`\`bash
npm install
npm run build     # → dist/main.js, dist/manifest.json, dist/styles.css
\`\`\`

## Source of truth

This repository is generated from the [kaitox-toolkit monorepo](https://github.com/kuangjiajia/kaitox-toolkit) (\`apps/obsidian\`) on each release. Open issues and PRs against the monorepo.

## License

[MIT](LICENSE)
`;
await writeFile(join(target, 'README.md'), readme);

console.log(`✓ projected standalone plugin repo → ${target}`);
