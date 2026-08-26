/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GuidModelSelector from '@/renderer/pages/guid/components/GuidModelSelector';

const { useCodexBridgeEnabledMock, useClaudeBridgeEnabledMock, useCodexBridgeModelMock, useClaudeBridgeModelMock } =
  vi.hoisted(() => ({
    useCodexBridgeEnabledMock: vi.fn(),
    useClaudeBridgeEnabledMock: vi.fn(),
    useCodexBridgeModelMock: vi.fn(),
    useClaudeBridgeModelMock: vi.fn(),
  }));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: [] }),
}));

vi.mock('@/renderer/hooks/agent/useCodexBridgeStatus', () => ({
  useCodexBridgeEnabled: useCodexBridgeEnabledMock,
  useCodexBridgeModel: useCodexBridgeModelMock,
}));

vi.mock('@/renderer/hooks/agent/useClaudeBridgeStatus', () => ({
  useClaudeBridgeEnabled: useClaudeBridgeEnabledMock,
  useClaudeBridgeModel: useClaudeBridgeModelMock,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  getModelDisplayLabel: ({
    selectedLabel,
    selected_value,
    fallbackLabel,
  }: {
    selectedLabel?: string;
    selected_value?: string | null;
    fallbackLabel: string;
  }) => selectedLabel || selected_value || fallbackLabel,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === 'common.defaultModel') return 'Default';
      if (key === 'common.model') return 'Model';
      if (key === 'conversation.welcome.modelSwitchNotSupported') return 'Model switch is not supported';
      if (key === 'agent.thoughtLevel.label') return 'Thinking Level';
      if (key === 'agent.model.codexBridgeLocked') return 'Bridged';
      if (key === 'agent.model.codexBridgeLockedTooltip') return 'Bridged tooltip';
      if (key === 'agent.model.claudeBridgeLocked') return 'Claude Bridged';
      if (key === 'agent.model.claudeBridgeLockedTooltip') return 'Claude Bridged tooltip';
      return key;
    },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>v</span>,
  Plus: () => <span aria-hidden='true'>+</span>,
  Search: () => <span aria-hidden='true'>search</span>,
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({ children, className }: { children?: React.ReactNode; className?: string }) => (
      <div data-testid='guid-model-menu' className={className}>
        {children}
      </div>
    ),
    {
      Item: ({
        children,
        className,
        onClick,
      }: {
        children?: React.ReactNode;
        className?: string;
        onClick?: () => void;
      }) => (
        <div role='menuitem' className={className} onClick={onClick}>
          {children}
        </div>
      ),
      ItemGroup: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group' aria-label={String(title)}>
          <div>{title}</div>
          {children}
        </div>
      ),
      // SubMenu renders both its title row and its children so tests can inspect both levels.
      SubMenu: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group'>
          <div data-testid='submenu-title'>{title}</div>
          <div data-testid='submenu-body'>{children}</div>
        </div>
      ),
    }
  );

  return {
    Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
      <button type='button' {...props}>
        {children}
      </button>
    ),
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Menu,
    // Needed since every model row carries a kind tag: previously each row
    // resolved to no kind, so ModelKindTag returned null and never reached Tag.
    Tag: ({ children }: { children?: React.ReactNode }) => <span data-testid='model-kind-tag'>{children}</span>,
    Tooltip: ({ children, content }: { children?: React.ReactNode; content?: React.ReactNode }) => (
      <span data-tooltip-content={typeof content === 'string' ? content : undefined}>{children}</span>
    ),
  };
});

describe('GuidModelSelector', () => {
  beforeEach(() => {
    useCodexBridgeEnabledMock.mockReturnValue(false);
    useClaudeBridgeEnabledMock.mockReturnValue(false);
    useCodexBridgeModelMock.mockReturnValue(null);
    useClaudeBridgeModelMock.mockReturnValue(null);
  });

  const thoughtLevelOption = {
    id: 'reasoning_effort',
    category: 'thought_level',
    currentValue: 'medium',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  };

  it('shows ACP model descriptions in option tooltips', () => {
    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'default',
          current_model_label: 'Default',
          available_models: [
            {
              id: 'default',
              label: 'Default',
              description: 'Use the default model currently configured by the CLI',
            },
          ],
        }}
        selectedAcpModel='default'
        setSelectedAcpModel={vi.fn()}
      />
    );

    expect(screen.queryByText('Use the default model currently configured by the CLI')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('guid-model-menu')).getByText('Default').closest('[data-tooltip-content]')
    ).toHaveAttribute('data-tooltip-content', 'Use the default model currently configured by the CLI');
  });

  it('splits ACP model and thought level into two submenus', () => {
    const setSelectedAcpModel = vi.fn();
    const onThoughtLevelSelect = vi.fn();

    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'gpt-5.3-codex',
          current_model_label: 'gpt-5.3-codex',
          available_models: [
            { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
            { id: 'gpt-5.4-codex', label: 'gpt-5.4-codex' },
          ],
        }}
        selectedAcpModel='gpt-5.3-codex'
        setSelectedAcpModel={setSelectedAcpModel}
        thoughtLevelOption={thoughtLevelOption}
        onThoughtLevelSelect={onThoughtLevelSelect}
      />
    );

    expect(screen.getByText('gpt-5.3-codex · Medium')).toBeInTheDocument();

    // First level: model submenu on top (shows current model), thought submenu below.
    const titles = screen.getAllByTestId('submenu-title');
    expect(titles[0]).toHaveTextContent('Model');
    expect(titles[0]).toHaveTextContent('gpt-5.3-codex');
    expect(titles[1]).toHaveTextContent('Thinking Level');
    expect(titles[1]).toHaveTextContent('Medium');

    // Second level: each submenu body holds the full option list.
    const bodies = screen.getAllByTestId('submenu-body');
    fireEvent.click(within(bodies[0]).getByText('gpt-5.4-codex'));
    fireEvent.click(within(bodies[1]).getByText('High'));

    expect(setSelectedAcpModel).toHaveBeenCalledWith('gpt-5.4-codex');
    expect(onThoughtLevelSelect).toHaveBeenCalledWith('high');
  });

  it('does not add thought level options to the Aion CLI provider model menu', () => {
    render(
      <GuidModelSelector
        isGeminiMode
        modelList={[{ id: 'openai', name: 'OpenAI', enabled: true, models: ['gpt-5.3-codex'] } as any]}
        current_model={{ id: 'openai', name: 'OpenAI', models: ['gpt-5.3-codex'], use_model: 'gpt-5.3-codex' } as any}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={null}
        selectedAcpModel={null}
        setSelectedAcpModel={vi.fn()}
        thoughtLevelOption={thoughtLevelOption}
        onThoughtLevelSelect={vi.fn()}
      />
    );

    expect(screen.getAllByText('gpt-5.3-codex').length).toBeGreaterThan(0);
    expect(screen.queryByText('Thinking Level')).not.toBeInTheDocument();
    expect(screen.queryByText('Medium')).not.toBeInTheDocument();
  });

  it('locks the model as read-only when the Codex bridge is enabled for the codex tab', () => {
    useCodexBridgeEnabledMock.mockReturnValue(true);

    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'gpt-5.3-codex',
          current_model_label: 'gpt-5.3-codex',
          available_models: [{ id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' }],
        }}
        selectedAcpModel='gpt-5.3-codex'
        setSelectedAcpModel={vi.fn()}
        backend='codex'
      />
    );

    const pill = screen.getByTestId('guid-model-selector-bridge-locked');
    expect(pill).toHaveTextContent('gpt-5.3-codex · Bridged');
    expect(pill.closest('[data-tooltip-content]')).toHaveAttribute('data-tooltip-content', 'Bridged tooltip');
    expect(screen.queryByTestId('guid-model-menu')).not.toBeInTheDocument();
  });

  it('shows the bridge-configured model instead of the stale ACP session-advertised model when locked', () => {
    useCodexBridgeEnabledMock.mockReturnValue(true);
    useCodexBridgeModelMock.mockReturnValue('glm-5-2-aliyun');

    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'gpt-5.3-codex',
          current_model_label: 'gpt-5.3-codex',
          available_models: [{ id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' }],
        }}
        selectedAcpModel='gpt-5.3-codex'
        setSelectedAcpModel={vi.fn()}
        backend='codex'
      />
    );

    const pill = screen.getByTestId('guid-model-selector-bridge-locked');
    expect(pill).toHaveTextContent('glm-5-2-aliyun · Bridged');
    expect(pill).not.toHaveTextContent('gpt-5.3-codex');
  });

  it('locks the model as read-only when the Claude bridge is enabled for the claude tab', () => {
    useClaudeBridgeEnabledMock.mockReturnValue(true);

    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'claude-sonnet-latest',
          current_model_label: 'claude-sonnet-latest',
          available_models: [{ id: 'claude-sonnet-latest', label: 'claude-sonnet-latest' }],
        }}
        selectedAcpModel='claude-sonnet-latest'
        setSelectedAcpModel={vi.fn()}
        backend='claude'
      />
    );

    const pill = screen.getByTestId('guid-model-selector-bridge-locked');
    expect(pill).toHaveTextContent('claude-sonnet-latest · Claude Bridged');
    expect(pill.closest('[data-tooltip-content]')).toHaveAttribute('data-tooltip-content', 'Claude Bridged tooltip');
  });

  it('does not lock the model for non-bridged backends even when a bridge is enabled', () => {
    useCodexBridgeEnabledMock.mockReturnValue(true);
    useClaudeBridgeEnabledMock.mockReturnValue(true);

    render(
      <GuidModelSelector
        isGeminiMode={false}
        modelList={[]}
        current_model={undefined}
        setCurrentModel={vi.fn()}
        currentAcpCachedModelInfo={{
          current_model_id: 'gemini-3-pro',
          current_model_label: 'gemini-3-pro',
          available_models: [{ id: 'gemini-3-pro', label: 'gemini-3-pro' }],
        }}
        selectedAcpModel='gemini-3-pro'
        setSelectedAcpModel={vi.fn()}
        backend='gemini'
      />
    );

    expect(screen.queryByTestId('guid-model-selector-bridge-locked')).not.toBeInTheDocument();
    expect(screen.getByTestId('guid-model-menu')).toBeInTheDocument();
  });
});
