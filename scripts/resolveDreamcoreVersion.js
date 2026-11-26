/**
 * Resolve the dreamcore version tag to download for packaging.
 *
 * Order:
 *   1. DREAM_BACKEND_VERSION env (ad-hoc override, e.g. CI dispatch input)
 *   2. "dreamcoreVersion" field in repo-root package.json (the pin)
 *   3. 'latest' (GitHub API releases/latest; non-reproducible fallback)
 *
 * Keep this file tiny and dependency-free — it's required from both
 * scripts/prepareDreamcore.js and scripts/pack-web-cli.js before
 * any project-level install has necessarily completed.
 */

const fs = require('fs');
const path = require('path');

function resolveDreamcoreVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch {
    // Bootstrap callers may not have a package pin yet.
  }
  const selected = process.env.DREAM_BACKEND_VERSION?.trim() || pkg.dreamcoreVersion?.trim() || 'latest';
  const minimum = pkg.dreamcoreMinimumVersion;
  const localBuild = ['DREAM_BACKEND_LOCAL_PATH', 'DREAM_BACKEND_LOCAL_BUNDLE_DIR'].some((key) =>
    process.env[key]?.trim()
  );
  if (minimum && !localBuild) {
    const parse = (version) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
    const actual = parse(selected);
    const required = parse(minimum);
    const difference =
      actual && required && actual.map((part, index) => part - required[index]).find((part) => part !== 0);
    if (!actual || !required || difference < 0) {
      throw new Error(
        `Core ${selected} does not satisfy required ${minimum}. Release and pin the Core memory recall fixes before packaging, or supply an explicitly built local Core for local validation.`
      );
    }
  }
  return selected;
}

module.exports = { resolveDreamcoreVersion };
