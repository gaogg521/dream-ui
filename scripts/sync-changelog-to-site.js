#!/usr/bin/env node

/**
 * Push a release's canonical notes (docs/release-notes/<version>.json) onto
 * the marketing site's "更新内容" changelog and bump its download version.
 *
 * This does NOT run in GitHub Actions: D:\website\1onework is not a git
 * repository (no remote, no CI) — it's built locally with Vite and deployed
 * by D:\game\scripts\deploy-1onework-www.py over SSH. So this script is the
 * "CI/CD" for the site half of a release: run it locally (by a person or an
 * AI session) as one more step alongside `bun run release-notes` /
 * `gh release create`, then `npm run build` + the deploy script, per the
 * standing "官网改完直接部署，不用问" convention.
 *
 * What it touches, both in the site repo:
 *   - src/changelog.js  — prepends a new CHANGELOG entry (same {version, date,
 *     zh, en} shape the canonical JSON already uses — zero translation needed)
 *   - src/site.config.js — bumps `release.version`, which drives the download
 *     links (see COS-DOWNLOAD.md / cosUrl())
 *
 * Usage:
 *   node scripts/sync-changelog-to-site.js --version 2.1.51
 *   node scripts/sync-changelog-to-site.js --version 2.1.51 --dry-run
 *   node scripts/sync-changelog-to-site.js --version 2.1.51 --site-dir D:\website\1onework
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SITE_DIR = 'D:\\website\\1onework';

const BOOLEAN_FLAGS = new Set(['dry-run']);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [flag, inlineValue] = arg.split('=');
    const key = flag.slice(2);
    if (BOOLEAN_FLAGS.has(key) && inlineValue === undefined) {
      options[key] = true;
      continue;
    }
    options[key] = inlineValue ?? argv[++i];
  }
  return options;
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function readCanonicalJson(version) {
  const file = path.join(ROOT, 'docs', 'release-notes', `${version}.json`);
  if (!fs.existsSync(file)) {
    fail(`No canonical release notes at ${file}. Run --draft-json first and fill it in.`);
  }
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  return json;
}

const hasCopy = (item) =>
  item && typeof item.t === 'string' && item.t.trim() && typeof item.d === 'string' && item.d.trim();

function assertReady(json, version) {
  const problems = [];
  if (json.version !== version) problems.push(`"version" field is "${json.version}", expected "${version}"`);
  if (!Array.isArray(json.zh) || json.zh.length === 0 || !json.zh.every(hasCopy)) {
    problems.push('"zh" must be a non-empty array of {t, d} entries');
  }
  if (!Array.isArray(json.en) || json.en.length === 0 || !json.en.every(hasCopy)) {
    problems.push(
      '"en" must be a non-empty array of {t, d} entries — an empty "en" means this is still a --draft-json, not curated copy'
    );
  }
  if (problems.length > 0) {
    fail(`docs/release-notes/${version}.json is not ready to publish:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Renders a string as a double-quoted JS string literal, matching the site's existing style. */
const jsString = (value) =>
  JSON.stringify(String(value))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

function renderItemsBlock(items, indent) {
  const inner = indent + '  ';
  return items
    .map((item) => `${indent}{\n${inner}t: ${jsString(item.t)},\n${inner}d: ${jsString(item.d)},\n${indent}},`)
    .join('\n');
}

/** Formats one CHANGELOG entry to match the hand-written style already in the file (2-space indent, unquoted keys). */
function renderChangelogEntry(json) {
  return [
    '  {',
    `    version: ${jsString(json.version)},`,
    `    date: ${jsString(json.date)},`,
    '    zh: [',
    renderItemsBlock(json.zh, '      '),
    '    ],',
    '    en: [',
    renderItemsBlock(json.en, '      '),
    '    ],',
    '  },',
  ].join('\n');
}

const CHANGELOG_ARRAY_ANCHOR = 'export const CHANGELOG = [\n';

function syncChangelogFile(siteDir, json, { dryRun }) {
  const file = path.join(siteDir, 'src', 'changelog.js');
  if (!fs.existsSync(file)) fail(`Site changelog not found: ${file}`);
  const original = fs.readFileSync(file, 'utf8');

  if (original.includes(`version: ${jsString(json.version)},`)) {
    fail(
      `${file} already has an entry for version ${json.version}. Remove it by hand first if you're re-publishing a correction (no --force to avoid silently duplicating/overwriting hand-edited copy).`
    );
  }

  const anchorIndex = original.indexOf(CHANGELOG_ARRAY_ANCHOR);
  if (anchorIndex === -1) {
    fail(
      `${file}: could not find "${CHANGELOG_ARRAY_ANCHOR.trim()}" — file format changed, update sync-changelog-to-site.js.`
    );
  }

  const insertAt = anchorIndex + CHANGELOG_ARRAY_ANCHOR.length;
  const entry = renderChangelogEntry(json);
  const updated = original.slice(0, insertAt) + entry + '\n' + original.slice(insertAt);

  if (dryRun) {
    console.log(`--- ${file} (dry run, not written) ---`);
    console.log(entry);
    return;
  }
  fs.writeFileSync(file, updated, 'utf8');
  console.error(`Prepended CHANGELOG entry for ${json.version} → ${file}`);
}

const SITE_CONFIG_VERSION_RE = /(export const release = \{\s*\n\s*version:\s*")[^"]+(")/;

function syncSiteConfigVersion(siteDir, version, { dryRun }) {
  const file = path.join(siteDir, 'src', 'site.config.js');
  if (!fs.existsSync(file)) fail(`Site config not found: ${file}`);
  const original = fs.readFileSync(file, 'utf8');

  if (!SITE_CONFIG_VERSION_RE.test(original)) {
    fail(
      `${file}: could not find "export const release = { version: ... }" — file format changed, update sync-changelog-to-site.js.`
    );
  }

  const updated = original.replace(SITE_CONFIG_VERSION_RE, `$1${version}$2`);
  if (updated === original) {
    console.error(`${file} already at version ${version}, nothing to change.`);
    return;
  }

  if (dryRun) {
    console.log(`--- ${file} (dry run, not written) ---`);
    console.log(`release.version → "${version}"`);
    return;
  }
  fs.writeFileSync(file, updated, 'utf8');
  console.error(`Bumped release.version to ${version} → ${file}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = options.version;
  if (!version) fail('--version is required, e.g. --version 2.1.51');

  const siteDir = path.resolve(options['site-dir'] || DEFAULT_SITE_DIR);
  if (!fs.existsSync(siteDir)) {
    fail(`Site directory not found: ${siteDir}. Pass --site-dir if it lives somewhere else on this machine.`);
  }

  const dryRun = Boolean(options['dry-run']);
  const json = readCanonicalJson(version);
  assertReady(json, version);

  syncChangelogFile(siteDir, json, { dryRun });
  syncSiteConfigVersion(siteDir, version, { dryRun });

  if (!dryRun) {
    console.error('Next: cd into the site dir, `npm run build`, then run deploy-1onework-www.py.');
  }
}

main();
