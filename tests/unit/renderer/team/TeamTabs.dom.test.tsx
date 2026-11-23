import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamAssistant } from '@/common/types/team/teamTypes';

vi.mock('@/renderer/pages/team/components/AgentStatusBadge', () => ({
  default: ({ testId }: { testId: string }) => <span data-testid={testId} />,
}));

vi.mock('@/renderer/pages/team/components/TeamAgentIdentity', () => ({
  default: ({ assistant_name, nameTestId }: { assistant_name: string; nameTestId?: string }) => (
    <span data-testid={nameTestId}>{assistant_name}</span>
  ),
}));

vi.mock('@/renderer/pages/team/components/memberPicker/TeamAddMemberPopover', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import TeamTabs from '@/renderer/pages/team/components/TeamTabs';
import { TeamTabsProvider } from '@/renderer/pages/team/hooks/TeamTabsContext';

const renameAssistantMock = vi.fn();

const assistants: TeamAssistant[] = [
  {
    slot_id: 'lead-slot',
    conversation_id: 'lead-conv',
    role: 'leader',
    assistant_backend: 'claude',
    assistant_name: 'Lead',
    status: 'idle',
  },
  {
    slot_id: 'worker-slot',
    conversation_id: 'worker-conv',
    role: 'teammate',
    assistant_backend: 'claude',
    assistant_name: 'Worker',
    status: 'idle',
  },
];

const renderTabs = (warmingUp: boolean, members = assistants) =>
  render(
    <TeamTabsProvider
      assistants={members}
      statusMap={new Map()}
      defaultActiveSlotId='lead-slot'
      team_id='team-1'
      renameAssistant={renameAssistantMock}
    >
      <TeamTabs warmingUp={warmingUp} />
    </TeamTabsProvider>
  );

describe('TeamTabs', () => {
  beforeEach(() => {
    renameAssistantMock.mockReset();
    localStorage.clear();
  });

  it('does not allow tab rename while the team is still warming up', () => {
    renderTabs(true);

    fireEvent.doubleClick(screen.getByTestId('team-tab-worker-slot'));

    expect(screen.queryByTestId('team-tab-edit-worker-slot')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('Worker')).not.toBeInTheDocument();
    expect(renameAssistantMock).not.toHaveBeenCalled();
  });

  it('allows member ops once warmup has ended (ready or failed)', () => {
    renderTabs(false);

    // hover reveals the rename affordance and double-click enters edit mode
    fireEvent.mouseEnter(screen.getByTestId('team-tab-worker-slot'));
    fireEvent.doubleClick(screen.getByTestId('team-tab-worker-slot'));

    expect(screen.getByDisplayValue('Worker')).toBeInTheDocument();
  });

  it('reveals a drag handle on teammate hover but never on the leader', () => {
    renderTabs(false);

    fireEvent.mouseEnter(screen.getByTestId('team-tab-worker-slot'));
    expect(screen.getByTestId('team-tab-drag-worker-slot')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('team-tab-lead-slot'));
    expect(screen.queryByTestId('team-tab-drag-lead-slot')).not.toBeInTheDocument();
  });

  it('converts vertical mouse wheel movement into horizontal scrolling', () => {
    renderTabs(false);
    const tab = screen.getByTestId('team-tab-worker-slot');
    const scroller = tab.parentElement!;
    const wheel = new WheelEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true });

    fireEvent(tab, wheel);

    expect(scroller.scrollLeft).toBe(80);
    expect(wheel.defaultPrevented).toBe(true);
  });

  it('sorts by dragging the member label and leaves the leader first', async () => {
    renderTabs(false, [
      ...assistants,
      { ...assistants[1], slot_id: 'second-worker', conversation_id: 'second-conv', assistant_name: 'Second' },
    ]);
    const tabs = screen.getAllByTestId(/^team-tab-(lead-slot|worker-slot|second-worker)$/);
    tabs.forEach((tab, index) => {
      tab.getBoundingClientRect = () => new DOMRect(index * 100, 0, 90, 34);
    });
    const label = screen.getByTestId('team-tab-name-worker-slot');
    const pointer = (target: EventTarget, type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY: 16 });
      Object.defineProperty(event, 'isPrimary', { value: true });
      fireEvent(target, event);
    };

    pointer(label, 'pointerdown', 140);
    pointer(document, 'pointermove', 155);
    pointer(document, 'pointermove', 245);
    await act(async () => pointer(document, 'pointerup', 245));

    expect(screen.getAllByTestId(/^team-tab-(lead-slot|worker-slot|second-worker)$/)).toEqual([
      tabs[0],
      tabs[2],
      tabs[1],
    ]);
  });

  it('does not switch tabs when the drag handle is clicked', () => {
    renderTabs(false);

    // Active tab starts as the leader
    expect(screen.getByTestId('team-tab-lead-slot')).toHaveAttribute('data-active', 'true');

    fireEvent.mouseEnter(screen.getByTestId('team-tab-worker-slot'));
    fireEvent.click(screen.getByTestId('team-tab-drag-worker-slot'));

    expect(screen.getByTestId('team-tab-lead-slot')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('team-tab-worker-slot')).toHaveAttribute('data-active', 'false');
  });
});
