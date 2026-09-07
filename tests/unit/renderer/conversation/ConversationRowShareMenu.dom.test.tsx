/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({ disabled: true }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const conversation = {
  id: 'share-menu-conversation',
  name: 'Weekly ops',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'claude' },
  model: {},
} as TChatConversation;

const makeProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation,
  isGenerating: false,
  hasUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: true,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  getJobStatus: () => 'none',
  ...overrides,
});

/**
 * "Share to the organization" only makes sense to someone who has one.
 *
 * The row used to receive `onShare` unconditionally, so a personal user saw
 * the entry on every conversation and clicking it produced "当前企业未开启会话
 * 分享" — a sentence about a company they are not in. The parent now passes
 * `onShare` only for a resolved enterprise member, and this pins the row's
 * half of that contract in both directions.
 */
describe('conversation share menu item', () => {
  it('offers sharing when the parent supplies a share handler', async () => {
    const onShare = vi.fn();
    render(<ConversationRow {...makeProps({ onShare })} />);

    const share = await screen.findByText('conversation.history.shareToOrg');
    fireEvent.click(share);
    await waitFor(() => expect(onShare).toHaveBeenCalledWith(conversation));
  });

  it('hides sharing entirely when there is no organization to share with', async () => {
    render(<ConversationRow {...makeProps({ onShare: undefined })} />);

    // Wait for the menu itself, so absence means "the menu rendered without
    // this item" rather than "the menu had not rendered yet".
    await screen.findByText('conversation.history.rename');
    expect(screen.queryByText('conversation.history.shareToOrg')).toBeNull();
  });
});
