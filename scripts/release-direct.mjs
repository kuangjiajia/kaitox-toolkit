#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultArtifactsDir = join(repoRoot, '.kaitox', 'release');

const usage = `Usage:
  npm run release:direct -- [options]

Publishes the current committed version from main:
  - verifies/builds/packages
  - publishes @kaitox/* packages with changesets
  - creates toolkit GitHub releases for the Chrome extension and Obsidian plugin
  - syncs the Obsidian distribution repo and creates its release

Options:
  --skip-npm              Skip npm package publishing (app releases only).
  --skip-verify           Skip extra local typecheck/test steps. npm publish still runs npm run release.
  --skip-toolkit          Do not create releases in the toolkit repo.
  --skip-obsidian-repo    Do not sync or release the Obsidian distribution repo.
  --replace-assets        If a GitHub release already exists, replace its assets.
  --allow-dirty           Allow uncommitted files in the monorepo.
  --allow-branch          Allow publishing from a branch other than main, and skip origin/main equality.
  --dry-run               Print the publishing actions without mutating files or remotes.
  --artifacts-dir <dir>   Where release zips/staging are written. Default: .kaitox/release
  --toolkit-repo <repo>   GitHub repo for app releases. Default: kuangjiajia/kaitox-toolkit
  --obsidian-repo <repo>  GitHub repo for Obsidian community distribution. Default: kuangjiajia/kaitox-obsidian
  -h, --help              Show this help.
`;

function parseArgs(argv) {
  const options = {
    dryRun: false,
    skipNpm: false,
    skipVerify: false,
    skipToolkit: false,
    skipObsidianRepo: false,
    replaceAssets: false,
    allowDirty: false,
    allowBranch: false,
    artifactsDir: process.env.KAITOX_RELEASE_DIR
      ? resolve(process.env.KAITOX_RELEASE_DIR)
      : defaultArtifactsDir,
    toolkitRepo: process.env.KAITOX_TOOLKIT_REPO ?? 'kuangjiajia/kaitox-toolkit',
    obsidianRepo: process.env.KAITOX_OBSIDIAN_REPO ?? 'kuangjiajia/kaitox-obsidian',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(usage);
      process.exit(0);
    }
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-npm') options.skipNpm = true;
    else if (arg === '--skip-verify') options.skipVerify = true;
    else if (arg === '--skip-toolkit') options.skipToolkit = true;
    else if (arg === '--skip-obsidian-repo') options.skipObsidianRepo = true;
    else if (arg === '--replace-assets') options.replaceAssets = true;
    else if (arg === '--allow-dirty') options.allowDirty = true;
    else if (arg === '--allow-branch') options.allowBranch = true;
    else if (arg === '--artifacts-dir') {
      const value = argv[++i];
      if (!value) die('--artifacts-dir requires a value');
      options.artifactsDir = isAbsolute(value) ? value : resolve(repoRoot, value);
    } else if (arg === '--toolkit-repo') {
      options.toolkitRepo = requireValue(argv, ++i, '--toolkit-repo');
    } else if (arg === '--obsidian-repo') {
      options.obsidianRepo = requireValue(argv, ++i, '--obsidian-repo');
    } else {
      die(`unknown option: ${arg}\n\n${usage}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) die(`${flag} requires a value`);
  return value;
}

function die(message) {
  console.error(`\nrelease failed: ${message}`);
  process.exit(1);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(cmd, args) {
  return [cmd, ...args].map(shellQuote).join(' ');
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function run(cmd, args = [], options = {}) {
  const cwd = options.cwd ?? repoRoot;
  console.log(`$ ${commandLine(cmd, args)}`);
  if (options.dryRun) return '';

  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = options.capture
      ? `\n${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
      : '';
    die(`command failed: ${commandLine(cmd, args)}${detail ? `\n${detail}` : ''}`);
  }
  return options.capture ? (result.stdout ?? '').trim() : '';
}

function tryRun(cmd, args = [], options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function collectVersions() {
  const extensionPkg = await readJson(join(repoRoot, 'apps/extension/package.json'));
  const extensionManifest = await readJson(join(repoRoot, 'apps/extension/manifest.json'));
  const obsidianPkg = await readJson(join(repoRoot, 'apps/obsidian/package.json'));
  const obsidianManifest = await readJson(join(repoRoot, 'apps/obsidian/manifest.json'));
  const obsidianVersions = await readJson(join(repoRoot, 'apps/obsidian/versions.json'));
  const relayProtocolPkg = await readJson(join(repoRoot, 'packages/relay-protocol/package.json'));
  const xArticlePkg = await readJson(join(repoRoot, 'packages/x-article/package.json'));

  assertEqual(
    extensionPkg.version,
    extensionManifest.version,
    'apps/extension package.json and manifest.json versions differ',
  );
  assertEqual(
    obsidianPkg.version,
    obsidianManifest.version,
    'apps/obsidian package.json and manifest.json versions differ',
  );
  if (obsidianVersions[obsidianManifest.version] !== obsidianManifest.minAppVersion) {
    die(
      `apps/obsidian/versions.json must map ${obsidianManifest.version} to ${obsidianManifest.minAppVersion}`,
    );
  }

  assertEqual(
    extensionPkg.dependencies?.['@kaitox/relay-protocol'],
    `^${relayProtocolPkg.version}`,
    'extension @kaitox/relay-protocol dependency does not match package version',
  );
  assertEqual(
    extensionPkg.dependencies?.['@kaitox/x-article'],
    `^${xArticlePkg.version}`,
    'extension @kaitox/x-article dependency does not match package version',
  );
  assertEqual(
    obsidianPkg.dependencies?.['@kaitox/relay-protocol'],
    `^${relayProtocolPkg.version}`,
    'obsidian @kaitox/relay-protocol dependency does not match package version',
  );
  assertEqual(
    obsidianPkg.dependencies?.['@kaitox/x-article'],
    `^${xArticlePkg.version}`,
    'obsidian @kaitox/x-article dependency does not match package version',
  );

  return {
    extension: extensionManifest.version,
    obsidian: obsidianManifest.version,
    relayProtocol: relayProtocolPkg.version,
    xArticle: xArticlePkg.version,
  };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    die(`${message}: expected ${expected}, got ${actual}`);
  }
}

function ensureTool(name, args = ['--version']) {
  const result = tryRun(name, args);
  if (!result.ok) die(`required command not available: ${name}`);
}

function ensureGitReady(options) {
  const status = run('git', ['status', '--porcelain'], { capture: true });
  if (status && !options.allowDirty) {
    die('working tree is dirty; commit or stash changes first, or pass --allow-dirty');
  }

  const branch = run('git', ['branch', '--show-current'], { capture: true });
  if (branch !== 'main' && !options.allowBranch) {
    die(`current branch is ${branch || '(detached)'}, expected main; pass --allow-branch to override`);
  }

  if (!options.allowBranch) {
    run('git', ['fetch', 'origin', 'main']);
    const local = run('git', ['rev-parse', 'HEAD'], { capture: true });
    const remote = run('git', ['rev-parse', 'origin/main'], { capture: true });
    if (local !== remote) {
      die('local HEAD is not origin/main; push or pull before publishing');
    }
  }
}

function ensureAuth(options) {
  run('gh', ['auth', 'status']);
  if (!options.skipNpm && !process.env.NPM_TOKEN) {
    const npmWhoami = tryRun('npm', ['whoami'], { capture: true });
    if (!npmWhoami.ok) {
      die('npm publishing is enabled but npm auth is missing; run npm login, set NPM_TOKEN, or pass --skip-npm');
    }
  }
}

function runVerificationAndBuild(options) {
  if (!options.skipVerify) {
    logStep('Typecheck packages and apps');
    run('npm', ['run', 'typecheck'], { dryRun: options.dryRun });
    run('npm', ['run', 'typecheck', '-w', '@kaitox/extension'], { dryRun: options.dryRun });
    run('npm', ['run', 'typecheck', '-w', '@kaitox/obsidian'], { dryRun: options.dryRun });
    run('git', ['diff', '--check'], { dryRun: options.dryRun });
  }

  if (options.skipNpm) {
    if (!options.skipVerify) {
      logStep('Run full local test suite');
      run('npm', ['run', 'test:all'], { dryRun: options.dryRun });
    }
  } else {
    logStep('Publish npm packages with changesets');
    run('npm', ['run', 'release'], { dryRun: options.dryRun });
  }

  logStep('Build app bundles');
  run('npm', ['run', 'build:extension'], { dryRun: options.dryRun });
  run('npm', ['run', 'build:obsidian'], { dryRun: options.dryRun });
}

async function createArtifacts(options, versions) {
  const artifacts = {
    extensionZip: join(options.artifactsDir, `kaitox-extension-${versions.extension}.zip`),
    obsidianZip: join(options.artifactsDir, `kaitox-obsidian-${versions.obsidian}.zip`),
    obsidianMain: join(repoRoot, 'apps/obsidian/dist/main.js'),
    obsidianManifest: join(repoRoot, 'apps/obsidian/dist/manifest.json'),
    obsidianStyles: join(repoRoot, 'apps/obsidian/dist/styles.css'),
    obsidianReleaseRepoDir: join(options.artifactsDir, 'obsidian-release-repo'),
  };

  logStep('Package app artifacts');
  if (options.dryRun) {
    console.log(`would write ${artifacts.extensionZip}`);
    console.log(`would write ${artifacts.obsidianZip}`);
    return artifacts;
  }

  await rm(options.artifactsDir, { recursive: true, force: true });
  await mkdir(options.artifactsDir, { recursive: true });

  run(
    'zip',
    ['-qr', artifacts.extensionZip, '.', '-x', '*.DS_Store', '__MACOSX/*'],
    { cwd: join(repoRoot, 'apps/extension/dist') },
  );

  const obsidianStage = join(options.artifactsDir, 'obsidian-zip');
  const obsidianFolder = join(obsidianStage, 'kaitox');
  await mkdir(obsidianFolder, { recursive: true });
  await cp(artifacts.obsidianMain, join(obsidianFolder, 'main.js'));
  await cp(artifacts.obsidianManifest, join(obsidianFolder, 'manifest.json'));
  await cp(artifacts.obsidianStyles, join(obsidianFolder, 'styles.css'));
  run(
    'zip',
    ['-qr', artifacts.obsidianZip, 'kaitox', '-x', '*.DS_Store', '__MACOSX/*'],
    { cwd: obsidianStage },
  );

  return artifacts;
}

function releaseNotes(kind, version) {
  if (kind === 'extension') {
    return [
      `Kaitox Chrome extension ${version}.`,
      '',
      'Download the zip, unzip it, then load the unzipped folder in Chrome extensions developer mode.',
    ].join('\n');
  }
  return [
    `Kaitox Obsidian plugin ${version}.`,
    '',
    'Manual install: copy main.js, manifest.json, and styles.css into .obsidian/plugins/kaitox/.',
    'The zip contains the same files inside a ready-to-drop kaitox/ folder.',
  ].join('\n');
}

function releaseExists(repo, tag) {
  return tryRun('gh', ['release', 'view', tag, '--repo', repo], { capture: true }).ok;
}

function upsertRelease({ repo, tag, title, notes, assets, target, options }) {
  const exists = !options.dryRun && releaseExists(repo, tag);
  if (exists && !options.replaceAssets) {
    die(`GitHub release ${repo}:${tag} already exists; pass --replace-assets to update it`);
  }

  if (exists) {
    logStep(`Update GitHub release ${repo}:${tag}`);
    run('gh', ['release', 'edit', tag, '--repo', repo, '--title', title, '--notes', notes], {
      dryRun: options.dryRun,
    });
    run('gh', ['release', 'upload', tag, ...assets, '--repo', repo, '--clobber'], {
      dryRun: options.dryRun,
    });
    return;
  }

  logStep(`Create GitHub release ${repo}:${tag}`);
  const args = ['release', 'create', tag, ...assets, '--repo', repo, '--title', title, '--notes', notes];
  if (target) args.push('--target', target);
  run('gh', args, { dryRun: options.dryRun });
}

function publishToolkitReleases(options, versions, artifacts) {
  if (options.skipToolkit) return;
  const target = run('git', ['rev-parse', 'HEAD'], { capture: true });
  upsertRelease({
    repo: options.toolkitRepo,
    tag: `extension-v${versions.extension}`,
    title: `Kaitox Chrome extension v${versions.extension}`,
    notes: releaseNotes('extension', versions.extension),
    assets: [artifacts.extensionZip],
    target,
    options,
  });
  upsertRelease({
    repo: options.toolkitRepo,
    tag: `obsidian-v${versions.obsidian}`,
    title: `Kaitox Obsidian plugin v${versions.obsidian}`,
    notes: releaseNotes('obsidian', versions.obsidian),
    assets: [
      artifacts.obsidianZip,
      artifacts.obsidianMain,
      artifacts.obsidianManifest,
      artifacts.obsidianStyles,
    ],
    target,
    options,
  });
}

async function syncObsidianRepoAndRelease(options, versions, artifacts) {
  if (options.skipObsidianRepo) return;

  logStep(`Sync Obsidian distribution repo ${options.obsidianRepo}`);
  if (options.dryRun) {
    console.log(`would clone ${options.obsidianRepo} to ${artifacts.obsidianReleaseRepoDir}`);
    console.log(`would project apps/obsidian into ${artifacts.obsidianReleaseRepoDir}`);
  } else {
    await rm(artifacts.obsidianReleaseRepoDir, { recursive: true, force: true });
    run('gh', ['repo', 'clone', options.obsidianRepo, artifacts.obsidianReleaseRepoDir]);
    run('node', ['apps/obsidian/scripts/make-release-repo.mjs', artifacts.obsidianReleaseRepoDir]);
    run('git', ['add', '-A'], { cwd: artifacts.obsidianReleaseRepoDir });
    const status = run('git', ['status', '--porcelain'], {
      cwd: artifacts.obsidianReleaseRepoDir,
      capture: true,
    });
    if (status) {
      run('git', ['commit', '-m', `chore: sync plugin ${versions.obsidian} from monorepo`], {
        cwd: artifacts.obsidianReleaseRepoDir,
      });
      run('git', ['push'], { cwd: artifacts.obsidianReleaseRepoDir });
    } else {
      console.log('distribution repo already up to date');
    }
  }

  upsertRelease({
    repo: options.obsidianRepo,
    tag: versions.obsidian,
    title: versions.obsidian,
    notes: `Kaitox Obsidian plugin ${versions.obsidian}`,
    assets: [artifacts.obsidianMain, artifacts.obsidianManifest, artifacts.obsidianStyles],
    options,
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  logStep('Check release prerequisites');
  ensureTool('git');
  ensureTool('gh');
  ensureTool('npm');
  ensureTool('zip');
  ensureGitReady(options);
  ensureAuth(options);

  const versions = await collectVersions();
  console.log(
    [
      '',
      `extension: ${versions.extension}`,
      `obsidian:  ${versions.obsidian}`,
      `packages:  @kaitox/relay-protocol ${versions.relayProtocol}, @kaitox/x-article ${versions.xArticle}`,
      `toolkit repo:  ${options.toolkitRepo}`,
      `obsidian repo: ${options.obsidianRepo}`,
      `artifacts: ${options.artifactsDir}`,
    ].join('\n'),
  );

  runVerificationAndBuild(options);
  const artifacts = await createArtifacts(options, versions);
  await syncObsidianRepoAndRelease(options, versions, artifacts);
  publishToolkitReleases(options, versions, artifacts);

  logStep('Release complete');
  console.log(
    [
      options.skipToolkit
        ? 'Toolkit releases: skipped'
        : `Chrome extension: ${options.toolkitRepo} release extension-v${versions.extension}`,
      options.skipToolkit
        ? null
        : `Obsidian plugin:  ${options.toolkitRepo} release obsidian-v${versions.obsidian}`,
      options.skipObsidianRepo
        ? 'Obsidian distribution repo: skipped'
        : `Obsidian distribution repo: ${options.obsidianRepo} release ${versions.obsidian}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
