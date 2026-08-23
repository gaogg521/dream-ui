/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session Center behavior tests.
 *
 * The page had zero coverage while gaining required props (`isManualUnread` /
 * `onToggleManualUnread`) that only `tsc` was checking — a hook could be wired
 * to the wrong argument and still typecheck. These tests render the real
 * `ConversationRow` underneath the real page so the wiring is exercised end to
 * end rather than asserted against a mock of the thing under test.
 *
 * The "对话模式" column is the other reason this file exists: its value must
 * come from `useMediaJobs()` keyed by conversation id (with a workspace
 * fallback for agent-invoked jobs), never from `conversation.model` — the chat
 * model says nothing about what the last turn actually produced.
 */

import type { TChatConversation } from '@/common/config/storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  conversationsMock,
  conversationActionsMock,
  capturedConversationActionsArgs,
  mediaJobsMock,
  teamsMock,
  teamBadgesMock,
  navigateMock,
  locationMock,
  cronStatusMock,
} = vi.hoisted(() => ({
  conversationsMock: {
    conversations: [] as unknown[],
    isConversationGenerating: vi.fn((_id: string) => false),
    hasCompletionUnread: vi.fn((_id: string) => false),
    isManualUnread: vi.fn((_id: string) => false),
    markManualUnread: vi.fn(),
    clearManualUnread: vi.fn(),
    pinnedConversations: [] as unknown[],
    projectGroups: [] as unknown[],
    conversationOnlySections: [] as unknown[],
    expandedWorkspaces: [] as string[],
    handleToggleWorkspace: vi.fn(),
  },
  conversationActionsMock: {
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null as string | null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleEditStart: vi.fn(),
    handleCreateCronTask: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleToggleManualUnread: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
  },
  capturedConversationActionsArgs: [] as Array<Record<string, unknown>>,
  mediaJobsMock: { jobs: [] as unknown[] },
  teamsMock: { teams: [] as unknown[] },
  teamBadgesMock: new Map<string, number>(),
  navigateMock: vi.fn(),
  locationMock: { search: '', pathname: '/sessions', hash: '', state: null, key: 'session-center' },
  cronStatusMock: { markAsRead: vi.fn(), getJobStatus: vi.fn((_id: string) => 'none' as const) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Return the declared defaultValue when there is one so the column headers
    // and mode labels assert on real copy instead of raw keys.
    t: (key: string, options?: { defaultValue?: string; count?: number }) => options?.defaultValue ?? key,
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationMock,
  useParams: () => ({}),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => conversationsMock,
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: (args: Record<string, unknown>) => {
    capturedConversationActionsArgs.push(args);
    return conversationActionsMock;
  },
}));

vi.mock('@/renderer/hooks/media/useMediaJobs', () => ({
  useMediaJobs: () => mediaJobsMock,
}));

vi.mock('@/renderer/pages/cron', () => ({
  useCronJobsMap: () => cronStatusMock,
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/pages/team/hooks/useTeamList', () => ({
  useTeamList: () => teamsMock,
}));

vi.mock('@/renderer/pages/team/hooks/useSiderTeamBadges', () => ({
  useSiderTeamBadges: () => teamBadgesMock,
}));

// ConversationRow collaborators — mocked so the real row still renders, but
// without dragging in agent logos / preset assistant fetches.
vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({ disabled: true }),
}));

import SessionCenter from '@/renderer/pages/SessionCenter';

const NOW = Date.now();

const makeConversation = (overrides: Record<string, unknown> & { id: string }): TChatConversation =>
  ({
    name: `Conversation ${overrides.id}`,
    type: 'aionrs',
    created_at: NOW,
    modified_at: NOW,
    extra: {},
    model: { id: 'provider-openai', use_model: 'gpt-4o' },
    ...overrides,
  }) as unknown as TChatConversation;

const makeMediaJob = (overrides: Record<string, unknown>) => ({
  jobId: 'job-1',
  kind: 'image',
  status: 'done',
  model: 'seedream-4-0',
  origin: {},
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/** Feed the page a plain (non-pinned, non-project) history list. */
const setHistory = (conversations: TChatConversation[]) => {
  conversationsMock.conversations = conversations;
  conversationsMock.conversationOnlySections = [
    {
      timeline: 'recent',
      items: conversations.map((conversation) => ({ type: 'conversation', time: NOW, conversation })),
    },
  ];
};

/** The `detailed` row that carries the four-column grid, by conversation id. */
const detailedRow = (conversationId: string): HTMLElement => {
  const row = document.getElementById(`c-${conversationId}`);
  if (!row) throw new Error(`row for ${conversationId} not rendered`);
  return row;
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedConversationActionsArgs.length = 0;
  conversationsMock.conversations = [];
  conversationsMock.pinnedConversations = [];
  conversationsMock.projectGroups = [];
  conversationsMock.conversationOnlySections = [];
  conversationsMock.expandedWorkspaces = [];
  conversationsMock.isConversationGenerating.mockReturnValue(false);
  conversationsMock.hasCompletionUnread.mockReturnValue(false);
  conversationsMock.isManualUnread.mockReturnValue(false);
  conversationActionsMock.dropdownVisibleId = null;
  conversationActionsMock.renameModalVisible = false;
  mediaJobsMock.jobs = [];
  teamsMock.teams = [];
  teamBadgesMock.clear();
  cronStatusMock.getJobStatus.mockReturnValue('none');
  locationMock.search = '';
});

describe('SessionCenter list rendering', () => {
  it('renders teams, pinned, project and history sections together', () => {
    teamsMock.teams = [{ id: 'team-1', name: 'Growth squad', assistants: [{ id: 'a' }], updated_at: NOW }];
    teamBadgesMock.set('team-1', 3);
    conversationsMock.pinnedConversations = [makeConversation({ id: 'pinned-1', name: 'Pinned chat' })];
    conversationsMock.projectGroups = [
      {
        workspace: 'D:/ws/alpha',
        displayName: 'alpha',
        conversations: [makeConversation({ id: 'project-1', name: 'Project chat' })],
      },
    ];
    conversationsMock.expandedWorkspaces = ['D:/ws/alpha'];
    setHistory([makeConversation({ id: 'history-1', name: 'History chat' })]);

    render(<SessionCenter />);

    expect(screen.getByText('Growth squad')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Pinned chat')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('Project chat')).toBeInTheDocument();
    expect(screen.getByText('History chat')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing at all', () => {
    render(<SessionCenter />);

    expect(screen.getByText('conversation.history.noHistory')).toBeInTheDocument();
  });

  it('filters the list by the search box and reports an empty search separately', () => {
    setHistory([
      makeConversation({ id: 'a', name: 'Quarterly report' }),
      makeConversation({ id: 'b', name: 'Holiday plan' }),
    ]);

    render(<SessionCenter />);

    const search = screen.getByPlaceholderText('conversation.sessionCenter.searchPlaceholder');
    fireEvent.change(search, { target: { value: 'quarterly' } });

    expect(screen.getByText('Quarterly report')).toBeInTheDocument();
    expect(screen.queryByText('Holiday plan')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'nothing matches this' } });
    expect(screen.getByText('conversation.sessionCenter.emptySearch')).toBeInTheDocument();
  });

  it('navigates to a team when its row is clicked', () => {
    teamsMock.teams = [{ id: 'team-9', name: 'Ops squad', assistants: [], updated_at: NOW }];

    render(<SessionCenter />);
    fireEvent.click(screen.getByText('Ops squad'));

    expect(navigateMock).toHaveBeenCalledWith('/team/team-9');
  });
});

describe('SessionCenter detailed table columns', () => {
  it('renders the four column headers over the history list', () => {
    setHistory([makeConversation({ id: 'h1' })]);

    render(<SessionCenter />);

    expect(screen.getByText('标题')).toBeInTheDocument();
    expect(screen.getByText('模式')).toBeInTheDocument();
    expect(screen.getByText('模型')).toBeInTheDocument();
    expect(screen.getByText('更新时间')).toBeInTheDocument();
  });

  it('only renders history rows in the detailed four-column layout', () => {
    conversationsMock.pinnedConversations = [makeConversation({ id: 'pinned-1', name: 'Pinned chat' })];
    setHistory([makeConversation({ id: 'h1', name: 'History chat' })]);

    render(<SessionCenter />);

    // Detailed rows are taller and carry a mode cell; pinned/compact rows do not.
    expect(detailedRow('h1').className).toContain('h-46px');
    expect(within(detailedRow('h1')).getByText('对话')).toBeInTheDocument();
    expect(detailedRow('pinned-1').className).toContain('h-34px');
    expect(within(detailedRow('pinned-1')).queryByText('对话')).not.toBeInTheDocument();
  });

  it('shows the persisted chat model for an aionrs conversation and a dash when there is none', () => {
    setHistory([
      makeConversation({ id: 'h1', name: 'Aionrs chat' }),
      makeConversation({ id: 'h2', name: 'Acp chat', type: 'acp', extra: { backend: 'claude' } }),
    ]);

    render(<SessionCenter />);

    expect(within(detailedRow('h1')).getByText('gpt-4o')).toBeInTheDocument();
    // ACP conversations have no persisted provider/model selection to show.
    expect(within(detailedRow('h2')).getByText('—')).toBeInTheDocument();
  });
});

describe('SessionCenter "对话模式" column data source', () => {
  it('reads the mode from the media job history keyed by conversation id', () => {
    setHistory([
      makeConversation({ id: 'chat-only', name: 'Text only' }),
      makeConversation({ id: 'drew-image', name: 'Drew an image' }),
      makeConversation({ id: 'made-video', name: 'Made a video' }),
    ]);
    mediaJobsMock.jobs = [
      makeMediaJob({ jobId: 'j1', kind: 'image', model: 'seedream-4-0', origin: { conversationId: 'drew-image' } }),
      makeMediaJob({
        jobId: 'j2',
        kind: 'video',
        model: 'seedance-2-0-fast',
        origin: { conversationId: 'made-video' },
      }),
    ];

    render(<SessionCenter />);

    expect(within(detailedRow('chat-only')).getByText('对话')).toBeInTheDocument();
    expect(within(detailedRow('drew-image')).getByText('图片生成')).toBeInTheDocument();
    expect(within(detailedRow('made-video')).getByText('视频生成')).toBeInTheDocument();
  });

  it('does not infer the mode from conversation.model', () => {
    // A conversation whose *chat* model is a media-sounding model, with no
    // media job behind it, is still an ordinary conversation. If the column
    // were derived from `conversation.model` this row would claim "图片生成".
    setHistory([
      makeConversation({
        id: 'looks-like-media',
        name: 'Chat with a media-sounding model',
        model: { id: 'provider-ark', use_model: 'seedream-4-0' },
      }),
    ]);
    mediaJobsMock.jobs = [];

    render(<SessionCenter />);

    const row = detailedRow('looks-like-media');
    expect(within(row).getByText('对话')).toBeInTheDocument();
    expect(within(row).queryByText('图片生成')).not.toBeInTheDocument();
    // The chat model itself is still what the model column shows.
    expect(within(row).getByText('seedream-4-0')).toBeInTheDocument();
  });

  it('lets the generating model override the chat model in the model column', () => {
    setHistory([
      makeConversation({ id: 'mixed', name: 'Text chat that drew once', model: { id: 'p', use_model: 'gpt-4o' } }),
    ]);
    mediaJobsMock.jobs = [
      makeMediaJob({ jobId: 'j1', kind: 'image', model: 'seedream-4-0', origin: { conversationId: 'mixed' } }),
    ];

    render(<SessionCenter />);

    const row = detailedRow('mixed');
    expect(within(row).getByText('seedream-4-0')).toBeInTheDocument();
    expect(within(row).queryByText('gpt-4o')).not.toBeInTheDocument();
  });

  it('falls back to the workspace when an agent-invoked job carries no conversation id', () => {
    setHistory([
      makeConversation({ id: 'in-workspace', name: 'Agent drew here', extra: { workspace: 'D:\\ws\\Alpha\\' } }),
      makeConversation({ id: 'other-workspace', name: 'Elsewhere', extra: { workspace: 'D:/ws/beta' } }),
    ]);
    mediaJobsMock.jobs = [
      // Separator case and trailing slash differ from the stored workspace on
      // purpose — attribution is normalized, not string-equal.
      makeMediaJob({ jobId: 'j1', kind: 'video', model: 'seedance-2-0-fast', origin: { workspaceDir: 'd:/ws/alpha' } }),
    ];

    render(<SessionCenter />);

    expect(within(detailedRow('in-workspace')).getByText('视频生成')).toBeInTheDocument();
    expect(within(detailedRow('other-workspace')).getByText('对话')).toBeInTheDocument();
  });

  it('prefers an explicit conversation id over the workspace fallback', () => {
    setHistory([makeConversation({ id: 'target', name: 'Target', extra: { workspace: 'D:/ws/alpha' } })]);
    mediaJobsMock.jobs = [
      makeMediaJob({ jobId: 'j1', kind: 'image', model: 'by-id', origin: { conversationId: 'target' } }),
      makeMediaJob({ jobId: 'j2', kind: 'video', model: 'by-workspace', origin: { workspaceDir: 'D:/ws/alpha' } }),
    ];

    render(<SessionCenter />);

    const row = detailedRow('target');
    expect(within(row).getByText('图片生成')).toBeInTheDocument();
    expect(within(row).getByText('by-id')).toBeInTheDocument();
  });
});

describe('SessionCenter mark-as-unread wiring', () => {
  const openMenuFor = (id: string) => {
    conversationActionsMock.dropdownVisibleId = id;
  };

  it('forwards the unread state helpers into useConversationActions', () => {
    setHistory([makeConversation({ id: 'h1' })]);

    render(<SessionCenter />);

    expect(capturedConversationActionsArgs.at(-1)).toMatchObject({
      markManualUnread: conversationsMock.markManualUnread,
      clearManualUnread: conversationsMock.clearManualUnread,
      isManualUnread: conversationsMock.isManualUnread,
      markAsRead: cronStatusMock.markAsRead,
    });
  });

  it('offers "mark as unread" for a read conversation and calls the handler with it', async () => {
    const conversation = makeConversation({ id: 'h1', name: 'Readable' });
    setHistory([conversation]);
    openMenuFor('h1');

    render(<SessionCenter />);

    const item = await screen.findByText('conversation.history.markAsUnread');
    expect(screen.queryByText('conversation.history.markAsRead')).not.toBeInTheDocument();

    fireEvent.click(item);
    await waitFor(() =>
      expect(conversationActionsMock.handleToggleManualUnread).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'h1' })
      )
    );
  });

  it('offers "mark as read" once the conversation is manually unread', async () => {
    setHistory([makeConversation({ id: 'h1' })]);
    conversationsMock.isManualUnread.mockImplementation((id: string) => id === 'h1');
    openMenuFor('h1');

    render(<SessionCenter />);

    expect(await screen.findByText('conversation.history.markAsRead')).toBeInTheDocument();
    expect(screen.queryByText('conversation.history.markAsUnread')).not.toBeInTheDocument();
  });

  it('marks a manually-unread conversation with the unread dot', () => {
    setHistory([makeConversation({ id: 'h1' }), makeConversation({ id: 'h2' })]);
    conversationsMock.isManualUnread.mockImplementation((id: string) => id === 'h1');

    render(<SessionCenter />);

    expect(detailedRow('h1').querySelector('.bg-\\#2C7FFF')).not.toBeNull();
    expect(detailedRow('h2').querySelector('.bg-\\#2C7FFF')).toBeNull();
  });

  it('keeps the dot for a completion-unread conversation that was never marked manually', () => {
    setHistory([makeConversation({ id: 'h1' })]);
    conversationsMock.hasCompletionUnread.mockImplementation((id: string) => id === 'h1');

    render(<SessionCenter />);

    expect(detailedRow('h1').querySelector('.bg-\\#2C7FFF')).not.toBeNull();
  });
});
