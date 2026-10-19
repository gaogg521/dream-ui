/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key),
  }),
}));

import SceneBadge from '@/renderer/components/scenes/SceneBadge';

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
});
