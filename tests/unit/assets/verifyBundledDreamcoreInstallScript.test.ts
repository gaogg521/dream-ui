import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptPath = 'resources/windows/support/verify-bundled-dreamcore-install.ps1';
const script = readFileSync(scriptPath, 'utf8');

function writeFile(filePath: string, contents = '') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeJson(filePath: string, value: unknown) {
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const ACP_WRAPPERS = [
  { slug: 'codex-acp', version: '1.1.2', packageName: '@agentclientprotocol/codex-acp' },
  { slug: 'claude-agent-acp', version: '0.58.1', packageName: '@agentclientprotocol/claude-agent-acp' },
] as const;

function acpToolContracts(runtimeKey = 'win32-x64') {
  return ACP_WRAPPERS.map(({ slug, version, packageName }) => ({
    slug,
    version,
    packageName,
    root: `acp/${slug}/${version}/${runtimeKey}`,
    platformDirectory: runtimeKey,
    manifest: 'manifest.json',
    entrypoint: `node_modules/${packageName}/dist/index.js`,
    pathEntries: ['node_modules/.bin'],
    requiredFiles: ['package.json', 'package-lock.json'],
    requiredDirectories: ['node_modules'],
    platformExecutable: `node_modules/.bin/${slug}.cmd`,
  }));
}

function layOutAcpWrappers(managedRoot: string, runtimeKey = 'win32-x64') {
  for (const tool of acpToolContracts(runtimeKey)) {
    const root = join(managedRoot, ...tool.root.split('/'));
    writeJson(join(root, tool.manifest), { entrypoint: tool.entrypoint, pathEntries: tool.pathEntries });
    writeFile(join(root, ...tool.entrypoint.split('/')), 'x');
    writeFile(join(root, ...tool.platformExecutable.split('/')), 'x');
    for (const required of tool.requiredFiles) {
      writeFile(join(root, ...required.split('/')), '{}');
    }
    for (const required of tool.requiredDirectories) {
      mkdirSync(join(root, ...required.split('/')), { recursive: true });
    }
  }
}

describe('Windows bundled aioncore install verifier', () => {
  it('reads managed resources manifest instead of deriving Codex platform paths', () => {
    expect(script).toContain("Join-Path $managedRoot 'manifest.json'");
    expect(script).toContain('schemaVersion');
    expect(script).toContain('$Cli.executable');
    expect(script).not.toContain('Get-CodexPlatformExecutable');
    expect(script).not.toContain('x86_64-pc-windows-msvc');
  });

  it('logs machine-readable contract failures', () => {
    expect(script).toContain('duplicate_cli_name');
    expect(script).toContain('unsupported_schema_version');
    expect(script).toContain('invalid_schema');
    expect(script).toContain('result=fail runtime=$RuntimeKey failures=$summary');
  });

  it('requires numeric schemaVersion without PowerShell string coercion', () => {
    expect(script).toContain("Test-NumberField $contract 'schemaVersion'");
    expect(script).not.toContain('if ($contract.schemaVersion -ne 2)');
  });

  const runOnWindows = process.platform === 'win32' ? it : it.skip;

  runOnWindows('fails an old-version-only Codex CLI install directory', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-install-verify-'));
    const installDir = join(tmp, 'install');
    const managedRoot = join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'managed-resources');
    const logPath = join(tmp, 'verify.log');
    const codexTriple = 'x86_64-pc-windows-msvc';

    try {
      writeFile(join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'dreamcore.exe'), 'x');
      writeJson(join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'manifest.json'), {
        platform: 'win32',
        arch: 'x64',
      });
      writeFile(join(managedRoot, 'node', 'node-v24.11.0-win-x64', 'node.exe'), 'x');
      // claude is present at its pinned version.
      writeFile(join(managedRoot, 'cli', 'claude', '2.1.215', 'win32-x64', 'claude.exe'), 'x');
      // Both ACP wrappers are laid out correctly, so the only defect this case
      // exercises is the stale codex CLI version.
      layOutAcpWrappers(managedRoot);
      writeJson(join(managedRoot, 'manifest.json'), {
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: {
          version: '24.11.0',
          root: 'node/node-v24.11.0-win-x64',
          executable: 'node.exe',
        },
        acpTools: acpToolContracts(),
        clis: [
          {
            name: 'claude',
            version: '2.1.215',
            root: 'cli/claude/2.1.215/win32-x64',
            platformDirectory: 'win32-x64',
            executable: 'claude.exe',
            requiredFiles: [],
            requiredDirectories: [],
          },
          {
            name: 'codex',
            version: '0.144.6',
            root: 'cli/codex/0.144.6/win32-x64',
            platformDirectory: 'win32-x64',
            executable: `vendor/${codexTriple}/bin/codex.exe`,
            requiredFiles: [],
            requiredDirectories: [`vendor/${codexTriple}`],
          },
        ],
      });

      // Only an OLD codex version exists on disk; the contract pins 0.144.6.
      const oldRoot = join(managedRoot, 'cli', 'codex', '0.100.0', 'win32-x64');
      writeFile(join(oldRoot, 'vendor', codexTriple, 'bin', 'codex.exe'), 'x');

      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-InstallDir',
          installDir,
          '-RuntimeKey',
          'win32-x64',
          '-LogPath',
          logPath,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('cli/codex/0.144.6');
      expect(log).toContain('result=fail');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  /**
   * The 2.1.51 shape: every native CLI in place, no ACP wrapper layer. The
   * installed app cannot start Claude or Codex in that state, so the installer's
   * own integrity check has to call it out rather than report a healthy install.
   */
  runOnWindows('fails a v2 install whose ACP wrapper layer is absent', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aionui-install-verify-acp-'));
    const installDir = join(tmp, 'install');
    const managedRoot = join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'managed-resources');
    const logPath = join(tmp, 'verify.log');
    const codexTriple = 'x86_64-pc-windows-msvc';

    try {
      writeFile(join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'dreamcore.exe'), 'x');
      writeJson(join(installDir, 'resources', 'bundled-dreamcore', 'win32-x64', 'manifest.json'), {
        platform: 'win32',
        arch: 'x64',
      });
      writeFile(join(managedRoot, 'node', 'node-v24.11.0-win-x64', 'node.exe'), 'x');
      writeFile(join(managedRoot, 'cli', 'claude', '2.1.215', 'win32-x64', 'claude.exe'), 'x');
      writeFile(
        join(managedRoot, 'cli', 'codex', '0.144.6', 'win32-x64', 'vendor', codexTriple, 'bin', 'codex.exe'),
        'x'
      );
      // Deliberately no acpTools and no acp/ subtree.
      writeJson(join(managedRoot, 'manifest.json'), {
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: { version: '24.11.0', root: 'node/node-v24.11.0-win-x64', executable: 'node.exe' },
        clis: [
          {
            name: 'claude',
            version: '2.1.215',
            root: 'cli/claude/2.1.215/win32-x64',
            platformDirectory: 'win32-x64',
            executable: 'claude.exe',
            requiredFiles: [],
            requiredDirectories: [],
          },
          {
            name: 'codex',
            version: '0.144.6',
            root: 'cli/codex/0.144.6/win32-x64',
            platformDirectory: 'win32-x64',
            executable: `vendor/${codexTriple}/bin/codex.exe`,
            requiredFiles: [],
            requiredDirectories: [`vendor/${codexTriple}`],
          },
        ],
      });

      const result = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-InstallDir',
          installDir,
          '-RuntimeKey',
          'win32-x64',
          '-LogPath',
          logPath,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).not.toBe(0);
      expect(readFileSync(logPath, 'utf8')).toContain('result=fail');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
