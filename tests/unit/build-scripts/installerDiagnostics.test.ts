import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yauzl from 'yauzl';

const roots: string[] = [];
const script = resolve(__dirname, '../../../resources/windows/support/show-installer-failure.ps1');
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'onework-diagnostics-'));
  roots.push(root);
  return root;
}

function collect(root: string, extra: string[] = []) {
  return spawnSync(
    powershell,
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Code',
      'E1010',
      '-Detail',
      'extract method=zip-7za exitCode=2',
      '-Release',
      '3.0.16-qa',
      '-Arch',
      'x64',
      '-Session',
      'qa-session',
      '-InstallDir',
      "C:\\QA\\O'Work\\项目",
      '-OutputDirectory',
      join(root, 'reports'),
      '-NoUi',
      ...extra,
    ],
    { encoding: 'utf8', timeout: 30000 }
  );
}

async function readArchive(file: string): Promise<Record<string, string>> {
  return new Promise((resolveArchive, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const files: Record<string, string> = {};
      zip.on('error', reject);
      zip.on('end', () => resolveArchive(files));
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError);
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            files[entry.fileName] = Buffer.concat(chunks)
              .toString('utf8')
              .replace(/^\uFEFF/, '');
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('Windows installer diagnostic collection', () => {
  it('exports the failing session and extractor error with a verifiable installer identity', async () => {
    const root = fixture();
    const log = join(root, 'session.jsonl');
    const extract = join(root, 'extract.txt');
    const installer = join(root, 'installer.exe');
    writeFileSync(
      log,
      [
        { session: 'qa-session', event: 'extract-start' },
        { session: 'another-session', message: 'UNRELATED_ATTEMPT' },
        { session: 'qa-session', event: 'session-end', code: 'E1010' },
      ]
        .map((event) => JSON.stringify(event))
        .join('\n')
    );
    writeFileSync(extract, 'ERROR: Cannot open output file C:\\QA\\output.js\r\nAccess is denied', 'utf16le');
    writeFileSync(installer, 'known installer fixture');
    const result = collect(root, ['-LogPath', log, '-ExtractLogPath', extract, '-InstallerPath', installer]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const files = await readArchive(result.stdout);
    const diagnostics = JSON.parse(files['diagnostics.json']);
    expect(diagnostics).toMatchObject({
      code: 'E1010',
      sessionEventCount: 2,
      installDirectory: "C:\\QA\\O'Work\\项目",
    });
    expect(diagnostics.extractorOutput).toContain('Cannot open output file C:\\QA\\output.js');
    expect(diagnostics.installer.sha256.toLowerCase()).toBe(
      createHash('sha256').update(readFileSync(installer)).digest('hex')
    );
    expect(files['installer-session.jsonl']).not.toContain('UNRELATED_ATTEMPT');
    expect(Object.keys(files).sort()).toEqual([
      'diagnostics.json',
      'extractor-output.txt',
      'installer-session.jsonl',
      'report.txt',
    ]);
  });

  it('still records the failure when the original installer log is unavailable', async () => {
    const root = fixture();
    const result = collect(root, ['-LogPath', join(root, 'missing.jsonl')]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const files = await readArchive(result.stdout);
    expect(JSON.parse(files['diagnostics.json'])).toMatchObject({ code: 'E1010', sessionEventCount: 0 });
    expect(files['report.txt']).toContain('extract method=zip-7za exitCode=2');
  });

  it('passes the archive path to NSIS as UTF-16 without console encoding or newline changes', async () => {
    const root = fixture();
    const resultPath = join(root, '诊断路径.txt');
    const result = collect(root, ['-ResultPath', resultPath]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const archive = readFileSync(resultPath, 'utf16le').replace(/^\uFEFF/, '');
    expect(result.stdout).toBe('');
    expect(Object.keys(await readArchive(archive))).toContain('diagnostics.json');
  });

  it('returns a distinct collection failure so the installer can show its native fallback', () => {
    const root = fixture();
    writeFileSync(join(root, 'reports'), 'occupied by a file');
    const result = collect(root);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('Diagnostic collection failed:');
  });
});
