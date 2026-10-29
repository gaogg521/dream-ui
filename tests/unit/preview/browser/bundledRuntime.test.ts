import { it, expect } from 'vitest';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

it('cold-starts the shipped browser driver without npm, npx, PATH or a project node_modules directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'one-work-browser-offline-qa & space-'));
  const client = new Client({ name: 'one-work-offline-qa', version: '1.0.0' }, { capabilities: {} });
  try {
    await build({
      entryPoints: [resolve('packages/desktop/src/process/resources/builtinMcp/browserServer.ts')],
      outfile: join(directory, 'builtin-mcp-browser.js'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
    });
    await cp(resolve('node_modules/chrome-devtools-mcp'), join(directory, 'browser-runtime'), {
      recursive: true,
      dereference: true,
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(directory, 'builtin-mcp-browser.js')],
      cwd: directory,
      env: {
        PATH: '',
        NODE_PATH: '',
        npm_config_offline: 'true',
        npm_config_registry: 'http://127.0.0.1:1',
        DREAM_CDP_ACTIVE_PORT: '65530',
        DREAM_CDP_BRIDGE_TOKEN: 'offline-probe',
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: 'true',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      stderr: 'pipe',
    });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === 'navigate_page')).toBe(true);
    expect(tools.tools.some((tool) => tool.name === 'take_snapshot')).toBe(true);
  } finally {
    await client.close();
    // mkdtemp owns this exact directory under the OS temp folder.
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory).startsWith('one-work-browser-offline-qa & space-')).toBe(true);
    await rm(directory, { recursive: true, force: true });
  }
  // Spawns a real Node process and bundles with esbuild first; the whole suite runs this next to hundreds of
  // workers, where 15 s was not enough.
}, 60000);
