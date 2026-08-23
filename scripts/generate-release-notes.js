#!/usr/bin/env node

/**
 * Build user-facing release notes for a version.
 *
 * Two inputs, in priority order:
 *   1. `docs/release-notes/<version>.json` — the hand-curated canonical source
 *      (see docs/release-notes/README.md). When both its `zh` and `en` arrays
 *      are non-empty, it is used verbatim; this is also what
 *      `sync-changelog-to-site.js` pushes onto the marketing site, so the
 *      desktop app and the site render the SAME content, just differently.
 *   2. Commits since the previous release tag — used whenever no canonical
 *      file exists yet, or it still has an empty `en` (i.e. still a draft —
 *      see `--draft-json`). Only user-visible commit types are kept
 *      (feat / fix / perf); docs, chore, ci, style, test, build and refactor
 *      are release plumbing, not changelog material.
 *
 * The rendered markdown feeds two places, and they stay the same text:
 *   - the GitHub Release body (`gh release create --notes-file …`)
 *   - `releases/{version}/release-notes.md` on COS, which the desktop app's
 *     "更新日志" panel reads (see updateBridge.fetchCdnReleaseNotes)
 *
 * Usage:
 *   node scripts/generate-release-notes.js                    # markdown, current version, auto range
 *   node scripts/generate-release-notes.js --from v2.1.48      # explicit previous tag
 *   node scripts/generate-release-notes.js --out notes.md      # write instead of stdout
 *   node scripts/generate-release-notes.js --draft-json docs/release-notes/2.1.51.json
 *                                                               # draft the canonical JSON from commits
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAX_ENTRIES_PER_GROUP = 25;

// Commit types that describe a change a user could notice. Everything else
// (docs/chore/ci/style/test/build/refactor) is deliberately dropped.
const GROUPS = [
  { type: 'feat', title: '新功能', noun: '项新功能' },
  { type: 'fix', title: '问题修复', noun: '项问题修复' },
  { type: 'perf', title: '性能优化', noun: '项性能优化' },
];
const GROUP_TITLE_BY_TYPE = Object.fromEntries(GROUPS.map((g) => [g.type, g.title]));

// Conventional-commit scopes → what to call them in front of users. Unmapped
// scopes fall through unchanged, so a new scope degrades to "just the scope"
// rather than disappearing.
const SCOPE_LABELS = {
  enterprise: '企业管理',
  onboarding: '成员入驻',
  billing: '订阅与计费',
  sso: '企业登录',
  devops: '运维',
  team: '团队协作',
  'team-skills': '团队技能',
  conversation: '会话',
  assistant: '助手',
  agent: 'Agent',
  acp: 'Agent 接入',
  bridge: '模型桥接',
  'claude-bridge': 'Claude 桥接',
  'codex-bridge': 'Codex 桥接',
  model: '模型',
  skills: '技能',
  mcp: 'MCP',
  memory: '记忆',
  cron: '定时任务',
  rag: '知识库',
  superAssistant: '超级助手',
  employee: '数字员工',
  settings: '设置',
  ui: '界面',
  ux: '交互',
  layout: '界面布局',
  sider: '侧边栏',
  guid: '首页',
  renderer: '界面',
  desktop: '桌面端',
  preview: '文件预览',
  markdown: 'Markdown',
  i18n: '多语言',
  brand: '品牌',
  update: '自动更新',
  installer: '安装程序',
  'installation-integrity': '安装完整性',
  packaging: '打包',
  release: '发布',
  webui: 'WebUI',
  'web-host': 'WebUI',
  login: '登录',
  startup: '启动',
  system: '系统',
  runtime: '运行时',
  migration: '数据迁移',
  feedback: '问题反馈',
  linux: 'Linux',
};

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [flag, inlineValue] = arg.split('=');
    const key = flag.slice(2);
    options[key] = inlineValue ?? argv[++i];
  }
  return options;
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

const compareVersionDesc = (a, b) => {
  const parse = (tag) =>
    tag
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    if (l === r) continue;
    if (l === undefined) return 1;
    if (r === undefined) return -1;
    return typeof l === 'number' && typeof r === 'number' ? r - l : String(r).localeCompare(String(l));
  }
  return 0;
};

/**
 * Newest release tag reachable from `to`, excluding tags that point at `to`
 * itself (otherwise generating notes for a tagged commit yields an empty range).
 * Tags in this fork are sparse — several versions can share one range, which is
 * intentional: the notes then cover everything actually shipped since the last
 * published tag.
 */
function resolvePreviousTag(to) {
  let tags;
  try {
    tags = git(['tag', '--list', 'v*', '--merged', to]).split('\n').filter(Boolean);
  } catch {
    return null;
  }
  if (tags.length === 0) return null;

  let headSha = '';
  try {
    headSha = git(['rev-parse', to + '^{commit}']);
  } catch {
    /* keep empty — the filter below just won't exclude anything */
  }

  return (
    tags.sort(compareVersionDesc).find((tag) => {
      try {
        return git(['rev-parse', tag + '^{commit}']) !== headSha;
      } catch {
        return false;
      }
    }) ?? null
  );
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;
// Version bumps are conventionally `chore:`, but they slip through as other
// types often enough to be worth an explicit guard.
const VERSION_BUMP_RE = /^(bump|发布)|bump\s+version|bump\s+版本|版本号?\s*(升|bump)/i;

function collectCommits(from, to) {
  const range = from ? `${from}..${to}` : to;
  const raw = git(['log', '--no-merges', '--pretty=format:%s', range]);
  if (!raw) return [];

  const seen = new Set();
  const entries = [];
  for (const subject of raw.split('\n')) {
    const match = CONVENTIONAL_RE.exec(subject.trim());
    if (!match) continue;
    const [, type, scope, breaking, description] = match;
    if (!GROUPS.some((group) => group.type === type)) continue;
    if (VERSION_BUMP_RE.test(description)) continue;

    const key = `${type}:${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ type, scope: scope || '', breaking: Boolean(breaking), description });
  }
  return entries;
}

const formatEntry = ({ scope, breaking, description }) => {
  const label = scope ? (SCOPE_LABELS[scope] ?? scope) : '';
  const prefix = breaking ? '**不兼容变更** ' : '';
  return label ? `- ${prefix}**${label}**：${description}` : `- ${prefix}${description}`;
};

/**
 * One-line "what's in this release" sentence, derived from the counts and the
 * areas touched most. Only used on the commit-derived fallback path — the
 * canonical JSON always carries its own per-item copy, no summary needed.
 */
function buildSummary(entries) {
  if (entries.length === 0) return '本次更新为维护性发布，包含若干内部改进。';

  const counts = GROUPS.map((group) => ({
    group,
    count: entries.filter((entry) => entry.type === group.type).length,
  })).filter((item) => item.count > 0);

  const parts = counts.map((item) => `${item.count} ${item.group.noun}`);

  const scopeCounts = new Map();
  for (const entry of entries) {
    if (!entry.scope) continue;
    const label = SCOPE_LABELS[entry.scope] ?? entry.scope;
    scopeCounts.set(label, (scopeCounts.get(label) ?? 0) + 1);
  }
  const topAreas = [...scopeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);

  const head = `本次更新包含 ${parts.join('、')}`;
  return topAreas.length > 0 ? `${head}，主要涉及${topAreas.join('、')}。` : `${head}。`;
}

function canonicalJsonPath(version) {
  return path.join(ROOT, 'docs', 'release-notes', `${version}.json`);
}

/** Reads docs/release-notes/<version>.json if present; returns null on any parse/shape problem. */
function readCanonicalJson(version) {
  const file = canonicalJsonPath(version);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const hasCopy = (item) =>
  item && typeof item.t === 'string' && item.t.trim() && typeof item.d === 'string' && item.d.trim();

/**
 * A canonical file is only "ready to publish" once BOTH languages have been
 * filled in — an empty `en` is exactly what `--draft-json` leaves behind, so
 * this doubles as "has a human actually finished curating this yet?" without
 * a separate status flag. An unfinished draft is treated the same as "no
 * file": never publish placeholder copy.
 */
function isCanonicalReady(json) {
  return (
    Array.isArray(json.zh) &&
    json.zh.length > 0 &&
    json.zh.every(hasCopy) &&
    Array.isArray(json.en) &&
    json.en.length > 0 &&
    json.en.every(hasCopy)
  );
}

/**
 * Renders the canonical JSON to the flat markdown the app/GitHub Release use.
 * zh only — neither the desktop panel nor the Release body is localized
 * today; `en` in the canonical file exists for the website, which selects a
 * language client-side (see sync-changelog-to-site.js).
 */
function renderCanonicalMarkdown(json) {
  const date = typeof json.date === 'string' && json.date ? json.date : new Date().toISOString().slice(0, 10);
  const lines = [`版本 ${json.version} · ${date}`, ''];
  for (const item of json.zh) {
    lines.push(`### ${item.t}`, '', item.d, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function buildCommitDerivedNotes({ version, from, to }) {
  const entries = collectCommits(from, to);
  const date = new Date().toISOString().slice(0, 10);

  const lines = [`版本 ${version} · ${date}`, '', buildSummary(entries), ''];

  for (const group of GROUPS) {
    const groupEntries = entries.filter((entry) => entry.type === group.type);
    if (groupEntries.length === 0) continue;
    lines.push(`### ${group.title}`, '');
    for (const entry of groupEntries.slice(0, MAX_ENTRIES_PER_GROUP)) {
      lines.push(formatEntry(entry));
    }
    if (groupEntries.length > MAX_ENTRIES_PER_GROUP) {
      lines.push(`- …及其他 ${groupEntries.length - MAX_ENTRIES_PER_GROUP} 项改进`);
    }
    lines.push('');
  }

  return { text: lines.join('\n').trimEnd() + '\n', count: entries.length, source: 'commits' };
}

function buildNotes({ version, from, to }) {
  const canonical = readCanonicalJson(version);
  if (canonical && isCanonicalReady(canonical)) {
    return { text: renderCanonicalMarkdown(canonical), count: canonical.zh.length, source: 'canonical' };
  }
  return buildCommitDerivedNotes({ version, from, to });
}

/**
 * Drafts docs/release-notes/<version>.json from commits so a human doesn't
 * start from a blank file. `t` falls back to the scope label (or the group
 * title when a commit has no scope) and `d` is the raw commit description —
 * neither is publish-quality prose, both need editing. `en` is left empty on
 * purpose: see isCanonicalReady() — that is the signal this draft still needs
 * work before anything will render from it.
 */
function buildDraftJson({ version, from, to }) {
  const entries = collectCommits(from, to);
  const date = new Date().toISOString().slice(0, 10);
  const zh = entries.map((entry) => ({
    t: entry.scope ? (SCOPE_LABELS[entry.scope] ?? entry.scope) : GROUP_TITLE_BY_TYPE[entry.type],
    d: entry.description,
  }));
  return { version, date, zh, en: [] };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const version = options.version || readPackageVersion();
  const to = options.to || 'HEAD';
  const from = options.from === 'none' ? null : options.from || resolvePreviousTag(to);

  if (options['draft-json']) {
    const draft = buildDraftJson({ version, from, to });
    const target = path.resolve(ROOT, options['draft-json']);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(draft, null, 2) + '\n', 'utf8');
    console.error(
      `Draft canonical notes for ${version} (${from ?? 'repo start'}..${to}, ${draft.zh.length} entries) → ${target}`
    );
    console.error(
      'Fill in `t`/`d` for both zh and en before this is used — an empty `en` is treated as "still a draft".'
    );
    return;
  }

  const { text, count, source } = buildNotes({ version, from, to });

  if (options.out) {
    const target = path.resolve(ROOT, options.out);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
    console.error(`Release notes for ${version} (source: ${source}, ${count} entries) → ${target}`);
  } else {
    process.stdout.write(text);
  }
}

main();
