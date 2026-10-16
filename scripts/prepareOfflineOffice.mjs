/** Prepare the pinned browser Office engine for offline desktop use. */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'resources', 'offline-office');
const manifest = JSON.parse(await readFile(join(root, 'scripts', 'offline-office-manifest.json'), 'utf8'));
const verifyOnly = process.argv.includes('--verify');
const hostOnly = process.argv.includes('--host-only');

async function digest(path) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), bytes };
}

await mkdir(target, { recursive: true });
for (const asset of manifest.assets) {
  if (!/^[A-Za-z0-9._-]+$/.test(asset.name) || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error('Invalid offline Office resource manifest');
  }
  if (hostOnly) continue;
  const destination = join(target, asset.name);
  let cached;
  try {
    cached = await digest(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cached?.sha256 === asset.sha256 && cached.bytes === asset.bytes) {
    console.log(`Office resource verified: ${asset.name}`);
    continue;
  }
  if (verifyOnly) throw new Error(`Offline Office resource missing or invalid: ${asset.name}`);
  const url = new URL(asset.url);
  if (
    url.protocol !== 'https:' ||
    !['cdn.zetaoffice.net', 'raw.githubusercontent.com', 'cdn.jsdelivr.net'].includes(url.hostname)
  ) {
    throw new Error('Unapproved Office resource origin');
  }
  const temporary = join(target, `${asset.name}.download-${process.pid}`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error(`Office resource download failed: ${response.status}`);
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(received > asset.bytes ? new Error('Office resource exceeded its pinned size') : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(temporary, { flags: 'wx' }));
    const downloaded = await digest(temporary);
    if (downloaded.sha256 !== asset.sha256 || downloaded.bytes !== asset.bytes) {
      throw new Error(`Office resource checksum mismatch: ${asset.name}`);
    }
    await copyFile(temporary, destination);
    console.log(`Office resource prepared: ${asset.name}`);
  } finally {
    await rm(temporary, { force: true });
  }
}

const runtimeAssets = [...manifest.assets];
for (const name of ['index.html', 'office-host.js', 'office-thread.js', 'office-input.js']) {
  const source = join(root, 'packages/desktop/src/process/office/runtime', name);
  const expected = await digest(source);
  const destination = join(target, name);
  if (verifyOnly) {
    const actual = await digest(destination);
    if (actual.sha256 !== expected.sha256) throw new Error(`Office host is outdated: ${name}`);
  } else await copyFile(source, destination);
  runtimeAssets.push({ name, ...expected });
}
const runtimeManifest = JSON.stringify({
  assets: runtimeAssets.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
});
if (!verifyOnly) await writeFile(join(target, 'runtime-manifest.json'), runtimeManifest);
else if ((await readFile(join(target, 'runtime-manifest.json'), 'utf8')) !== runtimeManifest)
  throw new Error('Office runtime manifest is outdated');
