/**
 * CLI wrapper for prepare-dreamcore.
 *
 * Reads environment variables and invokes the shared module.
 *
 * Version resolution order:
 *  1. DREAM_BACKEND_RUN_ID env (download from DreamCore Manual Build artifact)
 *  2. DREAM_BACKEND_VERSION env (for ad-hoc release overrides)
 *  3. "dreamcoreVersion" field in repo-root package.json (the pin)
 *  4. 'latest' (fallback; not recommended for reproducible builds)
 *
 * Environment variables:
 *  - DREAM_BACKEND_RUN_ID: DreamCore Manual Build workflow run id
 *  - DREAM_BACKEND_VERSION: override the pinned version
 *  - DREAM_BACKEND_ARCH: target architecture (default: process.arch)
 *  - GH_TOKEN / GITHUB_TOKEN: GitHub API token (for rate limiting)
 */

const path = require('path');
const { prepareDreamcore } = require('../packages/shared-scripts/src/prepare-dreamcore.js');
const { resolveDreamcoreVersion } = require('./resolveDreamcoreVersion.js');

const projectRoot = path.resolve(__dirname, '..');
const platform = process.platform;
// Support cross-compilation: DREAM_BACKEND_ARCH > npm_config_target_arch > process.arch
const arch = process.env.DREAM_BACKEND_ARCH || process.env.npm_config_target_arch || process.arch;
const version = resolveDreamcoreVersion(projectRoot);

try {
  prepareDreamcore({ projectRoot, platform, arch, version });
} catch (error) {
  console.error('❌ prepareDreamcore failed:', error.message);
  process.exit(1);
}

module.exports = function () {
  try {
    return prepareDreamcore({ projectRoot, platform, arch, version });
  } catch (error) {
    console.error('❌ prepareDreamcore failed:', error.message);
    throw error;
  }
};
