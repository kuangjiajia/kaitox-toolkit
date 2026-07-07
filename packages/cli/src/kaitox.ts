#!/usr/bin/env node
/**
 * kaitox — CLI of the Kaitox personal toolkit.
 *
 * Commands are grouped by feature namespace so new features slot in as
 * `kaitox <feature> <action>`:
 *
 *   kaitox x push|list|status   X (Twitter) Article publishing
 *   kaitox relay ...            local relay lifecycle (infrastructure)
 */
import { createRequire } from 'node:module';
import { runX, ARTICLES_URL } from './commands/x.js';
import { runRelay } from './commands/relay.js';

interface Command {
  run: (args: string[]) => Promise<void>;
  /** One-line summary shown in `kaitox help` (generated — cannot drift). */
  summary: string;
}

/** Feature-namespace dispatch table. Adding a feature = one entry here. */
const FEATURES: Record<string, Command> = {
  x: { run: runX, summary: 'X (Twitter) Article publishing — push / list / status' },
};

/** Infrastructure commands — not features, but dispatched the same way. */
const INFRA: Record<string, Command> = {
  relay: { run: runRelay, summary: 'local relay lifecycle — [--daemon] / stop / restart / status' },
};

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
  const command = FEATURES[cmd] ?? INFRA[cmd];
  if (command) {
    await command.run(argv.slice(1));
    return;
  }
  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  const rows = (table: Record<string, Command>) =>
    Object.entries(table)
      .map(([name, c]) => `  ${name.padEnd(10)}${c.summary}`)
      .join('\n');
  console.log(`kaitox — personal toolkit CLI (v${cliVersion()})

Usage:
  kaitox <feature> <action> [options]
  kaitox relay ...

Features:
${rows(FEATURES)}

Infrastructure:
${rows(INFRA)}

After pushing: open ${ARTICLES_URL} and use the kaitox browser extension
to upload pending drafts.`);
}

main().catch((err) => {
  console.error('出错：', err?.message ?? err);
  process.exit(1);
});
