#!/usr/bin/env node
/** Copyright 2026 One Work */
/** The browser driver ships beside this launcher, without npm or network installation at startup. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildMcpSpawnCommand, resolveBridgeToken, resolveBrowserUrl } from './browserServerPort';

const diagnostic = (message: string): void => {
  process.stderr.write(`[builtin-mcp-browser] ${message}\n`);
};
const browserUrl = resolveBrowserUrl({ env: process.env });
const bridgeToken = resolveBridgeToken({ env: process.env });
// Refuse to guess a port or fall back to an invisible standalone Chrome.
if (!browserUrl || !bridgeToken) {
  diagnostic('CDP bridge port or token is unavailable; refusing to start a hidden browser.');
  process.exit(1);
}
const runtimePath = join(__dirname, 'browser-runtime', 'build', 'src', 'index.js');
if (!existsSync(runtimePath)) {
  diagnostic('The bundled browser driver is missing. Reinstall One Work; no package download will be attempted.');
  process.exit(1);
}
const plan = buildMcpSpawnCommand({ nodePath: process.execPath, runtimePath, browserUrl });
const child = spawn(plan.command, plan.args, {
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: 'true' },
});
child.on('error', (error) => {
  diagnostic(`Failed to launch bundled browser driver: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    child.kill(signal);
  });
