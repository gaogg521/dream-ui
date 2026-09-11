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
  it('keeps electronLanguages in sync with the UI languages the app ships', () => {
    // Chromium's native surfaces (context menu, spellcheck, IME candidate
    // window) are localized by the locale paks electronLanguages keeps. Adding a
    // UI language without adding it here leaves those users with a translated
    // app and an English right-click menu — invisible to anyone testing in
    // Chinese or English.
    const config = readProjectFile('packages/desktop/electron-builder.yml');
    const declared = new Set(
      yamlBlock(config, 'electronLanguages')
        .split(String.fromCharCode(10))
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim())
    );
    const supported: string[] = JSON.parse(
      readProjectFile('packages/desktop/src/common/config/i18n-config.json')
    ).supportedLanguages;

    expect(supported.length).toBeGreaterThan(0);
    expect(supported.filter((language) => !declared.has(language))).toEqual([]);
  });

  it('keeps the zip payload and differential packaging from being set together', () => {
    // NsisTarget reads `!isBuildDifferentialAware && options.useZip`: the two
    // are mutually exclusive, and setting both does not warn — differential
    // wins and the zip payload is silently dropped, taking a Windows install
    // from ~109s back to 238-334s with nothing reporting it.
    const nsis = yamlBlock(readProjectFile('packages/desktop/electron-builder.yml'), 'nsis');
    const useZip = /^\s*useZip:\s*true\s*$/m.test(nsis);
    const differential = /^\s*differentialPackage:\s*true\s*$/m.test(nsis);

    expect(useZip && differential, 'useZip and differentialPackage cannot both be on').toBe(false);

    // Whichever is on, the release script has to agree with it: a blockmap
    // only exists when differential packaging is, and demanding one otherwise
    // fails every release.
    const prepare = readProjectFile('scripts/prepare-release-assets.sh');
    expect(prepare.includes('Missing blockmap for')).toBe(differential);
  });

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
    expect(workflow).not.toContain('out/Dream UI-*-win32-*.zip');
  });

  // Regression guard for a rename that shipped broken: electron-builder emits
  // "One-Work-*", while the upload glob and the release-asset validation both
  // still matched "Dream UI-*". The mac zip was therefore never uploaded (killing
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
    expect(mock).not.toContain('Dream UI-');
  });

  it('retries mac prepackaged builds with both dmg and zip targets', () => {
    const script = readProjectFile('scripts/build-with-builder.js');

    expect(script).toMatch(/--mac\s+dmg\s+zip\s+--\$\{targetArch\}\s+--prepackaged/);
  });

  itWithBash(
    'succeeds on a complete set of release artifacts',
    () => {
      // The only other end-to-end test here removes an artifact and asserts the
      // script fails, so it stays green no matter how many NEW ways the script
      // learns to fail. That gap shipped a release-breaking change once: adding
      // the blockmap check without adding blockmaps to the mock artifacts (or to
      // the CI upload list) made every real release exit non-zero here, and
      // nothing caught it. This is the positive half.
      const tempDir = mkdtempSync(resolve(tmpdir(), 'dream-release-assets-ok-'));
      const artifactsDir = resolve(tempDir, 'build-artifacts');
      const outputDir = resolve(tempDir, 'release-assets');

      try {
        const env = { ...process.env, MOCK_VERSION: '1.0.0' };
        expect(
          spawnSync('bash', ['scripts/create-mock-release-artifacts.sh', artifactsDir], {
            cwd: projectRoot,
            env,
            encoding: 'utf8',
          }).status
        ).toBe(0);

        const prepareResult = spawnSync('bash', ['scripts/prepare-release-assets.sh', artifactsDir, outputDir], {
          cwd: projectRoot,
          env,
          encoding: 'utf8',
        });

        expect(`${prepareResult.stdout}
${prepareResult.stderr}`).not.toContain('::error::');
        expect(prepareResult.status).toBe(0);
      } finally {
        rmSync(tempDir, { force: true, recursive: true });
      }
    },
    120000
  );

  itWithBash(
    'fails release asset preparation when a mac zip is missing',
    () => {
      const tempDir = mkdtempSync(resolve(tmpdir(), 'dream-release-assets-'));
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
  /**
   * `scripts/pack-web-cli.js` owns the staging layout; `Dockerfile` and
   * `scripts/smoke-test-docker.sh` each hardcode the same two paths
   * independently. When the executable was renamed aionui-web -> dream-web
   * (and aioncore -> dreamcore), the pack script and the Dockerfile were
   * updated and the smoke test was not, so it aborted on a directory that no
   * longer existed:
   *
   *   dist-web-cli/staging/aionui-web not found - run pack-web-cli.js first
   *
   * That is a red `Pack web-cli linux-x64` job on EVERY release tag, and it
   * had been red since v3.0.0 - v3.0.1, v3.0.2 and v3.0.3 each failed there
   * and nowhere else, taking `Create Release` (which needs the whole pipeline
   * green) down with it. The tarball itself built fine every time; only the
   * check after it was looking in the wrong place.
   *
   * Pinning the three files to each other is what makes the next rename a
   * failing test instead of a failing release.
   */
  it('keeps the web-cli staging layout agreed across pack script, Dockerfile and smoke test', () => {
    const pack = readProjectFile('scripts/pack-web-cli.js');
    const dockerfile = readProjectFile('Dockerfile');
    const smoke = readProjectFile('scripts/smoke-test-docker.sh');

    // The one place the name is decided.
    const stagingName = pack.match(/path\.join\(stagingDir,\s*'([^']+)'\)/)?.[1];
    expect(stagingName).toBeTruthy();

    // Both consumers must name that exact directory.
    expect(dockerfile).toContain(`dist-web-cli/staging/${stagingName}/`);
    expect(smoke).toContain(`dist-web-cli/staging/${stagingName}"`);

    // And both must reach the backend binary by the same in-container path.
    const backendDir = pack.match(/'(bundled-[a-z]+)'/)?.[1];
    expect(backendDir).toBeTruthy();
    expect(dockerfile).toContain(`./${backendDir}/linux-x64/`);
    expect(smoke).toContain(`./${backendDir}/linux-x64/`);

    // Guards the guard: the pre-rename names must not still be reachable.
    expect(`${dockerfile}
${smoke}`).not.toMatch(/aionui-web|bundled-aioncore/);
  });
});

/**
 * Windows code signing is deliberately not configured. What matters is that the
 * build does not *pretend* it is.
 *
 * The Windows step's env block was copied from the macOS one, `IDENTITY` and
 * all. On Windows `CSC_NAME` becomes `win.certificateSubjectName`, so
 * electron-builder went looking for a certificate with an Apple Developer ID
 * subject and invoked signtool — the build log read "signing with signtool.exe"
 * while the artifact came out NotSigned, which is the worst of both: no
 * signature, and a log that says otherwise.
 */
describe('Windows signing configuration', () => {
  const windowsBuildStepEnv = (): string => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');
    // From the Windows build step's `env:` up to the next step (`- name:`).
    const step = workflow.slice(workflow.indexOf('Build with electron-builder (Windows)'));
    const env = step.slice(step.indexOf('env:'));
    const end = env.indexOf('\n      - name:');
    return end === -1 ? env : env.slice(0, end);
  };

  it('hands the Windows build no signing identity at all', () => {
    const env = windowsBuildStepEnv();

    // A macOS Developer ID is not a Windows certificate subject, and offering
    // one only makes electron-builder attempt a signature it cannot produce.
    expect(env).not.toMatch(/^\s*CSC_NAME:/m);
    expect(env).not.toMatch(/^\s*CSC_LINK:/m);
    expect(env).not.toMatch(/^\s*identity:/m);
    // Explicitly off rather than merely unset, so nothing goes hunting for one.
    expect(env).toMatch(/^\s*CSC_IDENTITY_AUTO_DISCOVERY:\s*false\s*$/m);
  });

  it('leaves the macOS build signing, which it really does', () => {
    const workflow = readProjectFile('.github/workflows/_build-reusable.yml');
    const macStep = workflow.slice(workflow.indexOf('Build with electron-builder (macOS)'));

    expect(macStep.slice(0, macStep.indexOf('\n      - name:'))).toMatch(
      /CSC_NAME:\s*\$\{\{\s*secrets\.IDENTITY\s*\}\}/
    );
  });

  it('never blocks packaging on a missing signature', () => {
    // Not signing must stay a cosmetic fact about the artifact, not a build
    // failure. `forceCodeSigning` would turn it into one.
    const builderConfig = readProjectFile('packages/desktop/electron-builder.yml');
    expect(builderConfig).not.toContain('forceCodeSigning');

    // And the exe still has to get its icon and version metadata, which is the
    // *edit* half of signAndEditExecutable — so that must not be globally off.
    expect(builderConfig).not.toMatch(/^\s*signAndEditExecutable:\s*false/m);
  });
});
