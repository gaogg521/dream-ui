import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const projectRoot = resolve(__dirname, '../..');
const itWithBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).status === 0 ? it : it.skip;

function readProjectFile(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function yamlBlock(content: string, key: string): string {
  const startMatch = content.match(new RegExp(`^${key}:\\s*$`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';

  const blockStart = startMatch.index + startMatch[0].length;
  const rest = content.slice(blockStart);
  const nextTopLevelKey = rest.search(/^[a-zA-Z][a-zA-Z0-9]*:\s*$/m);
  return nextTopLevelKey === -1 ? rest : rest.slice(0, nextTopLevelKey);
}

describe('release packaging configuration', () => {
  it('keeps mac zip artifacts enabled', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const macBlock = yamlBlock(config, 'mac');

    expect(macBlock).toContain('    - dmg');
    expect(macBlock).toContain('    - zip');
  });

  it('does not build Windows zip artifacts', () => {
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const winBlock = yamlBlock(config, 'win');

    expect(winBlock).toContain('    - nsis');
    expect(winBlock).not.toContain('    - zip');
  });

  it('uploads mac zip artifacts without a stale Windows zip glob', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');

    expect(workflow).toContain('out/*-mac-*.zip');
    expect(workflow).not.toContain('out/AionUi-*-win32-*.zip');
  });

  // Regression guard for a rename that shipped broken: electron-builder emits
  // "One-Work-*", while the upload glob and the release-asset validation both
  // still matched "AionUi-*". The mac zip was therefore never uploaded (killing
  // macOS auto-update) and validation would have reported a missing artifact.
  // It stayed green because the mock fixtures carried the same stale prefix.
  // These assertions pin the pipeline to brand-agnostic matching so the next
  // rename cannot reintroduce it.
  it('matches release artifacts without hardcoding the product-name prefix', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const prepare = readProjectFile('scripts/prepare-release-assets.sh');
    const builderConfig = readProjectFile('packages/desktop/electron-builder.yml');

    const artifactPrefix = builderConfig.match(/artifactName:\s*([\w-]+)-\$\{version\}/)?.[1];
    expect(artifactPrefix).toBeTruthy();

    // Neither matcher may name the product; both must glob on version/arch/ext.
    expect(workflow).not.toMatch(/out\/[A-Za-z][\w-]*-\*-mac-\*\.zip/);
    expect(prepare).toContain('*-${VERSION}-mac-${arch}.${ext}');
    expect(prepare).not.toContain(`${artifactPrefix}-\${VERSION}`);
  });

  // The cleanup step in _build-reusable.yml deletes out/*.zip and out/*.yml when
  // upload_installers_only is on. build-manual.yml used to hardcode it to true,
  // so every manual macOS build shipped a .dmg with no .zip and no
  // latest-mac.yml — i.e. no auto-update — while reporting success. Manual runs
  // are how this fork actually produces mac release assets, so the flag has to
  // stay switchable.
  it('lets manual builds keep updater metadata for release runs', () => {
    const manual = readProjectFile('.github/workflows/build-manual.yml');

    expect(manual).toContain('installers_only:');
    expect(manual).toContain('upload_installers_only: ${{ inputs.installers_only }}');
    expect(manual).not.toMatch(/upload_installers_only:\s*true\s*$/m);
  });

  it('generates mock artifacts under the real product-name prefix', () => {
    // The mock is the only thing the release-asset test sees, so if it drifts
    // from electron-builder's real naming the test proves nothing.
    const mock = readProjectFile('scripts/create-mock-release-artifacts.sh');
    const builderConfig = readProjectFile('packages/desktop/electron-builder.yml');
    const artifactPrefix = builderConfig.match(/artifactName:\s*([\w-]+)-\$\{version\}/)?.[1];

    expect(mock).toContain(`${artifactPrefix}-1.0.0-mac-arm64.zip`);
    expect(mock).not.toContain('AionUi-');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash(
    'fails release asset preparation when a mac zip is missing',
    () => {
      const tempDir = mkdtempSync(resolve(tmpdir(), 'aionui-release-assets-'));
      const artifactsDir = resolve(tempDir, 'build-artifacts');
      const outputDir = resolve(tempDir, 'release-assets');

      try {
        const env = { ...process.env, MOCK_VERSION: '1.0.0' };
        const createResult = spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        });
        expect(createResult.status).toBe(0);

        rmSync(resolve(artifactsDir, 'macos-build-arm64', 'One-Work-1.0.0-mac-arm64.zip'), { force: true });

        const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        });

        expect(prepareResult.status).not.toBe(0);
        expect(`${prepareResult.stdout}\n${prepareResult.stderr}`).toContain('Missing macOS zip artifact');
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
      // Two synchronous bash subprocesses, each of which spawns further
      // processes from inside the shell script. Measured at ~5.7s wall time on
      // this machine with the suite otherwise idle, but `spawnSync` blocks the
      // worker for the whole duration and process creation is the expensive part
      // under Windows (per-process AV scanning), so full-suite parallel load
      // stretches it a long way — it blew the previous 30s budget in a real run.
      // The wait is bounded by definition (both scripts always exit), so this is
      // slowness, not a hang; size the budget off the measured cost with headroom.
    },
    120000
  );
});
