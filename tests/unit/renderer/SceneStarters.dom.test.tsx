/** @vitest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';

const hooks = vi.hoisted(() => ({ get: vi.fn(), messages: [] as unknown[], emit: vi.fn() }));

vi.mock('@/common', () => ({ ipcBridge: { conversation: { get: { invoke: hooks.get } } } }));
vi.mock('@renderer/pages/conversation/Messages/hooks', () => ({ useMessageList: () => hooks.messages }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: hooks.emit } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import SceneStarters from '@/renderer/components/scenes/SceneStarters';

const renderStarters = (hasInput = false) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SceneStarters conversationId='c1' hasInput={hasInput} />
    </SWRConfig>
  );

describe('SceneStarters', () => {
  beforeEach(() => {
    hooks.messages = [];
    hooks.emit.mockReset();
    hooks.get
      .mockReset()
      .mockResolvedValue({ id: 'c1', extra: { scene_starters: ['Make me a website', 'Plan a launch'] } });
  });

  it('offers the scene example openers before anything has been said', async () => {
    renderStarters();
    expect(await screen.findByText('Make me a website')).toBeInTheDocument();
    expect(screen.getByText('Plan a launch')).toBeInTheDocument();
    expect(screen.getByText('common.scenes.tryOpening')).toBeInTheDocument();
  });

  it('puts the sentence into the input and sends nothing', async () => {
    renderStarters();
    fireEvent.click(await screen.findByText('Make me a website'));
    expect(hooks.emit).toHaveBeenCalledTimes(1);
    expect(hooks.emit).toHaveBeenCalledWith('sendbox.fill', 'Make me a website');
  });

  it('goes away once the conversation has begun, and over a draft', async () => {
    hooks.messages = [{ id: 'm1' }];
    const view = renderStarters();
    await Promise.resolve();
    expect(screen.queryByText('Make me a website')).not.toBeInTheDocument();
    view.unmount();
    hooks.messages = [];
    renderStarters(true);
    await Promise.resolve();
    expect(screen.queryByText('Make me a website')).not.toBeInTheDocument();
  });

  it('shows nothing for a conversation that did not start from a scene, or whose starters are unusable', async () => {
    hooks.get.mockResolvedValue({ id: 'c1', extra: {} });
    const first = renderStarters();
    await Promise.resolve();
    expect(screen.queryByTestId('scene-starters')).not.toBeInTheDocument();
    first.unmount();
    hooks.get.mockResolvedValue({ id: 'c1', extra: { scene_starters: ['  ', 7, null] } });
    renderStarters();
    await Promise.resolve();
    expect(screen.queryByTestId('scene-starters')).not.toBeInTheDocument();
  });
});
