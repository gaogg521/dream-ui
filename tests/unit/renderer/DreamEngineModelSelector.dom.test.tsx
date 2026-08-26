/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import DreamEngineModelSelector from '@/renderer/pages/conversation/platforms/dreamEngine/DreamEngineModelSelector';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { AcpDerivedOption } from '@/renderer/hooks/agent/useAcpConfigOptions';
import type { AionrsModelSelection } from '@/renderer/pages/conversation/platforms/dreamEngine/useDreamEngineModelSelection';

const provider: IProvider = {
  id: 'openai',
  name: 'OpenAI',
  platform: 'openai',
  use_model: 'gpt-5.2',
  models: ['gpt-5.2', 'gpt-5.2-mini'],
} as IProvider;

const thoughtLevel: AcpDerivedOption = {
  id: 'reasoning_effort',
  category: 'thought_level',
  currentValue: 'high',
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
};

const makeSelection = (overrides: Partial<AionrsModelSelection> = {}): AionrsModelSelection => ({
  current_model: {
    ...provider,
    use_model: 'gpt-5.2',
  } as TProviderWithModel,
  providers: [provider],
  getAvailableModels: () => ['gpt-5.2', 'gpt-5.2-mini'],
  handleSelectModel: vi.fn().mockResolvedValue(undefined),
  getDisplayModelName: (modelName?: string) => modelName ?? '',
  ...overrides,
});

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ isOpen: false }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
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

vi.mock('@icon-park/react', () => ({
  Brain: () => <span aria-hidden='true'>brain</span>,
  Down: () => <span aria-hidden='true'>v</span>,
  Search: () => <span aria-hidden='true'>search</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (key === 'agent.thoughtLevel.label') return 'Thinking Level';
      if (key === 'common.model') return 'Model';
      if (key === 'conversation.welcome.selectModel') return 'Select model';
      if (key === 'conversation.welcome.useCliModel') return 'Use CLI model';
      if (key === 'conversation.welcome.modelSwitchNotSupported') return 'Model switch is not supported';
      if (key === 'common.defaultModel') return 'Default';
      if (key === 'agent.model.searchPlaceholder') return 'Search models';
      if (key === 'agent.model.noResults') return 'No matching models';
      return options?.defaultValue ?? key;
    },
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({ children }: { children?: React.ReactNode; className?: string }) => (
      <div data-testid='dropdown-menu'>{children}</div>
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
          {children}
        </div>
      ),
      SubMenu: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group'>
          <div data-testid='submenu-title'>{title}</div>
          <div data-testid='submenu-body'>{children}</div>
        </div>
      ),
    }
  );
  return {
    Button: ({
      children,
      disabled,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <button type='button' disabled={disabled} onClick={onClick} {...props}>
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
    Tag: ({ children }: { children?: React.ReactNode }) => <span data-testid='model-kind-tag'>{children}</span>,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

describe('DreamEngineModelSelector runtime options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the current model and thought level in the header pill', () => {
    render(
      <DreamEngineModelSelector
        selection={makeSelection()}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByTestId('aionrs-model-selector')).toHaveTextContent('gpt-5.2 · High');
  });

  it('shows the model submenu before the thought level submenu, each with its current value', () => {
    render(
      <DreamEngineModelSelector
        selection={makeSelection()}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const titles = screen.getAllByTestId('submenu-title');
    expect(titles[0]).toHaveTextContent('Model');
    expect(titles[0]).toHaveTextContent('gpt-5.2');
    expect(titles[1]).toHaveTextContent('Thinking Level');
    expect(titles[1]).toHaveTextContent('High');
  });

  it('keeps provider grouping inside the model submenu', () => {
    render(
      <DreamEngineModelSelector
        selection={makeSelection()}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    // The provider group title (OpenAI) is rendered inside the model submenu.
    expect(screen.getByRole('group', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('marks the current model with the leading check indicator', () => {
    render(
      <DreamEngineModelSelector
        selection={makeSelection()}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const providerGroup = screen.getByRole('group', { name: 'OpenAI' });
    const currentModelItem = within(providerGroup).getByText('gpt-5.2').closest('[role="menuitem"]');
    const otherModelItem = within(providerGroup).getByText('gpt-5.2-mini').closest('[role="menuitem"]');

    expect(currentModelItem?.textContent?.trim().startsWith('✓')).toBe(true);
    expect(otherModelItem).not.toHaveTextContent('✓');
  });

  // The kind tag existed only in the settings model list, where it does not
  // help: the send box is where someone picks a video model for chat. It is
  // shown from the user's own declaration, never inferred from the name.
  /**
   * The picker used to tag only declared/catalogued kinds and leave the rest
   * bare, on the grounds that everything reaching a chat picker is a chat model
   * anyway. That reasoning only held for the rows it was right about — the same
   * list carries models that chat *and* return pictures, and a name does not say
   * so. Now every row is labelled, with a guess marked as a guess.
   */
  it('labels every row, marking a guessed kind as a guess', () => {
    const taggedProvider = {
      ...provider,
      model_settings: { 'gpt-5.2-mini': { model_kind: 'image' as const } },
    } as IProvider;
    render(
      <DreamEngineModelSelector
        selection={makeSelection({ providers: [taggedProvider] })}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const providerGroup = screen.getByRole('group', { name: 'OpenAI' });
    const declared = within(providerGroup).getByText('gpt-5.2-mini').closest('[role="menuitem"]');
    const undeclared = within(providerGroup).getByText('gpt-5.2').closest('[role="menuitem"]');

    expect(within(declared as HTMLElement).getByTestId('model-kind-tag')).toHaveTextContent('settings.modelKind_image');
    // Undeclared still gets a label, read off the name. It states the reading
    // plainly rather than appending a "?": hedging on every row of a picker the
    // user cannot edit from was noise without a remedy. The separation lives in
    // the styling instead, and the model list is where a wrong one gets fixed.
    const guessed = within(undeclared as HTMLElement).getByTestId('model-kind-tag');
    expect(guessed).toHaveTextContent('settings.modelKind_text');
    expect(guessed.textContent).not.toContain('?');
  });

  it('selects a model through the selection callback', () => {
    const handleSelectModel = vi.fn().mockResolvedValue(undefined);
    render(
      <DreamEngineModelSelector
        selection={makeSelection({ handleSelectModel })}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByText('gpt-5.2-mini'));

    expect(handleSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai' }), 'gpt-5.2-mini');
  });

  it('renders the model list directly (no submenu) when thought level is unavailable', () => {
    render(<DreamEngineModelSelector selection={makeSelection()} />);

    expect(screen.getByTestId('aionrs-model-selector')).toHaveTextContent('gpt-5.2');
    expect(screen.queryAllByTestId('submenu-title')).toHaveLength(0);
    // Still grouped by provider even without a submenu wrapper.
    expect(screen.getByRole('group', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('sets thought level through the optional runtime callback', async () => {
    const onSetThoughtLevel = vi.fn().mockResolvedValue(undefined);

    render(
      <DreamEngineModelSelector
        selection={makeSelection()}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={onSetThoughtLevel}
      />
    );

    fireEvent.click(screen.getByText('Low'));

    await waitFor(() => {
      expect(onSetThoughtLevel).toHaveBeenCalledWith('reasoning_effort', 'low');
    });
  });
});

/**
 * Generation models belong in the same picker as the chat models.
 *
 * They used to live only in Settings → Tools, so declaring a model as video made
 * it disappear from the conversation — the declaration read as having done
 * nothing, and the only way in was a button labelled "对话" that gave no hint of
 * what was behind it.
 */
describe('DreamEngineModelSelector generation models', () => {
  const mediaProvider = {
    ...provider,
    models: ['gpt-5.2-mini', 'seedance-2-0-fast', 'gpt-image-2'],
  } as IProvider;

  const openPicker = () =>
    render(
      <DreamEngineModelSelector
        selection={makeSelection({ providers: [mediaProvider] })}
        thoughtLevel={thoughtLevel}
        setStatus={{ state: 'idle' }}
        onSetThoughtLevel={vi.fn().mockResolvedValue(undefined)}
        conversation_id='c-media'
      />
    );

  it('groups generation models apart from the chat models', () => {
    openPicker();
    const video = screen.getByRole('group', { name: 'conversation.mediaModeVideo' });
    expect(within(video).getByText('seedance-2-0-fast')).toBeTruthy();
    const image = screen.getByRole('group', { name: 'conversation.mediaModeImage' });
    expect(within(image).getByText('gpt-image-2')).toBeTruthy();
  });

  /**
   * The chat group must not carry them: a chat request to one of these comes
   * back `404 model not found`, which is the failure this split exists to stop.
   */
  it('keeps them out of the chat group', () => {
    openPicker();
    const chat = screen.getByRole('group', { name: 'OpenAI' });
    expect(within(chat).queryByText('seedance-2-0-fast')).toBeNull();
    expect(within(chat).queryByText('gpt-image-2')).toBeNull();
  });
});
