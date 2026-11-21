import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('release renderer archive validation', () => {
  it('checks checksums, traversal, release versions and immutable storage', () => {
    expect(() =>
      execFileSync(process.env.PYTHON || 'python', ['tests/integration/test_tunnel_assets.py'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    ).not.toThrow();
  });
});
