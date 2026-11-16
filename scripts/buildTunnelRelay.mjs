#!/usr/bin/env node
/**
 * Bundle the remote-access relay (packages/desktop/src/process/services/remoteTunnel/relay)
 * into one self-contained file for the public server: `outputs/tunnel-relay/relay.mjs`.
 * The server only needs `node` (>= 20); `ws` is bundled in.
 *
 *   node scripts/buildTunnelRelay.mjs
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'outputs/tunnel-relay/relay.mjs');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(root, 'packages/desktop/src/process/services/remoteTunnel/relay/main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Optional native accelerators of `ws`; it falls back to pure JS without them.
  external: ['bufferutil', 'utf-8-validate'],
  // `ws` is CommonJS and uses require() for node builtins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
console.log(`relay bundle: ${outfile} (${(statSync(outfile).size / 1024).toFixed(0)} KiB)`);
