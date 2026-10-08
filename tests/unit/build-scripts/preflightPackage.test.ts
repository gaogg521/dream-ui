/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 *
 * The packaging pre-flight fails a build when dream-core main has changes the
 * pinned dreamcore release lacks. Which files count decides between a false
 * alarm on every docs commit and a silent miss of real backend code.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isBuildRelevant } = require('../../../scripts/preflight-package.js') as {
  isBuildRelevant: (file: string) => boolean;
};

describe('preflight isBuildRelevant', () => {
  it('counts source, manifests and the lockfile (an engine re-pin lives only there)', () => {
    expect(isBuildRelevant('crates/dream-core-ai-agent/src/capability/backend_protocol_sink.rs')).toBe(true);
    expect(isBuildRelevant('Cargo.lock')).toBe(true);
    expect(isBuildRelevant('Cargo.toml')).toBe(true);
    expect(isBuildRelevant('.cargo/config.toml')).toBe(true);
  });

  it('ignores tests, docs and CI, which never change the shipped binary', () => {
    expect(isBuildRelevant('crates/dream-core-app/tests/shell_e2e.rs')).toBe(false);
    expect(isBuildRelevant('crates/dream-engine-agent/src/context_test.rs')).toBe(false);
    expect(isBuildRelevant('crates/dream-core-db/README.md')).toBe(false);
    expect(isBuildRelevant('docs/guides/anything.zh-CN.md')).toBe(false);
    expect(isBuildRelevant('.github/workflows/release.yml')).toBe(false);
    expect(isBuildRelevant('CHANGELOG.md')).toBe(false);
  });
});
