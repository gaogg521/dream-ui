# Project Guide

All contributors (human and AI) must follow [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. ([Chinese version](CONTRIBUTING.zh.md))

## Code Conventions

### File & Directory Structure

- **Directory size limit**: Prefer ≤ **10** direct children per directory; new or substantially reorganized directories must satisfy this.

See [docs/contributing/file-structure.md](docs/contributing/file-structure.md) for complete rules. Agents must also follow the `architecture` skill (`.claude/skills/architecture/SKILL.md`) when creating files or modules.

### Naming

- **Components**: PascalCase (`Button.tsx`, `Modal.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Hooks**: camelCase with `use` prefix (`useTheme.ts`)
- **Constants files**: camelCase (`constants.ts`) — values inside use UPPER_SNAKE_CASE
- **Type files**: camelCase (`types.ts`)
- **Style files**: kebab-case or `ComponentName.module.css`
- **Unused params**: prefix with `_`

### UI Library & Icons

- **Components**: `@arco-design/web-react` — no raw interactive HTML (`<button>`, `<input>`, `<select>`, etc.)
- **Icons**: `@icon-park/react`

### CSS

- Prefer **UnoCSS utility classes**; complex styles use **CSS Modules** (`ComponentName.module.css`)
- Colors must use **semantic tokens** from `uno.config.ts` or CSS variables — no hardcoded values
- Arco theme overrides go in `packages/desktop/src/renderer/styles/arco-override.css`; component-scoped Arco overrides use CSS Module with `:global()`
- Global styles only in `packages/desktop/src/renderer/styles/`

Formatting rules (Oxfmt, Prettier-compatible):

- Single-element arrays that fit on one line → inline: `[{ id: 'a', value: 'b' }]`
- Trailing commas required in multi-line arrays/objects
- Single quotes for strings

### TypeScript

- Strict mode enabled — no `any`, no implicit returns
- Use path aliases: `@/*`, `@process/*`, `@renderer/*`
- Prefer `type` over `interface` (per Oxlint config)
- English for code comments; JSDoc for public functions

### Internationalization (i18n)

New or changed user-facing text must use i18n keys; do not introduce hardcoded strings. Languages and modules are defined in `packages/desktop/src/common/config/i18n-config.json`.

See the `i18n` skill (`.claude/skills/i18n/SKILL.md`) for complete workflow, key naming, and validation steps.

## Architecture

Two process types — never mix their APIs:

| Process  | Path                             | Restriction     |
| -------- | -------------------------------- | --------------- |
| Main     | `packages/desktop/src/process/`  | No DOM APIs     |
| Renderer | `packages/desktop/src/renderer/` | No Node.js APIs |

Cross-process communication must go through the IPC bridge (`packages/desktop/src/preload/`).
See [docs/architecture/overview.md](docs/architecture/overview.md) for details.

## Testing

**Framework**: Vitest 4 (`vitest.config.ts`). Project coverage target is ≥ 80%; ordinary changes should add focused tests for changed behavior.

```bash
bun run test              # run all tests
bun run test:coverage     # with coverage report
```

See the `testing` skill (`.claude/skills/testing/SKILL.md`) for complete workflow and quality rules.

### A green vitest summary is not automatically a pass

Vitest **exits 0 and prints a passing summary even when whole test files never
ran.** Under CPU contention its workers fail to start:

```text
Vitest caught 21 unhandled errors during the test run.
Error: [vitest-pool]: Failed to start forks worker for test files …
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
```

Those files are simply absent from the totals. Observed on this repo: **546
files → 525, ~316 tests never executed, exit code 0** — while a full run at the
same commit was 546/5076.

So:

1. **Check the counts, not the exit code.** Compare `Test Files` / `Tests`
   against the last known-good full run. A smaller denominator means files were
   skipped, not that they passed.
2. **Never run vitest concurrently with a Rust build.** `cargo test` /
   `cargo nextest` in the sibling `dream-core` checkout starves vitest's worker
   pool and is the usual cause. Run them one after the other.
3. **Grep the output for `Unhandled Errors`** on any run you intend to treat as
   verification.

## Workflow

### Scope & Enforcement

- **Hard blockers**: process boundary violations, TypeScript errors, failing tests, unsafe IPC usage, missing i18n for new or changed user-facing text, and raw interactive HTML in new UI.
- **Current-change requirements**: naming, CSS, file placement, tests, docs, directory size, and single-file-directory rules apply to files created or meaningfully modified by the current change.
- **Ratchet rules**: existing directory size or single-file-directory violations do not require cleanup during ordinary feature work or bugfixes, but the current change must not make them worse.
- **No scope expansion**: implementation plans and reviews must not create extra tasks, phases, or acceptance criteria for cleanup unless the user asks for that scope.
- **Ignored working docs**: `docs/superpowers/` is intentionally gitignored for local Superpowers specs and plans. Do not force-add or otherwise commit files from this directory.

### During Development

Auto-fix as you edit:

```bash
bun run lint:fix       # auto-fix lint issues (oxlint)
bun run format         # auto-format all files (oxfmt)
bunx tsc --noEmit      # verify no type errors
```

If your changes touch `packages/desktop/src/renderer/`, `locales/`, or `packages/desktop/src/common/config/i18n`, also run:

```bash
bun run i18n:types
node scripts/check-i18n.js
```

### Before Pushing

Any step that fails aborts the push. Fix the issue, commit, then retry.

The project has many pre-existing lint _warnings_ which do NOT indicate failure. Judge success by exit code, not by output volume.

### Before PR (optional stricter check)

`prek` replicates the **exact CI pipeline** (includes end-of-file, trailing whitespace checks on all file types):

```bash
# One-time setup
npm install -g @j178/prek

# Run
prek run --from-ref origin/main --to-ref HEAD
```

> `prek` is read-only — it reports but does not fix. If it reports issues, run the auto-fix commands above, commit, then re-run.

### Commit & PR Format

Commits and PR titles must follow the Conventional Commit format defined in [CONTRIBUTING.md](CONTRIBUTING.md):

```text
<type>(<scope>): <subject>
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`, `ci`, `build`.

When opening a PR, fill in the PR body using [.github/pull_request_template.md](.github/pull_request_template.md) and complete its checklists honestly (only check items you actually ran or verified).

**NEVER add AI signatures** (Co-Authored-By, Generated with, etc.).

## Skills Index

| Skill            | Purpose                                                                     | Triggers                                                                                               |
| ---------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **architecture** | File & directory structure conventions for all process types                | Creating files, adding modules, architectural decisions                                                |
| **i18n**         | Internationalization workflow and standards                                 | Adding or changing user-facing text, modifying `locales/` or `packages/desktop/src/common/config/i18n` |
| **testing**      | Testing workflow and quality standards                                      | Writing tests, changing runtime behavior, fixing bugs, or claiming behavior is verified                |
| **bump-version** | Version bump workflow: update package.json, checks, branch, PR, tag release | Bumping version, `/bump-version`                                                                       |

> Skills are located in `.claude/skills/` and contain project conventions that apply to **all** agents and contributors.
