/** 风格报告的终端打印与交互式询问。 */
import { createInterface } from 'node:readline';
import type { StyleReport } from '@kaitox/core';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  bold: '\x1b[1m',
};

const SEV_COLOR = { error: C.red, warning: C.yellow, info: C.cyan } as const;
const SEV_LABEL = { error: '错误', warning: '警告', info: '提示' } as const;

export function printReport(report: StyleReport): void {
  const { counts } = report;
  if (report.issues.length === 0) {
    console.log(`${C.green}✓ 风格检查通过，对 X Article 友好。${C.reset}`);
    return;
  }
  console.log(
    `\n风格检查：${C.red}${counts.error} 错误${C.reset} · ${C.yellow}${counts.warning} 警告${C.reset} · ${C.cyan}${counts.info} 提示${C.reset}`,
  );
  for (const i of report.issues) {
    const color = SEV_COLOR[i.severity];
    const loc = i.line ? `${C.dim}L${i.line}${C.reset} ` : '';
    console.log(`  ${color}[${SEV_LABEL[i.severity]}]${C.reset} ${loc}${i.message}`);
    if (i.suggestion) console.log(`        ${C.dim}↳ ${i.suggestion}${C.reset}`);
  }
  console.log('');
}

export type Decision = 'fix' | 'plaintext' | 'upload';

/** 不友好时询问用户：修改 / 纯文本兜底 / 仍按原样上传。 */
export async function promptDecision(): Promise<Decision> {
  if (!process.stdin.isTTY) {
    // 非交互环境：默认不擅自上传，提示用户显式选择。
    throw new Error(
      '内容对 X 不够友好。非交互环境请显式加参数：--plaintext（纯文本兜底）或 --force（原样上传）。',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = await new Promise<string>((resolve) =>
      rl.question(
        `${C.bold}如何处理？${C.reset} [${C.cyan}f${C.reset}]先去改 / [${C.yellow}p${C.reset}]纯文本兜底上传 / [${C.green}u${C.reset}]原样上传 (默认 f)：`,
        resolve,
      ),
    );
    const a = ans.trim().toLowerCase();
    if (a === 'p' || a === 'plaintext') return 'plaintext';
    if (a === 'u' || a === 'upload' || a === 'force') return 'upload';
    return 'fix';
  } finally {
    rl.close();
  }
}
