import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TChatConversation } from '@/common/config/storage';
import WorkspaceGroupedHistory from '@/renderer/pages/conversation/GroupedHistory';

// Regression: the section labels used to be stacked above the scroll area, so
// loose conversations ran straight on from an expanded project and read as part
// of it. Each label must now sit directly above its own rows.

const projectConversation = { id: 'in-project', name: 'Inside project' } as TChatConversation;
const looseConversation = { id: 'loose', name: 'Loose conversation' } as TChatConversation;
const pinnedConversation = { id: 'pinned', name: 'Pinned conversation' } as TChatConversation;

const state = vi.hoisted(() => ({
  pinned: [] as unknown[],
  collapsedSections: new Set<string>(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => ({}) }));
vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
// Modals are closed in every case here; their theme plumbing is not under test.
vi.mock('@/renderer/components/base/DreamModal', () => ({ default: () => null }));
vi.mock('@/renderer/components/settings/DirectorySelectionModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/conversation/GroupedHistory/SharedInboxModal', () => ({ default: () => null }));
vi.mock('@/renderer/pages/cron', () => ({
  useCronJobsMap: () => ({ getJobStatus: vi.fn(), markAsRead: vi.fn(), setActiveConversation: vi.fn() }),
}));
vi.mock('@renderer/pages/enterprise/hooks/useOrgContext', () => ({ useOrgContext: () => ({ context: null }) }));
vi.mock('@renderer/utils/enterprise/conversationShare', () => ({
  shareConversationToOrg: vi.fn(),
  shareConversationToMySession: vi.fn(),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/ConversationRow', () => ({
  default: ({ conversation }: { conversation: TChatConversation }) => (
    <div data-testid={`row-${conversation.id}`}>{conversation.name}</div>
  ),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/SortableConversationRow', () => ({
  default: ({ conversation }: { conversation: TChatConversation }) => (
    <div data-testid={`row-${conversation.id}`}>{conversation.name}</div>
  ),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: [projectConversation, looseConversation],
    isConversationGenerating: () => false,
    isConversationWaitingConfirmation: () => false,
    hasCompletionUnread: () => false,
    isManualUnread: () => false,
    markManualUnread: vi.fn(),
    clearManualUnread: vi.fn(),
    expandedWorkspaces: ['/ws/project'],
    pinnedConversations: state.pinned,
    timelineSections: [{ key: 'today', items: [] }],
    projectGroups: [{ workspace: '/ws/project', displayName: 'Project A', conversations: [projectConversation] }],
    conversationOnlySections: [{ key: 'today', items: [{ type: 'conversation', conversation: looseConversation }] }],
    handleToggleWorkspace: vi.fn(),
    collapsedSections: state.collapsedSections,
    toggleSection: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    selectedConversationIds: new Set<string>(),
    setSelectedConversationIds: vi.fn(),
    selectedCount: 0,
    allSelected: false,
    toggleSelectedConversation: vi.fn(),
    handleToggleSelectAll: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions', () => ({
  useConversationActions: () => ({
    renameModalVisible: false,
    renameModalName: '',
    setRenameModalName: vi.fn(),
    renameLoading: false,
    dropdownVisibleId: null,
    handleConversationClick: vi.fn(),
    handleDeleteClick: vi.fn(),
    handleBatchDelete: vi.fn(),
    handleEditStart: vi.fn(),
    handleRenameConfirm: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleTogglePin: vi.fn(),
    handleMenuVisibleChange: vi.fn(),
    handleOpenMenu: vi.fn(),
    handleToggleManualUnread: vi.fn(),
    handleCreateCronTask: vi.fn(),
    handleRemoveProject: vi.fn(),
    removeProjectTarget: null,
    removeProjectLoading: false,
    handleRemoveProjectCancel: vi.fn(),
    handleRemoveProjectConfirm: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useExport', () => ({
  useExport: () => ({
    exportTask: null,
    exportModalVisible: false,
    exportTargetPath: '',
    exportModalLoading: false,
    showExportDirectorySelector: false,
    setShowExportDirectorySelector: vi.fn(),
    closeExportModal: vi.fn(),
    handleSelectExportDirectoryFromModal: vi.fn(),
    handleSelectExportFolder: vi.fn(),
    handleExportConversation: vi.fn(),
    handleBatchExport: vi.fn(),
    handleExportAll: vi.fn(),
    handleConfirmExport: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useDragAndDrop', () => ({
  useDragAndDrop: () => ({
    sensors: [],
    activeId: null,
    activeConversation: null,
    handleDragStart: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
    isDragEnabled: false,
  }),
}));

const precedes = (a: HTMLElement, b: HTMLElement) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('WorkspaceGroupedHistory section order', () => {
  beforeEach(() => {
    state.pinned = [];
    state.collapsedSections = new Set();
  });
  afterEach(() => cleanup());

  it('puts the history label between the project rows and the loose conversations', () => {
    render(<WorkspaceGroupedHistory />);

    const projectsLabel = screen.getByText('conversation.history.projectsSection');
    const projectName = screen.getByText('Project A');
    const projectRow = screen.getByTestId('row-in-project');
    const historyLabel = screen.getByText('conversation.history.conversationsSection');
    const looseRow = screen.getByTestId('row-loose');

    expect(precedes(projectsLabel, projectName)).toBe(true);
    expect(precedes(projectRow, historyLabel)).toBe(true);
    expect(precedes(historyLabel, looseRow)).toBe(true);
  });

  it('keeps a collapsed section label so it can be expanded again', () => {
    state.collapsedSections = new Set(['projects']);
    render(<WorkspaceGroupedHistory />);

    expect(screen.getByText('conversation.history.projectsSection')).toBeTruthy();
    expect(screen.queryByText('Project A')).toBeNull();
    expect(screen.getByTestId('row-loose')).toBeTruthy();
  });

  it('places the pinned label above the pinned rows', () => {
    state.pinned = [pinnedConversation];
    render(<WorkspaceGroupedHistory />);

    const pinnedLabel = screen.getByText('conversation.history.pinnedSection');
    const pinnedRow = screen.getByTestId('row-pinned');
    const projectsLabel = screen.getByText('conversation.history.projectsSection');

    expect(precedes(pinnedLabel, pinnedRow)).toBe(true);
    expect(precedes(pinnedRow, projectsLabel)).toBe(true);
  });
});
