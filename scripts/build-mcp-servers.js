#!/usr/bin/env node
/**
 * Build builtin MCP server scripts as fully self-contained CJS bundles.
 *
 * electron-vite's externalizeDepsPlugin leaves all npm packages as require()
 * calls, which works for Electron's main process (ASAR virtual FS patches
 * require()) but fails when an external `node` process runs the script from
 * app.asar.unpacked — there is no ASAR support there.
 *
 * This script uses esbuild's programmatic API (instead of CLI flags) to avoid
 * shell-quoting issues with special characters in --define values.
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

const SHARED_OPTIONS = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  tsconfig: path.join(ROOT, 'tsconfig.json'),
  loader: { '.wasm': 'empty' },
};

async function main() {
  // The published package already vendors its runtime dependencies. Preserve its
  // ESM/package layout and license so external Node can run it outside ASAR.
  const browserPackage = path.join(ROOT, 'node_modules/chrome-devtools-mcp');
  const browserManifest = JSON.parse(fs.readFileSync(path.join(browserPackage, 'package.json'), 'utf8'));
  if (browserManifest.version !== '0.16.0') throw new Error('Unexpected bundled browser driver version');
  const runtimeRoot = path.resolve(ROOT, 'out/main/browser-runtime');
  if (path.relative(path.resolve(ROOT, 'out/main'), runtimeRoot) !== 'browser-runtime')
    throw new Error('Unsafe browser runtime output path');
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.cpSync(browserPackage, runtimeRoot, { recursive: true, dereference: true });
  console.log(`Bundled browser driver ${browserManifest.version} (no runtime npm dependency)`);
  await Promise.all([
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/imageGenServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-image-gen.js'),
    }),
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/exportToPdfServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-export-pdf.js'),
    }),
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/teamKnowledgeServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-team-knowledge.js'),
    }),
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/browserServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-browser.js'),
    }),
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/webSearchServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-web-search.js'),
    }),
    esbuild.build({
      ...SHARED_OPTIONS,
      entryPoints: [path.join(ROOT, 'packages/desktop/src/process/resources/builtinMcp/pageReaderServer.ts')],
      outfile: path.join(ROOT, 'out/main/builtin-mcp-page-reader.js'),
    }),
  ]);
}

main().catch((err) => {
  console.error('MCP server build failed:', err);
  process.exit(1);
});
