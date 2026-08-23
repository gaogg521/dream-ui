import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const {
  verifyBundledAioncoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-aioncore-resources');

const CODEX_ENTRYPOINT = 'node_modules/@agentclientprotocol/codex-acp/dist/index.js';
const CLAUDE_ENTRYPOINT = 'node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js';
const CODEX_WIN32_X64_EXECUTABLE = 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
const CLAUDE_WIN32_X64_EXECUTABLE = 'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe';

function writeFile(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '', { flush: true });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flush: true });
}

function createManagedAcpToolFixture({
  managedResourcesDir,
  toolId,
  version,
  runtimeKey,
  entrypoint,
  platformExecutable,
}: {
  managedResourcesDir: string;
  toolId: string;
  version: string;
  runtimeKey: string;
  entrypoint: string;
  platformExecutable: string;
}) {
  const platformRoot = join(managedResourcesDir, 'acp', toolId, version, runtimeKey);

  writeJson(join(platformRoot, 'manifest.json'), { entrypoint, path_entries: ['node_modules/.bin'] });
  writeFile(join(platformRoot, entrypoint));
  writeJson(join(platformRoot, 'package.json'), {});
  writeJson(join(platformRoot, 'package-lock.json'), {});
  mkdirSync(join(platformRoot, 'node_modules'), { recursive: true });
  mkdirSync(join(platformRoot, 'node_modules', '.bin'), { recursive: true });
  writeFile(join(platformRoot, platformExecutable));

  return platformRoot;
}

function contractTool({
  slug,
  version,
  packageName,
  runtimeKey,
  entrypoint,
  platformExecutable,
}: {
  slug: string;
  version: string;
  packageName: string;
  runtimeKey: string;
  entrypoint: string;
  platformExecutable: string;
}) {
  return {
    slug,
    version,
    packageName,
    root: `acp/${slug}/${version}/${runtimeKey}`,
    platformDirectory: runtimeKey,
    manifest: 'manifest.json',
    entrypoint,
    pathEntries: ['node_modules/.bin'],
    requiredFiles: ['package.json', 'package-lock.json'],
    requiredDirectories: ['node_modules'],
    platformExecutable,
  };
}

function writeManagedResourcesContract(managedResourcesDir: string, runtimeKey = 'win32-x64') {
  writeJson(join(managedResourcesDir, 'manifest.json'), {
    schemaVersion: 1,
    runtimeKey,
    node: {
      version: '24.11.0',
      root: 'node/node-v24.11.0-win-x64',
      executable: 'node.exe',
    },
    acpTools: [
      contractTool({
        slug: 'codex-acp',
        version: '1.1.2',
        packageName: '@agentclientprotocol/codex-acp',
        runtimeKey,
        entrypoint: CODEX_ENTRYPOINT,
        platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
      }),
      contractTool({
        slug: 'claude-agent-acp',
        version: '0.58.1',
        packageName: '@agentclientprotocol/claude-agent-acp',
        runtimeKey,
        entrypoint: CLAUDE_ENTRYPOINT,
        platformExecutable: CLAUDE_WIN32_X64_EXECUTABLE,
      }),
    ],
  });
}

describe('verifyBundledAioncoreResources', () => {
  let tmp: string;
  let resourcesDir: string;
  let managedResourcesDir: string;
  let codexRoot: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'aionui-bundled-resources-'));
    resourcesDir = join(tmp, 'resources');
    managedResourcesDir = join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'managed-resources');

    mkdirSync(join(resourcesDir, 'bundled-aioncore', 'win32-x64'), { recursive: true });
    writeFile(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'aioncore.exe'));
    writeJson(join(resourcesDir, 'bundled-aioncore', 'win32-x64', 'manifest.json'), {
      platform: 'win32',
      arch: 'x64',
    });

    writeFile(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64', 'node.exe'));
    codexRoot = createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'codex-acp',
      version: '1.1.2',
      runtimeKey: 'win32-x64',
      entrypoint: CODEX_ENTRYPOINT,
      platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
    });
    createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'claude-agent-acp',
      version: '0.58.1',
      runtimeKey: 'win32-x64',
      entrypoint: CLAUDE_ENTRYPOINT,
      platformExecutable: CLAUDE_WIN32_X64_EXECUTABLE,
    });
    writeManagedResourcesContract(managedResourcesDir);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when the managed resources contract points to existing resources', () => {
    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.runtimeKey).toBe('win32-x64');
    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('fails when managed resources contract is missing', () => {
    rmSync(join(managedResourcesDir, 'manifest.json'));

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-resources',
        reason: 'missing_file',
      })
    );
  });

  it('fails when only an old Codex ACP version exists even if it is structurally complete', () => {
    rmSync(join(managedResourcesDir, 'acp', 'codex-acp', '1.1.2'), { recursive: true, force: true });
    createManagedAcpToolFixture({
      managedResourcesDir,
      toolId: 'codex-acp',
      version: '0.16.0',
      runtimeKey: 'win32-x64',
      entrypoint: CODEX_ENTRYPOINT,
      platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/acp/codex-acp/1.1.2/win32-x64/manifest.json'
    );
  });

  it('fails when contract node root points to the required version but only a wrong node directory exists', () => {
    rmSync(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64'), { recursive: true, force: true });
    writeFile(join(managedResourcesDir, 'node', 'node-v20.0.0-win-x64', 'node.exe'));

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-aioncore/win32-x64/managed-resources/node/node-v24.11.0-win-x64/node.exe'
    );
  });

  it('ignores unknown contract fields but rejects duplicate tool slugs', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.extraDiagnostic = { ignored: true };
    manifest.acpTools.push({ ...manifest.acpTools[0] });
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'codex-acp',
        reason: 'duplicate_tool_slug',
      })
    );
    expect(result.missing).toContain('bundled-aioncore/win32-x64/managed-resources/manifest.json<contract_failure>');
  });

  it('fails when the contract is invalid JSON', () => {
    writeFileSync(join(managedResourcesDir, 'manifest.json'), '{');

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_json' }));
  });

  it('fails when the contract schema version is unsupported', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    // 2 is a supported version now (native-CLI bundles), so probe with one
    // that genuinely is not.
    manifest.schemaVersion = 99;
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'unsupported_schema_version' }));
  });

  /**
   * Schema v2 adds prepared native agent CLIs under `clis`. It does NOT replace
   * the `acpTools` wrapper layer — this fork spawns sessions through the
   * wrappers, so a v2 bundle carries both and the verifier requires both.
   *
   * Treating `clis` as the wrappers' replacement is what shipped 2.1.51 without
   * an `acp/` subtree, breaking Claude and Codex on every fresh install.
   */
  describe('managed-resources contract v2 (native CLIs alongside ACP wrappers)', () => {
    const writeV2Contract = (overrides: (manifest: Record<string, unknown>) => void = () => {}) => {
      const manifest: Record<string, unknown> = {
        schemaVersion: 2,
        runtimeKey: 'win32-x64',
        node: { version: '24.11.0', root: 'node/node-v24.11.0-win-x64', executable: 'node.exe' },
        acpTools: [
          contractTool({
            slug: 'codex-acp',
            version: '1.1.2',
            packageName: '@agentclientprotocol/codex-acp',
            runtimeKey: 'win32-x64',
            entrypoint: CODEX_ENTRYPOINT,
            platformExecutable: CODEX_WIN32_X64_EXECUTABLE,
          }),
          contractTool({
            slug: 'claude-agent-acp',
            version: '0.58.1',
            packageName: '@agentclientprotocol/claude-agent-acp',
            runtimeKey: 'win32-x64',
            entrypoint: CLAUDE_ENTRYPOINT,
            platformExecutable: CLAUDE_WIN32_X64_EXECUTABLE,
          }),
        ],
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
            executable: 'vendor/x86_64-pc-windows-msvc/bin/codex.exe',
            requiredFiles: [],
            requiredDirectories: ['vendor/x86_64-pc-windows-msvc'],
          },
        ],
      };
      overrides(manifest);
      writeJson(join(managedResourcesDir, 'manifest.json'), manifest);
    };

    const layOutV2Binaries = () => {
      writeFile(join(managedResourcesDir, 'cli', 'claude', '2.1.215', 'win32-x64', 'claude.exe'));
      writeFile(
        join(
          managedResourcesDir,
          'cli',
          'codex',
          '0.144.6',
          'win32-x64',
          'vendor',
          'x86_64-pc-windows-msvc',
          'bin',
          'codex.exe'
        )
      );
    };

    const verify = () =>
      verifyBundledAioncoreResources({ resourcesDir, electronPlatformName: 'win32', targetArch: 'x64' });

    it('passes when every declared CLI is present', () => {
      writeV2Contract();
      layOutV2Binaries();
      expect(verify().failures).toEqual([]);
    });

    /**
     * The exact 2.1.51 bundle: manifest well-formed, both native CLIs present,
     * no ACP wrapper layer. It must not be publishable.
     */
    it('fails when the contract declares no ACP wrappers at all', () => {
      writeV2Contract((manifest) => {
        manifest.acpTools = [];
      });
      layOutV2Binaries();

      const failures = verify().failures;
      expect(failures).toContainEqual(
        expect.objectContaining({ component: 'codex-acp', reason: 'missing_required_tool' })
      );
      expect(failures).toContainEqual(
        expect.objectContaining({ component: 'claude-agent-acp', reason: 'missing_required_tool' })
      );
    });

    it('fails when either ACP wrapper is dropped individually', () => {
      for (const slug of ['codex-acp', 'claude-agent-acp']) {
        writeV2Contract((manifest) => {
          manifest.acpTools = (manifest.acpTools as { slug: string }[]).filter((tool) => tool.slug !== slug);
        });
        layOutV2Binaries();

        expect(verify().failures).toContainEqual(
          expect.objectContaining({ component: slug, reason: 'missing_required_tool' })
        );
      }
    });

    /**
     * A manifest can promise the subtree while the subtree is absent — that is
     * what a stale or partially-copied bundle looks like, and the manifest alone
     * cannot tell you, so the wrapper paths are checked on disk for v2 too.
     */
    it('fails when a declared ACP wrapper is not on disk', () => {
      writeV2Contract();
      layOutV2Binaries();
      rmSync(join(managedResourcesDir, 'acp', 'codex-acp'), { recursive: true, force: true });

      expect(verify().failures).toContainEqual(expect.objectContaining({ component: 'codex-acp' }));
    });

    it('fails when a declared CLI executable is missing', () => {
      writeV2Contract();
      layOutV2Binaries();
      rmSync(join(managedResourcesDir, 'cli', 'claude', '2.1.215', 'win32-x64', 'claude.exe'));

      expect(verify().failures).toContainEqual(
        expect.objectContaining({ component: 'claude', reason: 'missing_file' })
      );
    });

    it('fails when a required directory is missing', () => {
      writeV2Contract();
      layOutV2Binaries();
      rmSync(join(managedResourcesDir, 'cli', 'codex', '0.144.6', 'win32-x64', 'vendor'), {
        recursive: true,
        force: true,
      });

      expect(verify().failures).toContainEqual(expect.objectContaining({ component: 'codex' }));
    });

    it('fails when a required CLI is absent from the contract', () => {
      writeV2Contract((manifest) => {
        manifest.clis = (manifest.clis as unknown[]).filter((cli) => (cli as { name: string }).name !== 'codex');
      });
      layOutV2Binaries();

      expect(verify().failures).toContainEqual(
        expect.objectContaining({ component: 'codex', reason: 'missing_required_cli' })
      );
    });

    it('fails when a CLI was prepared for another platform', () => {
      writeV2Contract((manifest) => {
        (manifest.clis as { platformDirectory: string }[])[0].platformDirectory = 'linux-x64';
      });
      layOutV2Binaries();

      expect(verify().failures).toContainEqual(
        expect.objectContaining({ component: 'claude', reason: 'runtime_key_mismatch' })
      );
    });

    it('rejects a CLI root that escapes the bundle', () => {
      writeV2Contract((manifest) => {
        (manifest.clis as { root: string }[])[0].root = '../../outside';
      });
      layOutV2Binaries();

      expect(verify().failures.some((f) => f.component === 'claude')).toBe(true);
    });
  });

  it('fails when required contract fields have invalid types', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.node.root = 42;
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_schema' }));
  });

  it('fails when a tool platform directory does not match the runtime key', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.acpTools[0].platformDirectory = 'linux-x64';
    writeJson(manifestPath, manifest);

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'runtime_key_mismatch' }));
  });

  it('fails when a local tool manifest entrypoint disagrees with the contract', () => {
    writeJson(join(codexRoot, 'manifest.json'), {
      entrypoint: 'node_modules/@agentclientprotocol/codex-acp/dist/other.js',
      path_entries: ['node_modules/.bin'],
    });

    const result = verifyBundledAioncoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'codex-acp',
        reason: 'manifest_entrypoint_mismatch',
      })
    );
  });
});
