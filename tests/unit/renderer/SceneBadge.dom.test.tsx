/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key),
  }),
}));

const quickEdit = vi.hoisted(() => ({ canEdit: vi.fn(), open: vi.fn() }));
vi.mock('@/renderer/hooks/enterprise/useSceneQuickEdit', () => ({
  useSceneQuickEdit: () => ({ canEdit: quickEdit.canEdit, open: quickEdit.open, element: null }),
}));

import SceneBadge from '@/renderer/components/scenes/SceneBadge';

const greeting = { name: '生活助手', description: '', skills: [], tools: [], asksFirst: false };

describe('SceneBadge', () => {
  it('stays in the header and opens what the scene is doing', async () => {
    render(
      <SceneBadge
        greeting={{
          name: '数据分析与报告',
          description: '',
          skills: [],
          tools: [],
          asksFirst: false,
          role: '你是一名严谨的数据分析师。',
        }}
      />
    );
    expect(screen.getByTestId('scene-badge')).toHaveTextContent('common.scenes.badge.label');
    fireEvent.click(screen.getByTestId('scene-badge'));
    const panel = await screen.findByTestId('scene-badge-panel');
    expect(panel).toHaveTextContent('common.scenes.badge.title{"name":"数据分析与报告"}');
    expect(panel).toHaveTextContent('你是一名严谨的数据分析师。');
  });

  it('offers to edit a scene the person owns, and explains a company scene is not theirs to edit', async () => {
    quickEdit.canEdit.mockReset().mockReturnValue(true);
    quickEdit.open.mockReset();
    const { unmount } = render(<SceneBadge greeting={greeting} sceneKey='mine:builtin-life-v1' />);
    fireEvent.click(screen.getByTestId('scene-badge'));
    fireEvent.click(await screen.findByTestId('scene-badge-edit'));
    expect(quickEdit.open).toHaveBeenCalledWith('mine:builtin-life-v1');
    unmount();

    quickEdit.canEdit.mockReturnValue(false);
    render(<SceneBadge greeting={greeting} sceneKey='company-scene' />);
    fireEvent.click(screen.getByTestId('scene-badge'));
    expect(await screen.findByTestId('scene-badge-readonly')).toHaveTextContent('common.scenes.editCompanyReadOnly');
    expect(screen.queryByTestId('scene-badge-edit')).toBeNull();
  });

  it('shows no edit entry for a conversation that does not know its scene', async () => {
    quickEdit.canEdit.mockReset().mockReturnValue(true);
    render(<SceneBadge greeting={greeting} />);
    fireEvent.click(screen.getByTestId('scene-badge'));
    await screen.findByTestId('scene-badge-panel');
    expect(screen.queryByTestId('scene-badge-edit')).toBeNull();
    expect(screen.queryByTestId('scene-badge-readonly')).toBeNull();
  });
});
