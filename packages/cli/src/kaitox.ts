#!/usr/bin/env node
/**
 * kaitox — local publishing platform CLI.
 *
 * Commands are grouped by feature namespace so new features slot in as
 * `kaitox <feature> <action>`:
 *
 *   kaitox x push|list|status   X (Twitter) Article publishing
 *   kaitox relay ...            local relay lifecycle (infrastructure)
 *
 * Legacy top-level aliases (push/list/status) delegate to `kaitox x ...`
 * with a deprecation note; they will not be removed before 1.0.
 */
import { createRequire } from 'node:module';
import { runX, ARTICLES_URL } from './commands/x.js';
import { runRelay } from './commands/relay.js';

/** Feature-namespace dispatch table. Adding a feature = one entry here. */
const FEATURES: Record<string, (args: string[]) => Promise<void>> = {
  x: runX,
};

/** Legacy top-level commands that now live under `kaitox x`. */
const X_ALIASES = new Set(['push', 'list', 'status']);

function cliVersion(): string {
  try {
    return createRequire(import.meta.url)('../package.json').version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === undefined || cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
    return;
  }
  if (cmd === '-v' || cmd === '--version') {
    console.log(cliVersion());
    return;
  }
  if (cmd === 'relay') {
    await runRelay(argv.slice(1));
    return;
  }
  const feature = FEATURES[cmd];
  if (feature) {
    await feature(argv.slice(1));
    return;
  }
  if (X_ALIASES.has(cmd)) {
    console.error(`note: "kaitox ${cmd}" is deprecated, use "kaitox x ${cmd}"`);
    await runX(argv);
    return;
  }
  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`kaitox — local publishing platform CLI (v${cliVersion()})

Usage:
  kaitox <feature> <action> [options]
  kaitox relay ...

Features:
  x         X (Twitter) Article publishing — see \`kaitox x --help\`
            push / list / status

Infrastructure:
  kaitox relay [--daemon]     run the local relay (foreground / background)
  kaitox relay stop           stop the background relay
  kaitox relay status         show relay status

Aliases (deprecated):
  kaitox push|list|status     → kaitox x push|list|status

After pushing: open ${ARTICLES_URL} and use the kaitox browser extension
to upload pending drafts.`);
}

main().catch((err) => {
  console.error('出错：', err?.message ?? err);
  process.exit(1);
});
