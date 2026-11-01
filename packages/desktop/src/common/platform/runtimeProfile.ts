/** Do not infer a test build from a user's chosen installation directory alone. */
function isSourceCheckout(root: string): boolean {
  const fs = require('fs') as typeof import('fs');
  try {
    const manifest = JSON.parse(fs.readFileSync(`${root}/package.json`, 'utf8')) as { name?: string };
    return manifest.name === '1one-claudecode' && fs.existsSync(`${root}/packages/desktop/electron-builder.yml`);
  } catch {
    return false;
  }
}

/** Identify local packaged test runs without changing installed release identity. */
export function isPackagedTestRun(
  isPackaged: boolean,
  executable = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  hasCheckout: (root: string) => boolean = isSourceCheckout
): boolean {
  if (!isPackaged) return false;
  if (env.DREAM_TEST_PROFILE === '1' || env.DREAM_E2E_TEST === '1' || argv.includes('--test-profile')) return true;
  const normalized = executable.replace(/\\/g, '/');
  // Only source-checkout outputs are automatic tests. Installed/portable copies
  // retain production data, even if a user names their directory "win-unpacked".
  const output = normalized.match(
    /^(.*)\/out\/(?:(?:win|linux)(?:-(?:x64|arm64|ia32))?-unpacked\/|mac(?:-(?:x64|arm64|universal))?\/[^/]+\.app\/)/i
  );
  return !!output && hasCheckout(output[1]);
}

export type RuntimeProfileApp = {
  isPackaged: boolean;
  getVersion(): string;
  getPath(name: 'appData'): string;
  setName(name: string): void;
  setPath(name: 'userData', value: string): void;
  setAppUserModelId(id: string): void;
};
