/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { TChatConversation } from '@/common/config/storage';

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

import SortableConversationRow from '@/renderer/pages/conversation/GroupedHistory/SortableConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const pinnedConversation = {
  id: 'conv-1',
  name: 'Pinned chat',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { pinned: true },
} as unknown as TChatConversation;

const onConversationClick = vi.fn();

const rowProps: ConversationRowProps = {
  conversation: pinnedConversation,
  isGenerating: false,
  hasUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: false,
  onToggleChecked: vi.fn(),
  onConversationClick,
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  getJobStatus: () => 'none',
};

const renderRow = (overrides: Partial<typeof rowProps> = {}) =>
  render(
    <DndContext>
      <SortableContext items={[pinnedConversation.id]} strategy={verticalListSortingStrategy}>
        <SortableConversationRow {...rowProps} {...overrides} />
      </SortableContext>
    </DndContext>
  );

// This fork makes the whole row the drag affordance (dnd-kit `listeners` are
// spread onto the wrapper) rather than rendering a separate grab handle the way
// upstream does, so these assert that contract instead of looking for a
// `conversation-drag-handle-*` element that this build never renders.
describe('SortableConversationRow', () => {
  it('makes the whole row draggable', () => {
    const { container } = renderRow();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    // dnd-kit marks an active draggable with its roledescription + a keyboard
    // affordance; both come from `attributes`/`listeners` on the wrapper.
    expect(wrapper.getAttribute('aria-roledescription')).toBe('sortable');
    expect(wrapper).toHaveAttribute('tabindex');
  });

  it('still opens the conversation on a plain click', () => {
    renderRow();
    fireEvent.click(screen.getByText(pinnedConversation.name));
    expect(onConversationClick).toHaveBeenCalled();
  });

  it('disables dragging in batch mode so selection clicks are not swallowed', () => {
    const { container } = renderRow({ batchMode: true });
    const wrapper = container.firstElementChild as HTMLElement;
    // `useSortable({ disabled })` keeps the element focusable but marks it
    // aria-disabled, which is how dnd-kit signals "not draggable right now".
    expect(wrapper).toHaveAttribute('aria-disabled', 'true');
  });

  it('is draggable when not in batch mode', () => {
    const { container } = renderRow();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('aria-disabled')).not.toBe('true');
  });
});
