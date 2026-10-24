/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import { parseReleaseNotes } from '@/renderer/components/settings/releaseNotesParser';

// Same shape scripts/generate-release-notes.js renders into
// releases/{version}/release-notes.md on COS — what the update panel fetches.
const CANONICAL = [
  '版本 3.0.14 · 2026-10-24',
  '',
  '### 单机版 19 项',
  '',
  '本版带来全新的「场景」工作方式，引擎依旧开箱即用。',
  '',
  '【新增】',
  '· 【场景】从首页选择项目文件夹即可进入场景',
  '· 【聊天过程】连续的思考与工具调用折叠为一条实时过程行',
  '',
  '【优化改进】',
  '· 【知识库】条目可从侧栏直接加入会话',
  '· 【预览】文本预览上限从 1 MB 提高到 5 MB',
  '',
  '【修复】',
  '· 【稳定性】数据库文件损坏时明确报告原因',
  '',
  '### 企业版 8 项',
  '',
  '【新增】',
  '· 【审计】审计日志可转发到公司 SIEM',
  '',
  '【修复】',
  '· 【公司】公司改名同步到工作区名称',
].join('\n');

// Commit-derived fallback when no canonical JSON exists for a version.
const COMMIT_DERIVED = [
  '版本 3.1.0 · 2026-11-01',
  '',
  '本次更新包含 2 项新功能，主要涉及知识库。',
  '',
  '### 新功能',
  '',
  '- **知识库**：支持整夹导入',
  '- **界面**：新配色',
  '',
  '### 问题修复',
  '',
  '- **更新**：修复检查失败的问题',
].join('\n');

describe('parseReleaseNotes', () => {
  it('parses the canonical header into version and date', () => {
    const notes = parseReleaseNotes(CANONICAL);
    expect(notes?.version).toBe('3.0.14');
    expect(notes?.date).toBe('2026-10-24');
  });

  it('strips the decorative count suffix and splits sections', () => {
    const notes = parseReleaseNotes(CANONICAL);
    expect(notes?.sections.map((s) => s.title)).toEqual(['单机版', '企业版']);
  });

  it('maps each section to its edition and keeps the lead paragraph', () => {
    const notes = parseReleaseNotes(CANONICAL);
    const [personal, enterprise] = notes?.sections ?? [];
    expect(personal.edition).toBe('personal');
    expect(personal.leadParts[0]).toContain('「场景」');
    expect(enterprise.edition).toBe('enterprise');
  });

  it('groups 【分类】 headers with their · items and colors them', () => {
    const notes = parseReleaseNotes(CANONICAL);
    const personal = notes?.sections[0];
    expect(personal?.categories.map((c) => ({ label: c.label, cls: c.cls, count: c.items.length }))).toEqual([
      { label: '新增', cls: 'new', count: 2 },
      { label: '优化改进', cls: 'improved', count: 2 },
      { label: '修复', cls: 'fixed', count: 1 },
    ]);
    // Item text keeps its 【小标题】 prefix for inline emphasis.
    expect(personal?.categories[0].items[0]).toBe('【场景】从首页选择项目文件夹即可进入场景');
  });

  it('falls back to section titles as bare item lists for commit-derived notes', () => {
    const notes = parseReleaseNotes(COMMIT_DERIVED);
    expect(notes?.version).toBe('3.1.0');
    // The pre-heading summary paragraph carries into the first section's lead.
    expect(notes?.sections[0].leadParts[0]).toContain('本次更新包含');
    expect(notes?.sections[0].items).toEqual(['**知识库**：支持整夹导入', '**界面**：新配色']);
    expect(notes?.sections[1].title).toBe('问题修复');
    expect(notes?.sections[1].items[0]).toBe('**更新**：修复检查失败的问题');
  });

  it('accepts English bracket categories from the en overlay format', () => {
    const notes = parseReleaseNotes('### Personal edition\n\n[New]\n· Scenes open from the home page');
    expect(notes?.sections[0].categories[0]).toMatchObject({ label: 'New', cls: 'new' });
  });

  it('returns null for content that is not release notes', () => {
    expect(parseReleaseNotes('')).toBeNull();
    expect(parseReleaseNotes('随便一段话，没有任何分节。')).toBeNull();
  });
});
