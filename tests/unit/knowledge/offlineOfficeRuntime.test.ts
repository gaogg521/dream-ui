import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startOfficeRuntime } from '@/process/office/runtimeServer';
const directories: string[] = [];
const servers: Array<Awaited<ReturnType<typeof startOfficeRuntime>>> = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'onework-office-test-'));
  directories.push(directory);
  const body = '<html>Office</html>';
  await writeFile(join(directory, 'index.html'), body);
  await writeFile(
    join(directory, 'runtime-manifest.json'),
    JSON.stringify({
      assets: [
        { name: 'index.html', bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') },
      ],
    })
  );
  return directory;
}
describe('offline Office loopback runtime', () => {
  it('serves verified resources with cross-origin isolation and no external connections', async () => {
    const server = await startOfficeRuntime(await fixture());
    servers.push(server);
    const response = await fetch(`${server.url}index.html`);
    expect(await response.text()).toBe('<html>Office</html>');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'");
    expect((await fetch(`${server.url}private.docx`)).status).toBe(404);
    expect((await fetch(`${server.url}constructor`)).status).toBe(404);
    expect((await fetch(`${server.url}index.html`, { method: 'POST' })).status).toBe(404);
  });
  it('rejects altered resources even when the byte length is unchanged', async () => {
    const directory = await fixture();
    await writeFile(join(directory, 'index.html'), '<html>Broken</html>');
    await expect(startOfficeRuntime(directory)).rejects.toThrow('checksum mismatch');
  });
});
