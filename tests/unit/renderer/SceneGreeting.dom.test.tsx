/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
