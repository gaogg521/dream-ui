/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key}${JSON.stringify(options)}` : key),
  }),
}));

import SceneGreeting from '@/renderer/components/scenes/SceneGreeting';
import type { SceneGreeting as Greeting } from '@/renderer/utils/scenes/sceneChat';

const greeting = (patch: Partial<Greeting> = {}): Greeting => ({
  name: '官网与 AI 助理搭建',
  description: '从一句话需求到可交付的官网',
  icon: '🌐',
  skills: ['qa-meeting-brief', 'weekly-report'],
  tools: ['Business MCP'],
  asksFirst: true,
  ...patch,
});

describe('SceneGreeting', () => {
  it('says which scene this is and what it is for', () => {
    render(<SceneGreeting greeting={greeting()} />);
    expect(screen.getByText('common.scenes.greeting.hello{"name":"官网与 AI 助理搭建"}')).toBeInTheDocument();
    expect(screen.getByText('从一句话需求到可交付的官网')).toBeInTheDocument();
    expect(screen.getByText('🌐')).toBeInTheDocument();
  });

  it('lists the skills and tools that came with it', () => {
    render(<SceneGreeting greeting={greeting()} />);
    const skills = within(screen.getByTestId('scene-greeting-skills'));
    expect(skills.getByText('qa-meeting-brief')).toBeInTheDocument();
    expect(skills.getByText('weekly-report')).toBeInTheDocument();
    expect(within(screen.getByTestId('scene-greeting-tools')).getByText('Business MCP')).toBeInTheDocument();
  });

  it('says how it will work: it asks first, or it just takes the task', () => {
    const { rerender } = render(<SceneGreeting greeting={greeting({ asksFirst: true })} />);
    expect(screen.getByTestId('scene-greeting-how')).toHaveTextContent('common.scenes.greeting.asksFirst');
    rerender(<SceneGreeting greeting={greeting({ asksFirst: false })} />);
    expect(screen.getByTestId('scene-greeting-how')).toHaveTextContent('common.scenes.greeting.direct');
  });

  it('leaves out the skills and tools sections a scene did not bring, and the description it does not have', () => {
    render(<SceneGreeting greeting={greeting({ skills: [], tools: [], description: '', icon: undefined })} />);
    expect(screen.queryByTestId('scene-greeting-skills')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-greeting-tools')).not.toBeInTheDocument();
    expect(screen.getByTestId('scene-greeting')).toBeInTheDocument();
  });

  it('keeps a scene with many skills a greeting: the first few, then how many more', () => {
    const skills = Array.from({ length: 12 }, (_, i) => `skill-${i}`);
    render(<SceneGreeting greeting={greeting({ skills })} />);
    const shown = within(screen.getByTestId('scene-greeting-skills'));
    expect(shown.getByText('skill-7')).toBeInTheDocument();
    expect(shown.queryByText('skill-8')).not.toBeInTheDocument();
    expect(shown.getByText('common.scenes.greeting.more{"count":4}')).toBeInTheDocument();
  });
});

describe('SceneGreeting: what the scene changes', () => {
  it('says how this differs from a plain chat, and shows the role', () => {
    render(<SceneGreeting greeting={greeting({ role: '你是一名严谨的数据分析师。' })} />);
    expect(screen.getByText('common.scenes.greeting.difference')).toBeInTheDocument();
    expect(screen.getByTestId('scene-greeting-role')).toHaveTextContent('你是一名严谨的数据分析师。');
  });

  it('lists the hard rules and the hand-over when the scene has them', () => {
    const rules = ['不编造数据。', '口径要写进报告。'];
    render(<SceneGreeting greeting={greeting({ rules, deliverables: '一页结论摘要' })} />);
    fireEvent.click(screen.getByText('common.scenes.greeting.rulesCount{"count":2}'));
    fireEvent.click(screen.getByText('common.scenes.greeting.deliverables'));
    const shown = within(screen.getByTestId('scene-greeting-rules'));
    rules.forEach((rule) => expect(shown.getByText(rule)).toBeInTheDocument());
    expect(screen.getByTestId('scene-greeting-deliverables')).toHaveTextContent('一页结论摘要');
  });

  it('folds the rules and hand-over away under a headline that says how many rules there are', () => {
    const rules = Array.from({ length: 7 }, (_, i) => `rule-${i}`);
    render(<SceneGreeting greeting={greeting({ rules, deliverables: '一页结论摘要' })} />);
    expect(screen.getByText('common.scenes.greeting.rulesCount{"count":7}')).toBeInTheDocument();
    expect(screen.getByText('common.scenes.greeting.deliverables')).toBeInTheDocument();
    // Every rule is there once the section is opened; nothing is silently cut.
    fireEvent.click(screen.getByText('common.scenes.greeting.rulesCount{"count":7}'));
    rules.forEach((rule) =>
      expect(within(screen.getByTestId('scene-greeting-rules')).getByText(rule)).toBeInTheDocument()
    );
  });

  it('leaves out the role, rules and hand-over of a conversation opened before they were recorded', () => {
    render(<SceneGreeting greeting={greeting()} />);
    expect(screen.queryByTestId('scene-greeting-role')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-greeting-rules')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scene-greeting-deliverables')).not.toBeInTheDocument();
  });

  it('tells where the conversation works: the chosen folder, or a temporary one and how to pick another', () => {
    const { rerender } = render(<SceneGreeting greeting={greeting({ workspace: 'D:/projects/site' })} />);
    expect(screen.getByTestId('scene-greeting-workspace')).toHaveTextContent('D:/projects/site');
    rerender(<SceneGreeting greeting={greeting()} />);
    expect(screen.getByTestId('scene-greeting-workspace')).toHaveTextContent('common.scenes.greeting.workspaceTemp');
  });
});
