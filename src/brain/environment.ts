import fs from 'fs';
import os from 'os';

export type Environment = 'ai-chat' | 'linux-terminal' | 'termux' | 'unknown';

export interface EnvInfo {
  env: Environment;
  isTTY: boolean;
  hasTermux: boolean;
  platform: string;
  hostname: string;
}

export function detectEnvironment(): EnvInfo {
  const isTTY = process.stdin.isTTY === true;
  const hasTermux =
    fs.existsSync('/data/data/com.termux') ||
    fs.existsSync('/data/user/0/com.termux') ||
    !!process.env.TERMUX_VERSION ||
    (process.env.PREFIX?.includes('com.termux') ?? false);

  const isMcpStdio =
    process.env.MCP_TRANSPORT === 'stdio' ||
    (!isTTY && process.argv.some((a) => a.includes('mcp')));

  let env: Environment = 'unknown';
  if (isMcpStdio) env = 'ai-chat';
  else if (hasTermux && isTTY) env = 'termux';
  else if (isTTY) env = 'linux-terminal';

  return {
    env,
    isTTY,
    hasTermux,
    platform: os.platform(),
    hostname: os.hostname(),
  };
}

export function isInteractive(): boolean {
  const info = detectEnvironment();
  return info.env === 'linux-terminal' || info.env === 'termux';
}
