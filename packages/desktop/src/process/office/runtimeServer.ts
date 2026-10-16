import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';

const types: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'office-input.js': 'text/javascript; charset=utf-8',
  'office-host.js': 'text/javascript; charset=utf-8',
  'office-thread.js': 'text/javascript; charset=utf-8',
  'soffice.js': 'text/javascript; charset=utf-8',
  'zeta.js': 'text/javascript; charset=utf-8',
  'soffice.wasm': 'application/wasm',
  'soffice.data': 'application/octet-stream',
  'soffice.data.js.metadata': 'application/json',
  'NotoSansCJKsc-Regular.otf': 'font/otf',
};

export async function startOfficeRuntime(directory: string): Promise<{ url: string; close: () => Promise<void> }> {
  const manifestBytes = await readFile(join(directory, 'runtime-manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString()) as {
    assets: Array<{ name: string; bytes: number; sha256: string }>;
  };
  for (const asset of manifest.assets) {
    if (!/^[A-Za-z0-9._-]+$/.test(asset.name) || (await stat(join(directory, asset.name))).size !== asset.bytes) {
      throw new Error('Offline Office runtime is incomplete');
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(join(directory, asset.name))) hash.update(chunk);
    if (hash.digest('hex') !== asset.sha256) throw new Error('Offline Office runtime checksum mismatch');
  }
  const version = createHash('sha256').update(manifestBytes).digest('hex').slice(0, 16);
  const prefix = `/${version}/`;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const name = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
    if (!Object.hasOwn(types, name) || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Qt's WASM-to-JS bridge constructs JavaScript wrappers at runtime.
    // This policy applies only to the hash-verified, sandboxed engine view;
    // user documents arrive via IPC and all external network access is blocked.
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'"
    );
    response.setHeader('Content-Type', types[name]);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(join(directory, name));
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Office runtime did not bind to loopback');
  return {
    url: `http://127.0.0.1:${address.port}${prefix}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
