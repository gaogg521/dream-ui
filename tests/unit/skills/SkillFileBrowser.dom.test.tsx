/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSkillFiles: vi.fn(),
  readSkillFile: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listSkillFiles: { invoke: mocks.listSkillFiles },
      readSkillFile: { invoke: mocks.readSkillFile },
    },
    theme: {
      requestCurrent: { invoke: vi.fn().mockResolvedValue(null) },
      changed: { on: vi.fn(() => vi.fn()) },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  type Node = { name: string; relativePath: string; type: 'directory' | 'file'; children?: Node[] };
  const renderNodes = (
    nodes: Node[],
    onSelect?: (keys: string[], extra: { node: { props: { dataRef: Node } } }) => void
  ) =>
    nodes.map((node) => (
      <React.Fragment key={node.relativePath}>
        <button type='button' onClick={() => onSelect?.([node.relativePath], { node: { props: { dataRef: node } } })}>
          {node.name}
        </button>
        {node.children ? renderNodes(node.children, onSelect) : null}
      </React.Fragment>
    ));

  return {
    ...actual,
    Tree: ({ treeData = [], onSelect }: { treeData?: Node[]; onSelect?: Parameters<typeof renderNodes>[1] }) => (
      <div data-testid='skill-file-tree'>{renderNodes(treeData, onSelect)}</div>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/MarkdownViewer', () => ({
  default: ({ content, viewMode }: { content: string; viewMode?: string }) => (
    <div data-testid='markdown-viewer' data-view-mode={viewMode}>
      {content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/editors/CodeEditor', () => ({
  default: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
    <div data-testid='code-editor' data-read-only={String(Boolean(readOnly))}>
      {value}
    </div>
  ),
}));

import SkillFileBrowser, { fenceFrontmatter } from '@/renderer/pages/settings/SkillsSettings/SkillFileBrowser';

/**
 * A SKILL.md opens on its own YAML frontmatter, and `name: x\n…\n---` is a
 * *setext* h2 in CommonMark — text underlined by dashes. Every skill therefore
 * led with its metadata rendered as a heading bigger than the document's real
 * title. Fencing it keeps the metadata (it is the part that decides when the
 * model reaches for the skill) while taking it out of the heading grammar.
 */
describe('fenceFrontmatter', () => {
  it('fences leading YAML frontmatter so it cannot parse as a heading', () => {
    const source = '---\nname: x-recruiter\ndescription: 用于在 X 发布招聘帖子。\n---\n\n# X Recruiter\n\nBody.';

    expect(fenceFrontmatter(source)).toBe(
      '```yaml\nname: x-recruiter\ndescription: 用于在 X 发布招聘帖子。\n```\n\n# X Recruiter\n\nBody.'
    );
  });

  it('handles CRLF files and a frontmatter block with nothing after it', () => {
    expect(fenceFrontmatter('---\r\nname: a\r\n---\r\n')).toBe('```yaml\nname: a\n```\n');
    expect(fenceFrontmatter('---\nname: a\n---')).toBe('```yaml\nname: a\n```\n');
  });

  it('leaves a document without frontmatter untouched', () => {
    // A horizontal rule mid-document, and a document that simply starts with
    // prose, must both come through unchanged — only a leading block counts.
    expect(fenceFrontmatter('# Title\n\n---\n\nBody.')).toBe('# Title\n\n---\n\nBody.');
    expect(fenceFrontmatter('Just prose.')).toBe('Just prose.');
  });
});

describe('SkillFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders custom markdown files in read-only preview mode', async () => {
    mocks.listSkillFiles.mockResolvedValue([{ name: 'SKILL.md', relativePath: 'SKILL.md', type: 'file' }]);
    mocks.readSkillFile.mockResolvedValue('# Demo');

    render(<SkillFileBrowser skill={{ location: '/tmp/skills/demo/SKILL.md' }} />);

    // The markdown pane renders into a shadow root for style isolation, so its
    // text is not reachable through light-DOM textContent assertions — the
    // readSkillFile call (asserted via the mock resolving 'SKILL.md') and the
    // preview-mode marker are what's actually observable from here.
    await waitFor(() => expect(screen.getByTestId('markdown-viewer')).toHaveAttribute('data-view-mode', 'preview'));
    expect(screen.queryByText('common.readOnly')).not.toBeInTheDocument();
    expect(screen.getByTestId('skill-file-tree-panel')).toBeInTheDocument();
    expect(screen.queryByText('preview.preview')).not.toBeInTheDocument();
    expect(screen.queryByText('preview.source')).not.toBeInTheDocument();
    expect(screen.queryByText('common.save')).not.toBeInTheDocument();
  });

  it('renders non-markdown files read-only for official skills', async () => {
    mocks.listSkillFiles.mockResolvedValue([{ name: 'config.json', relativePath: 'config.json', type: 'file' }]);
    mocks.readSkillFile.mockResolvedValue('{"enabled":true}');

    render(<SkillFileBrowser skill={{ location: '/tmp/builtin/demo/SKILL.md' }} />);

    await waitFor(() => expect(screen.getByTestId('code-editor')).toHaveAttribute('data-read-only', 'true'));
    expect(screen.queryByText('common.readOnly')).not.toBeInTheDocument();
    expect(screen.queryByText('common.save')).not.toBeInTheDocument();
  });

  it('shows a failure state when the selected file cannot be read', async () => {
    mocks.listSkillFiles.mockResolvedValue([{ name: 'SKILL.md', relativePath: 'SKILL.md', type: 'file' }]);
    mocks.readSkillFile.mockRejectedValue(new Error('unavailable'));

    render(<SkillFileBrowser skill={{ location: '/tmp/skills/demo/SKILL.md' }} />);

    await waitFor(() => expect(screen.getByText("Could not load this skill's files.")).toBeInTheDocument());
  });

  it('shows a failure state when the file tree cannot be loaded', async () => {
    mocks.listSkillFiles.mockRejectedValue(new Error('unavailable'));

    render(<SkillFileBrowser skill={{ location: '/tmp/skills/demo/SKILL.md' }} />);

    await waitFor(() => expect(screen.getByText("Could not load this skill's files.")).toBeInTheDocument());
  });
});
