import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
