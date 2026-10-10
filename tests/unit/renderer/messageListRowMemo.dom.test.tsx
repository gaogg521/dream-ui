/**
 * @license
 * Copyright 2026 One Work
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IMessageText, TMessage } from '@/common/chat/chatLib';
import { MessageListProvider, useUpdateMessageList } from '@/renderer/pages/conversation/Messages/hooks';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    key: 'location-key',
    state: {},
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <button {...props}>{children}</button>
  ),
  Image: {
    PreviewGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  },
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => null,
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  useConversationArtifacts: () => [],
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText', () => ({
  default: ({ message }: { message: IMessageText }) => (
    <div data-testid={`text-${message.msg_id}`} data-status={message.status ?? ''}>
      {message.content.content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: () => <div>tips</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => <div>tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: () => <div>tool_group</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => <div>agent_status</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePermission', () => ({
  default: () => <div>permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => <div>acp_permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: () => <div>acp_tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  default: () => <div>plan</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => <div>thinking</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => <div>cron_trigger</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => <div>skill_suggest</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: () => <div>tool_summary</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/MessageFileChanges', () => ({
  __esModule: true,
  default: () => <div>file_changes</div>,
  parseDiff: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>down</span>,
}));

let updateList: ((fn: (list: TMessage[]) => TMessage[]) => void) | null = null;

function CaptureUpdate(): null {
  const update = useUpdateMessageList();
  updateList = update as unknown as (fn: (list: TMessage[]) => TMessage[]) => void;
  return null;
}

const midturnMessage: IMessageText = {
  id: 'um-1',
  msg_id: 'um-1',
  conversation_id: 'conversation-1',
  type: 'text',
  position: 'right',
  status: 'pending',
  content: { content: 'also update the docs' },
  created_at: 1,
};

describe('MessageList row memo', () => {
  // A message delivered into a running turn arrives as `pending` (the "delivering"
  // badge) and is flipped to `finish` by a separate message.statusChanged event.
  // When the two land in different renders, the row must re-render for the flip,
  // or the badge stays up until the turn ends and the page is reloaded.
  it('re-renders a row when only its status changes', () => {
    render(
      <MessageListProvider value={[midturnMessage]}>
        <CaptureUpdate />
        <MessageList />
      </MessageListProvider>
    );
    expect(screen.getByTestId('text-um-1').dataset.status).toBe('pending');

    act(() => {
      updateList?.((list) =>
        list.map((message) => (message.msg_id === 'um-1' ? { ...message, status: 'finish' } : message))
      );
    });

    expect(screen.getByTestId('text-um-1').dataset.status).toBe('finish');
  });
});
