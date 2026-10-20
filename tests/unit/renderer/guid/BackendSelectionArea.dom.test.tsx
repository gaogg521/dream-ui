import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import BackendSelectionArea from '@/renderer/pages/guid/components/BackendSelectionArea';

vi.mock('@/renderer/utils/model/assistantAvatar', () => ({
  resolveAssistantAvatar: () => ({ kind: 'emoji', value: 'A' }),
}));

const backend = (status: Assistant['agent_status']): Assistant =>
  ({
    id: `bare:test-${status}`,
    source: 'generated',
    name: `Test ${status}`,
    name_i18n: {},
    description_i18n: {},
    enabled: true,
    sort_order: 0,
    agent_id: `agent-${status}`,
    agent: { type: 'acp', source: 'builtin', acp_backend: 'test' },
    enabled_skills: [],
    custom_skill_names: [],
    disabled_builtin_skills: [],
    context_i18n: {},
    prompts: [],
    prompts_i18n: {},
    models: [],
    agent_status: status,
    team_selectable: true,
    deletable: false,
  }) as Assistant;

describe('BackendSelectionArea', () => {
  it('keeps an offline installed backend visible but prevents selecting it', () => {
    const onSelectBackend = vi.fn();
    render(
      <BackendSelectionArea
        assistants={[backend('online'), backend('offline')]}
        selectedBackendAgentId='agent-online'
        localeKey='en-US'
        onSelectBackend={onSelectBackend}
      />
    );

    expect(screen.getByTestId('backend-pill-agent-online')).toBeEnabled();
    expect(screen.getByTestId('backend-pill-agent-online')).toHaveStyle({
      background: 'rgb(var(--success-6))',
      color: '#fff',
    });
    expect(screen.getByTestId('backend-pill-agent-online').className).toContain('agentSelectorActive');
    expect(screen.getByTestId('backend-pill-agent-offline')).toBeDisabled();
    expect(screen.getByTestId('backend-pill-agent-offline')).toHaveAttribute('data-backend-available', 'false');
  });

  it('shows five pills and offers the rest from a "more" menu', async () => {
    const onSelectBackend = vi.fn();
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      ...backend('online'),
      id: `bare:t-${n}`,
      agent_id: `agent-${n}`,
      sort_order: n,
    }));
    render(
      <BackendSelectionArea
        assistants={many}
        selectedBackendAgentId='agent-1'
        localeKey='en-US'
        onSelectBackend={onSelectBackend}
      />
    );

    expect(screen.getAllByTestId(/^backend-pill-/)).toHaveLength(5);
    expect(screen.queryByTestId('backend-pill-agent-6')).toBeNull();

    fireEvent.click(screen.getByTestId('backend-more'));
    const item = await waitFor(() => screen.getByTestId('backend-more-agent-6'));
    fireEvent.click(item);
    expect(onSelectBackend).toHaveBeenCalledWith('agent-6');
  });

  it('has no "more" button when everything fits', () => {
    render(
      <BackendSelectionArea
        assistants={[backend('online')]}
        selectedBackendAgentId='agent-online'
        localeKey='en-US'
        onSelectBackend={vi.fn()}
      />
    );
    expect(screen.queryByTestId('backend-more')).toBeNull();
  });
});
