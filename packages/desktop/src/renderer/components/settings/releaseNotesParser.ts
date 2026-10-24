/**
 * Copyright 2026 One Work
 */

export type CategoryCls =
  | 'new'
  | 'improved'
  | 'security'
  | 'policy'
  | 'fixed'
  | 'arch'
  | 'auth'
  | 'resource'
  | 'observe'
  | 'topic';

export interface NotesCategory {
  label: string;
  cls: CategoryCls;
  items: string[];
}

export interface NotesSection {
  title: string;
  edition: 'personal' | 'enterprise';
  leadParts: string[];
  categories: NotesCategory[];
  /** List items that appear without a 【分类】 header (commit-derived notes). */
  items: string[];
}

export interface ParsedReleaseNotes {
  version?: string;
  date?: string;
  sections: NotesSection[];
}

// Canonical notes open with "版本 3.0.14 · 2026-10-24"; rendered as the
// badge header instead of body text.
const HEADER_LINE_RE = /^版本\s+([\w.+-]+)\s*·\s*(.+)$/;
const SECTION_RE = /^#{1,6}\s+(.+?)\s*$/;
const CATEGORY_LINE_RE = /^[【[](.+)[】\]]$/;
const LIST_LINE_RE = /^(?:·|\*|[-+•])\s+(.+)$/;
// "### 单机版 19 项" — the count is decorative, the parser counts real items.
const COUNT_SUFFIX_RE = /\s+\d+\s*(?:项|items?|entries)$/i;

// Same label→hue mapping as the site's updatesCategoryClass (changelog-render.js),
// extended with 新功能/优化 so the commit-derived fallback ("### 新功能" …) also colors.
function categoryCls(label: string): CategoryCls {
  const l = label.toLowerCase();
  if (l.includes('安全策略') || l.includes('security policy')) return 'policy';
  if (l.includes('安全') || l.includes('security')) return 'security';
  if (l.includes('新增') || l.includes('新功能') || l.includes('new')) return 'new';
  if (l.includes('改进') || l.includes('优化') || l.includes('improved') || l.includes('perf')) return 'improved';
  if (l.includes('架构') || l.includes('architecture')) return 'arch';
  if (l.includes('授权') || l.includes('authorization') || l.includes('identity')) return 'auth';
  if (l.includes('资源') || l.includes('resource')) return 'resource';
  if (l.includes('可观测') || l.includes('observability') || l.includes('governance')) return 'observe';
  if (l.includes('修复') || l.includes('fixed') || l.includes('fix')) return 'fixed';
  return 'topic';
}

/**
 * Parses the canonical release-notes markdown (scripts/generate-release-notes.js
 * → releases/{version}/release-notes.md on COS) into edition sections with
 * color-coded categories. Returns null when the input is not that format, so
 * the caller can fall back to plain markdown rendering.
 */
export function parseReleaseNotes(markdown: string): ParsedReleaseNotes | null {
  const notes: ParsedReleaseNotes = { sections: [] };
  let section: NotesSection | null = null;
  let currentCategory: NotesCategory | null = null;
  let paragraphLines: string[] | null = null;
  // Commit-derived notes put a summary paragraph before the first "###" —
  // carry it into the first section's lead.
  let topParagraphLines: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines || paragraphLines.length === 0) return;
    section?.leadParts.push(paragraphLines.join(' '));
    paragraphLines = null;
  };

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      currentCategory = null;
      continue;
    }

    if (!section && !notes.version) {
      const header = HEADER_LINE_RE.exec(line);
      if (header) {
        notes.version = header[1];
        notes.date = header[2];
        continue;
      }
    }

    const heading = SECTION_RE.exec(line);
    if (heading) {
      flushParagraph();
      currentCategory = null;
      const countSuffix = COUNT_SUFFIX_RE.exec(heading[1]);
      const title = countSuffix ? heading[1].slice(0, countSuffix.index).trim() : heading[1];
      section = {
        title,
        edition: /企业|enterprise/i.test(heading[1]) ? 'enterprise' : 'personal',
        leadParts: [],
        categories: [],
        items: [],
      };
      if (topParagraphLines.length > 0) {
        section.leadParts.push(topParagraphLines.join(' '));
        topParagraphLines = [];
      }
      notes.sections.push(section);
      continue;
    }

    if (!section) {
      topParagraphLines.push(line);
      continue;
    }

    const categoryLine = CATEGORY_LINE_RE.exec(line);
    if (categoryLine) {
      flushParagraph();
      currentCategory = { label: categoryLine[1], cls: categoryCls(categoryLine[1]), items: [] };
      section.categories.push(currentCategory);
      continue;
    }

    const listItem = LIST_LINE_RE.exec(line);
    if (listItem) {
      flushParagraph();
      if (currentCategory) currentCategory.items.push(listItem[1]);
      // A bullet outside any 【分类】 only happens in commit-derived notes,
      // where "### 新功能" headings carry the category instead.
      else section.items.push(listItem[1]);
      continue;
    }

    if (!paragraphLines) paragraphLines = [];
    paragraphLines.push(line);
  }
  flushParagraph();

  if (notes.sections.length === 0) return null;
  return notes;
}
