/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { addRecentWorkspace } from '@/renderer/components/workspace';
import {
  readStoredSiderOrder,
  reorderSiderIds,
  writeStoredSiderOrder,
} from '@renderer/components/layout/Sider/siderOrder';
import type { TChatConversation } from '@/common/config/storage';
import DreamModal from '@/renderer/components/base/DreamModal';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import { shareConversationToOrg, shareConversationToMySession } from '@renderer/utils/enterprise/conversationShare';
import { emitter } from '@renderer/utils/emitter';
import SharedInboxModal from './SharedInboxModal';
import { DndContext, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button, Dropdown, Empty, Input, Menu, Message, Modal, Select, Tooltip } from '@arco-design/web-react';
import { Delete, FolderOpen, FullScreen, MoreOne, Plus, Right, ShareOne } from '@icon-park/react';
import classNames from 'classnames';
import { useState } from 'react';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import WorkspaceCollapse from '../components/WorkspaceCollapse';
import siderStyles from '@renderer/components/layout/Sider/Sider.module.css';
import DirectorySelectionModal from '@/renderer/components/settings/DirectorySelectionModal';
import ConversationRow from './ConversationRow';
import ListLoadErrorNotice from './ListLoadErrorNotice';
import DragOverlayContent from './DragOverlayContent';
import SortableConversationRow, { DraggableHistoryRow } from './SortableConversationRow';
import { useBatchSelection } from './hooks/useBatchSelection';
import { retryLoadConversations } from './hooks/useConversationListSync';
import { useConversationActions } from './hooks/useConversationActions';
import { useConversations } from './hooks/useConversations';
import { historyCollisionDetection, useDragAndDrop } from './hooks/useDragAndDrop';
import { useExport } from './hooks/useExport';
import { useSidebarHistoryPreviewLimit } from './hooks/useSidebarHistoryPreviewLimit';
import type { ConversationRowProps, WorkspaceGroupedHistoryProps } from './types';

const SIDEBAR_WORKSPACE_FOLDERS_KEY = 'one:sidebar-workspace-folders';
const HISTORY_GROUPS_KEY = 'one:sidebar-history-groups';
type HistoryGroup = { id: string; name: string; conversationIds: string[] };
const NO_GROUP = 'none';
const NEW_GROUP = 'new';
const PROJECT_CHOICE_PREFIX = 'project:';
const SECTION_ACTION_CLASS =
  'flex items-center gap-2px h-24px px-4px rd-4px cursor-pointer bg-transparent text-12px text-t-secondary transition-colors hover:bg-hover hover:text-t-primary active:bg-active focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary';

const ProjectDropTarget = ({
  workspace,
  disabled,
  ...props
}: React.ComponentProps<typeof WorkspaceCollapse> & { workspace: string; disabled: boolean }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `${PROJECT_CHOICE_PREFIX}${workspace}`,
    data: { type: 'project', workspace },
    disabled,
  });
  return <WorkspaceCollapse {...props} headerRef={setNodeRef} dropHighlighted={isOver} />;
};

const readHistoryGroups = (): HistoryGroup[] => {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HISTORY_GROUPS_KEY) ?? '[]');
    return Array.isArray(stored)
      ? stored.filter(
          (group): group is HistoryGroup =>
            typeof group?.id === 'string' && typeof group.name === 'string' && Array.isArray(group.conversationIds)
        )
      : [];
  } catch {
    return [];
  }
};

const SIDEBAR_WORKSPACE_ORDER_KEY = 'one:sidebar-workspace-order';

const WorkspaceGroupedHistory: React.FC<WorkspaceGroupedHistoryProps> = ({
  onSessionClick,
  collapsed = false,
  tooltipEnabled = false,
  batchMode = false,
  onBatchModeChange,
}) => {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const { getJobStatus, markAsRead, setActiveConversation } = useCronJobsMap();
  // Gates the "分享到企业" row below; see the note on `onShare`.
  const { context: orgContext } = useOrgContext();
  const isEnterpriseMember = orgContext?.isEnterprise ?? false;
  const [sharedInboxVisible, setSharedInboxVisible] = useState(false);

  const {
    conversations,
    listLoadError,
    isConversationGenerating,
    isConversationWaitingConfirmation,
    hasCompletionUnread,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    expandedWorkspaces,
    pinnedConversations,
    projectGroups: conversationProjects,
    conversationOnlySections,
    handleToggleWorkspace,
    expandWorkspace,
    collapsedSections,
    toggleSection,
  } = useConversations();

  const [workspaceFolders, setWorkspaceFolders] = useState(() => readStoredSiderOrder(SIDEBAR_WORKSPACE_FOLDERS_KEY));
  const [workspaceOrder, setWorkspaceOrder] = useState(() => readStoredSiderOrder(SIDEBAR_WORKSPACE_ORDER_KEY));
  const projectGroups = useMemo(() => {
    const byPath = new Map(conversationProjects.map((group) => [group.workspace, group]));
    for (const workspace of workspaceFolders) {
      if (!byPath.has(workspace)) {
        const displayName = workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
        byPath.set(workspace, { workspace, displayName, conversations: [] });
      }
    }
    const orderedGroups = workspaceOrder.flatMap((workspace) => {
      const group = byPath.get(workspace);
      if (!group) return [];
      byPath.delete(workspace);
      return [group];
    });
    return [...orderedGroups, ...byPath.values()];
  }, [conversationProjects, workspaceFolders, workspaceOrder]);

  const updateWorkspaceFolders = (folders: string[]) => {
    setWorkspaceFolders(folders);
    writeStoredSiderOrder(SIDEBAR_WORKSPACE_FOLDERS_KEY, folders);
  };

  const handleAddWorkspace = async () => {
    try {
      const [workspace] =
        (await ipcBridge.dialog.showOpen.invoke({
          properties: ['openDirectory', 'createDirectory'],
        })) ?? [];
      if (!workspace) return;
      if (!workspaceFolders.includes(workspace)) {
        updateWorkspaceFolders([...workspaceFolders, workspace]);
      }
      addRecentWorkspace(workspace);
      if (collapsedSections.has('projects')) toggleSection('projects');
    } catch (error) {
      console.error('Failed to add workspace folder:', error);
      Message.error(t('common.saveFailed'));
    }
  };

  const moveWorkspace = (index: number, offset: number) => {
    const target = projectGroups[index + offset];
    if (!target) return;
    const order = reorderSiderIds(
      projectGroups.map((group) => group.workspace),
      projectGroups[index].workspace,
      target.workspace
    );
    setWorkspaceOrder(order);
    writeStoredSiderOrder(SIDEBAR_WORKSPACE_ORDER_KEY, order);
  };

  const [historyGroups, setHistoryGroups] = useState(readHistoryGroups);
  const [groupDialog, setGroupDialog] = useState<{ conversationId?: string; renameId?: string } | null>(null);
  const [groupChoice, setGroupChoice] = useState(NEW_GROUP);
  const [groupName, setGroupName] = useState('');
  const movingConversations = useRef(new Set<string>());
  const [savingProjectChoice, setSavingProjectChoice] = useState(false);
  const moveConversationToProject = useCallback(
    async (conversationId: string, workspace: string | null) => {
      if (
        movingConversations.current.has(conversationId) ||
        (workspace && !projectGroups.some((project) => project.workspace === workspace))
      ) {
        return false;
      }
      movingConversations.current.add(conversationId);
      try {
        const saved = await ipcBridge.conversation.update.invoke({
          id: conversationId,
          updates: { extra: { sidebar_project_workspace: workspace } } as Partial<TChatConversation>,
          merge_extra: true,
        });
        if (!saved) {
          Message.error(t('common.saveFailed'));
          return false;
        }
        if (workspace) expandWorkspace(workspace);
        emitter.emit('chat.history.refresh');
        return true;
      } catch (error) {
        console.error('Failed to move conversation to project:', error);
        Message.error(t('common.saveFailed'));
        return false;
      } finally {
        movingConversations.current.delete(conversationId);
      }
    },
    [expandWorkspace, projectGroups, t]
  );
  const dialogProjectWorkspace = conversations.find((conversation) => conversation.id === groupDialog?.conversationId)
    ?.extra?.sidebar_project_workspace;
  const groupByConversation = useMemo(() => {
    const groups = new Map<string, string>();
    for (const group of historyGroups) {
      for (const conversationId of group.conversationIds) groups.set(conversationId, group.id);
    }
    return groups;
  }, [historyGroups]);
  const openGroupDialog = useCallback(
    (conversation?: TChatConversation, group?: HistoryGroup) => {
      setGroupDialog({ conversationId: conversation?.id, renameId: group?.id });
      setGroupChoice(
        conversation
          ? conversation.extra?.sidebar_project_workspace
            ? `${PROJECT_CHOICE_PREFIX}${conversation.extra.sidebar_project_workspace}`
            : (groupByConversation.get(conversation.id) ?? (historyGroups.length ? historyGroups[0].id : NEW_GROUP))
          : NEW_GROUP
      );
      setGroupName(group?.name ?? '');
    },
    [groupByConversation, historyGroups]
  );

  const saveHistoryGroups = (nextGroups: HistoryGroup[]) => {
    try {
      localStorage.setItem(HISTORY_GROUPS_KEY, JSON.stringify(nextGroups));
      setHistoryGroups(nextGroups);
      return true;
    } catch {
      Message.error(t('common.saveFailed'));
      return false;
    }
  };

  const groupNameRequired = groupChoice === NEW_GROUP || Boolean(groupDialog?.renameId);
  const saveGroupDialog = async () => {
    if (!groupDialog || (groupNameRequired && !groupName.trim())) return;
    const { conversationId, renameId } = groupDialog;
    if (conversationId && groupChoice.startsWith(PROJECT_CHOICE_PREFIX)) {
      setSavingProjectChoice(true);
      try {
        if (await moveConversationToProject(conversationId, groupChoice.slice(PROJECT_CHOICE_PREFIX.length))) {
          setGroupDialog(null);
        }
      } finally {
        setSavingProjectChoice(false);
      }
      return;
    }
    if (conversationId && dialogProjectWorkspace) {
      setSavingProjectChoice(true);
      try {
        if (!(await moveConversationToProject(conversationId, null))) return;
      } finally {
        setSavingProjectChoice(false);
      }
    }
    let nextGroups = historyGroups;
    if (renameId) {
      nextGroups = historyGroups.map((group) => (group.id === renameId ? { ...group, name: groupName.trim() } : group));
    } else {
      if (conversationId) {
        nextGroups = historyGroups.map((group) => ({
          ...group,
          conversationIds: group.conversationIds.filter((id) => id !== conversationId),
        }));
      }
      if (groupChoice === NEW_GROUP) {
        nextGroups = [
          ...nextGroups,
          {
            id: crypto.randomUUID(),
            name: groupName.trim(),
            conversationIds: conversationId ? [conversationId] : [],
          },
        ];
      } else if (conversationId) {
        nextGroups = nextGroups.map((group) =>
          group.id === groupChoice ? { ...group, conversationIds: [...group.conversationIds, conversationId] } : group
        );
      }
    }
    if (saveHistoryGroups(nextGroups)) {
      setGroupDialog(null);
      if (collapsedSections.has('conversations')) toggleSection('conversations');
    }
  };

  const loadErrorNotice = listLoadError ? (
    <ListLoadErrorNotice error={listLoadError} onRetry={retryLoadConversations} />
  ) : null;

  // Sidebar shows a height-aware, scrollable preview (loads more than fits so
  // scrolling reveals it); the full list lives in Session Center (/sessions).
  const historyLayoutKey = `${pinnedConversations.length}:${projectGroups.length}:${collapsedSections.has('pinned')}:${collapsedSections.has('projects')}:${batchMode}`;
  const { previewLimit, scrollAreaRef, pinnedBlockRef, projectsBlockRef } = useSidebarHistoryPreviewLimit(
    !collapsed,
    historyLayoutKey
  );
  const SectionLabel = useCallback(
    ({
      sectionKey,
      label,
      trailing,
      spaced = false,
    }: {
      sectionKey: string;
      label: string;
      trailing?: React.ReactNode;
      /** Extra top gap so a section that follows another one reads as a new group. */
      spaced?: boolean;
    }) => {
      const isCollapsed = collapsedSections.has(sectionKey);
      return (
        <div
          className={classNames(
            'group/label sider-section-label flex items-center pl-10px pr-8px h-28px select-none cursor-pointer',
            spaced ? 'mt-10px' : 'mt-2px'
          )}
          onClick={() => toggleSection(sectionKey)}
        >
          <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
            {label}
          </span>
          <span className='ms-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
            <Right
              theme='outline'
              size={12}
              className={classNames('transition-transform duration-150', { 'rotate-90': !isCollapsed })}
            />
          </span>
          {trailing && (
            <div className='ms-auto' onClick={(e) => e.stopPropagation()}>
              {trailing}
            </div>
          )}
        </div>
      );
    },
    [collapsedSections, toggleSection]
  );

  const renderViewAllButton = useCallback(
    (section: 'projects' | 'conversations') => (
      <Tooltip content={t('conversation.history.viewAllTooltip')} position='top'>
        <span
          role='button'
          tabIndex={0}
          aria-label={t('conversation.history.viewAllTooltip')}
          className='flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn'
          onClick={() => void navigate(`/sessions?section=${section}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void navigate(`/sessions?section=${section}`);
            }
          }}
        >
          <FullScreen theme='outline' size='14' fill='currentColor' className='block leading-none' />
        </span>
      </Tooltip>
    ),
    [navigate, t]
  );

  // Sync active conversation ref when route changes (for URL navigation)
  // This doesn't trigger state update, avoiding double render
  useEffect(() => {
    if (id) {
      setActiveConversation(id);
    }
  }, [id, setActiveConversation]);

  const {
    selectedConversationIds,
    setSelectedConversationIds,
    selectedCount,
    allSelected,
    toggleSelectedConversation,
    handleToggleSelectAll,
  } = useBatchSelection(batchMode, conversations);

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleBatchDelete,
    handleEditStart,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleMenuVisibleChange,
    handleOpenMenu,
    handleToggleManualUnread,
    handleCreateCronTask,
    handleRemoveProject,
    removeProjectTarget,
    removeProjectLoading,
    handleRemoveProjectCancel,
    handleRemoveProjectConfirm,
  } = useConversationActions({
    batchMode,
    onSessionClick,
    onBatchModeChange,
    selectedConversationIds,
    setSelectedConversationIds,
    toggleSelectedConversation,
    markAsRead,
    markManualUnread,
    clearManualUnread,
    isManualUnread,
  });

  const {
    exportTask,
    exportModalVisible,
    exportTargetPath,
    exportModalLoading,
    showExportDirectorySelector,
    setShowExportDirectorySelector,
    closeExportModal,
    handleSelectExportDirectoryFromModal,
    handleSelectExportFolder,
    handleExportConversation,
    handleBatchExport,
    handleExportAll,
    handleConfirmExport,
  } = useExport({
    conversations,
    selectedConversationIds,
    setSelectedConversationIds,
    onBatchModeChange,
  });

  const { sensors, activeId, activeConversation, handleDragStart, handleDragEnd, handleDragCancel, isDragEnabled } =
    useDragAndDrop({
      pinnedConversations,
      batchMode,
      collapsed,
      onMoveToProject: moveConversationToProject,
    });

  // Fork-lineage badge support: resolve a parent conversation's display name
  // from the already-loaded sidebar list (no extra fetch; unresolved = the
  // parent was deleted or not loaded → the badge falls back to a generic tip).
  const conversationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const conversation of conversations) {
      map.set(conversation.id, conversation.name);
    }
    return map;
  }, [conversations]);
  const resolveConversationName = useCallback(
    (conversationId: string) => conversationNameById.get(conversationId),
    [conversationNameById]
  );

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation, rowId = conversation.id): ConversationRowProps => ({
      conversation,
      rowId,
      isGenerating: isConversationGenerating(conversation.id),
      isWaitingConfirmation: isConversationWaitingConfirmation(conversation.id),
      hasUnread: hasCompletionUnread(conversation.id) || isManualUnread(conversation.id),
      isManualUnread: isManualUnread(conversation.id),
      collapsed,
      tooltipEnabled,
      batchMode,
      checked: selectedConversationIds.has(conversation.id),
      selected: id === conversation.id,
      menuVisible: dropdownVisibleId !== null && dropdownVisibleId === rowId,
      onToggleChecked: toggleSelectedConversation,
      onConversationClick: handleConversationClick,
      onOpenMenu: rowId === conversation.id ? handleOpenMenu : () => handleMenuVisibleChange(rowId, true),
      onMenuVisibleChange: (_id, visible) => handleMenuVisibleChange(rowId, visible),
      onEditStart: handleEditStart,
      onCreateCronTask: handleCreateCronTask,
      onDelete: handleDeleteClick,
      onTogglePin: handleTogglePin,
      onToggleManualUnread: handleToggleManualUnread,
      onExport: handleExportConversation,
      onOrganize: openGroupDialog,
      getJobStatus,
      resolveConversationName,
      // Only offer sharing to somebody who has an organization to share with.
      // The menu item used to be unconditional, so a personal user saw
      // "分享到企业" on every conversation and got "当前企业未开启会话分享"
      // when they tried it — a sentence about a company they do not have.
      onShare: isEnterpriseMember
        ? (conversation: TChatConversation) =>
            void shareConversationToOrg({ id: conversation.id, name: conversation.name ?? '' }, t)
        : undefined,
      onShareToSession: (conversation: TChatConversation): void =>
        void shareConversationToMySession(
          { id: conversation.id, name: conversation.name ?? '' },
          conversations,
          t,
          (id) => {
            emitter.emit('chat.history.refresh');
            void navigate(`/conversation/${id}`);
          }
        ),
    }),
    [
      collapsed,
      tooltipEnabled,
      batchMode,
      isConversationGenerating,
      isConversationWaitingConfirmation,
      hasCompletionUnread,
      isManualUnread,
      selectedConversationIds,
      id,
      dropdownVisibleId,
      toggleSelectedConversation,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleCreateCronTask,
      handleDeleteClick,
      handleTogglePin,
      handleToggleManualUnread,
      handleExportConversation,
      openGroupDialog,
      getJobStatus,
      resolveConversationName,
      isEnterpriseMember,
      conversations,
      navigate,
      t,
    ]
  );

  const renderConversation = (
    conversation: TChatConversation,
    dimIcon = false,
    rowId?: string,
    fromHistory = false
  ) => {
    const rowProps = getConversationRowProps(conversation, rowId);
    const Row = fromHistory && isDragEnabled && projectGroups.length > 0 ? DraggableHistoryRow : ConversationRow;
    return <Row key={conversation.id} {...rowProps} dimIcon={dimIcon} />;
  };

  // Collect all sortable IDs for the pinned section
  const pinnedIds = useMemo(() => pinnedConversations.map((c) => c.id), [pinnedConversations]);

  // Sidebar history is a height-aware, scrollable preview — Session Center (/sessions) shows everything.
  // If the currently open conversation isn't among the preview rows (e.g. opened via search),
  // keep it visible too so the sidebar never looks like nothing is selected.
  const visibleHistoryConversations = useMemo(() => {
    const flat: TChatConversation[] = [];
    for (const section of conversationOnlySections) {
      for (const item of section.items) {
        if (item.type === 'conversation' && item.conversation && !groupByConversation.has(item.conversation.id)) {
          flat.push(item.conversation);
        }
      }
    }
    const capped = flat.slice(0, previewLimit);
    if (id && !capped.some((c) => c.id === id)) {
      const active = flat.find((c) => c.id === id);
      if (active) capped.push(active);
    }
    return capped;
  }, [conversationOnlySections, groupByConversation, id, previewLimit]);

  const duplicateGroupRowIds = new Set([
    ...pinnedIds,
    ...projectGroups.flatMap((group) => group.conversations.map((conversation) => conversation.id)),
  ]);
  const historyConversationById = new Map(
    conversations
      .filter((conversation) => !conversation.extra?.sidebar_project_workspace)
      .map((conversation) => [conversation.id, conversation])
  );
  const newGroupLabel = t('conversation.history.newGroup', { defaultValue: 'New group' });
  const renameGroupLabel = t('conversation.history.renameGroup', { defaultValue: 'Rename group' });
  const removeGroupLabel = t('conversation.history.removeGroup', { defaultValue: 'Remove group' });

  return (
    <>
      <Modal
        title={
          groupDialog?.renameId
            ? renameGroupLabel
            : groupDialog?.conversationId
              ? t('conversation.history.moveToGroup', { defaultValue: 'Move to group' })
              : newGroupLabel
        }
        visible={Boolean(groupDialog)}
        onCancel={() => setGroupDialog(null)}
        onOk={saveGroupDialog}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        okButtonProps={{ disabled: groupNameRequired && !groupName.trim(), loading: savingProjectChoice }}
        alignCenter
      >
        {groupDialog?.conversationId && (
          <Select
            aria-label={t('conversation.history.moveToGroup', { defaultValue: 'Move to group' })}
            className='w-full'
            value={groupChoice}
            onChange={setGroupChoice}
            options={[
              ...historyGroups.map((group) => ({ label: group.name, value: group.id })),
              ...projectGroups.map(({ displayName, workspace }) => ({
                label: `${t('conversation.history.projectsSection')} / ${displayName}`,
                value: `${PROJECT_CHOICE_PREFIX}${workspace}`,
              })),
              { label: newGroupLabel, value: NEW_GROUP },
              ...(dialogProjectWorkspace || groupByConversation.has(groupDialog.conversationId)
                ? [
                    {
                      label: t('conversation.history.ungrouped', { defaultValue: 'No group' }),
                      value: NO_GROUP,
                    },
                  ]
                : []),
            ]}
          />
        )}
        {groupNameRequired && (
          <Input
            className={groupDialog?.conversationId ? 'mt-12px' : undefined}
            aria-label={t('conversation.history.groupName', { defaultValue: 'Group name' })}
            placeholder={t('conversation.history.groupName', { defaultValue: 'Group name' })}
            value={groupName}
            onChange={setGroupName}
            onPressEnter={saveGroupDialog}
            maxLength={80}
            autoFocus
          />
        )}
      </Modal>
      <Modal
        title={t('conversation.history.renameTitle')}
        visible={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={handleRenameCancel}
        okText={t('conversation.history.saveName')}
        cancelText={t('conversation.history.cancelEdit')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameModalName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameModalName}
          onChange={setRenameModalName}
          onPressEnter={handleRenameConfirm}
          placeholder={t('conversation.history.renamePlaceholder')}
          allowClear
        />
      </Modal>

      <Modal
        visible={exportModalVisible}
        title={t('conversation.history.exportDialogTitle')}
        onCancel={closeExportModal}
        footer={null}
        style={{ borderRadius: '12px' }}
        className='conversation-export-modal'
        alignCenter
        getPopupContainer={() => document.body}
      >
        <div className='py-8px'>
          <div className='text-14px mb-16px text-t-secondary'>
            {exportTask?.mode === 'batch'
              ? t('conversation.history.exportDialogBatchDescription', { count: exportTask.conversation_ids.length })
              : t('conversation.history.exportDialogSingleDescription')}
          </div>

          <div className='mb-16px p-16px rounded-12px bg-fill-1'>
            <div className='text-14px mb-8px text-t-primary'>{t('conversation.history.exportTargetFolder')}</div>
            <div
              className='flex items-center justify-between px-12px py-10px rounded-8px transition-colors'
              style={{
                backgroundColor: 'var(--color-bg-1)',
                border: '1px solid var(--color-border-2)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
                opacity: exportModalLoading ? 0.55 : 1,
              }}
              onClick={() => {
                void handleSelectExportFolder();
              }}
            >
              <span
                className='text-14px overflow-hidden text-ellipsis whitespace-nowrap'
                style={{ color: exportTargetPath ? 'var(--color-text-1)' : 'var(--color-text-3)' }}
              >
                {exportTargetPath || t('conversation.history.exportSelectFolder')}
              </span>
              <FolderOpen theme='outline' size='18' fill='var(--color-text-3)' />
            </div>
          </div>

          <div className='flex items-center gap-8px mb-20px text-14px text-t-secondary'>
            <span>💡</span>
            <span>{t('conversation.history.exportDialogHint')}</span>
          </div>

          <div className='flex gap-12px justify-end'>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={closeExportModal}
            >
              {t('common.cancel')}
            </button>
            <button
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: 'none',
                backgroundColor: exportModalLoading ? 'var(--color-fill-3)' : 'var(--color-text-1)',
                color: 'var(--color-bg-1)',
                cursor: exportModalLoading ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '0.85';
                }
              }}
              onMouseLeave={(event) => {
                if (!exportModalLoading) {
                  event.currentTarget.style.opacity = '1';
                }
              }}
              onClick={() => {
                void handleConfirmExport();
              }}
              disabled={exportModalLoading}
            >
              {exportModalLoading ? t('conversation.history.exporting') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>

      <DirectorySelectionModal
        visible={showExportDirectorySelector}
        onConfirm={handleSelectExportDirectoryFromModal}
        onCancel={() => setShowExportDirectorySelector(false)}
      />

      {/* 移除项目确认弹窗 — 使用项目自家 DreamModal + 圆角线框按钮（红色危险态） */}
      <DreamModal
        visible={removeProjectTarget !== null}
        style={{ width: '400px' }}
        header={{
          title: t('conversation.history.removeProjectTitle'),
          showClose: true,
          style: { borderBottom: 'none' },
        }}
        onCancel={handleRemoveProjectCancel}
        footer={
          <div className='flex justify-end gap-12px pt-16px'>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid var(--color-border-2)',
                backgroundColor: 'var(--color-fill-2)',
                color: 'var(--color-text-1)',
                cursor: removeProjectLoading ? 'not-allowed' : 'pointer',
                opacity: removeProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-3)';
              }}
              onMouseLeave={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'var(--color-fill-2)';
              }}
              onClick={handleRemoveProjectCancel}
              disabled={removeProjectLoading}
            >
              {t('conversation.history.cancelDelete')}
            </button>
            <button
              type='button'
              className='px-24px py-8px rounded-20px text-14px font-medium transition-all'
              style={{
                border: '1px solid rgb(var(--danger-6))',
                backgroundColor: 'transparent',
                color: 'rgb(var(--danger-6))',
                cursor: removeProjectLoading ? 'not-allowed' : 'pointer',
                opacity: removeProjectLoading ? 0.55 : 1,
              }}
              onMouseEnter={(event) => {
                if (!removeProjectLoading) {
                  event.currentTarget.style.backgroundColor = 'rgba(var(--danger-6), 0.08)';
                }
              }}
              onMouseLeave={(event) => {
                if (!removeProjectLoading) event.currentTarget.style.backgroundColor = 'transparent';
              }}
              onClick={() => void handleRemoveProjectConfirm()}
              disabled={removeProjectLoading}
            >
              {removeProjectLoading ? t('conversation.history.deleting') : t('conversation.history.confirmDelete')}
            </button>
          </div>
        }
      >
        <div className='text-14px leading-22px text-t-secondary'>
          {t('conversation.history.removeProjectConfirm', {
            name: removeProjectTarget?.name ?? '',
            count: removeProjectTarget?.conversations.length ?? 0,
          })}
        </div>
      </DreamModal>

      <div className='flex flex-col flex-1 min-h-0 h-full'>
        {batchMode && !collapsed && (
          <div className='shrink-0 px-12px pb-8px pt-2px bg-[var(--bg-2)]'>
            <div className='rd-8px bg-fill-1 p-10px flex flex-col gap-8px border border-solid border-[rgba(var(--primary-6),0.08)]'>
              <div className='text-12px leading-18px text-t-secondary'>
                {t('conversation.history.selectedCount', { count: selectedCount })}
              </div>
              <div className='grid grid-cols-2 gap-6px'>
                <Button
                  className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                  size='mini'
                  type='secondary'
                  onClick={handleToggleSelectAll}
                >
                  {allSelected ? t('common.cancel') : t('conversation.history.selectAll')}
                </Button>
                <Button
                  className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                  size='mini'
                  status='warning'
                  onClick={handleBatchDelete}
                >
                  {t('conversation.history.batchDelete')}
                </Button>
                <Button
                  className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                  size='mini'
                  type='secondary'
                  disabled={selectedCount === 0}
                  onClick={handleBatchExport}
                >
                  {t('conversation.history.exportSelected')}
                </Button>
                <Button
                  className='!w-full !justify-center !min-w-0 !h-30px !px-8px !text-12px whitespace-nowrap'
                  size='mini'
                  type='secondary'
                  disabled={conversations.length === 0}
                  onClick={handleExportAll}
                >
                  {t('conversation.history.exportAll')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* No siderStyles.scrollArea here (unlike other sider scroll regions) —
            now that this area holds more than fits, the app's default
            hover-reveal scrollbar (styles/themes/base.css) gives a visible
            cue that there's more to scroll instead of hiding it entirely. */}
        <div ref={scrollAreaRef} className='flex-1 min-h-0 overflow-y-auto'>
          {loadErrorNotice}
          <DndContext
            sensors={sensors}
            collisionDetection={historyCollisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Each section label sits directly above its own rows. They used to be
                stacked above the scroll area, so loose conversations ran straight on
                from an expanded project and read as part of it. Labels live inside
                the measured blocks, so the preview-limit math still counts them. */}
            {pinnedConversations.length > 0 && (
              <div ref={pinnedBlockRef} className='min-w-0'>
                {!collapsed && <SectionLabel sectionKey='pinned' label={t('conversation.history.pinnedSection')} />}
                {!collapsedSections.has('pinned') && (
                  <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
                    <div className='min-w-0'>
                      {pinnedConversations.map((conversation) => {
                        const props = getConversationRowProps(conversation);
                        return isDragEnabled ? (
                          <SortableConversationRow key={conversation.id} {...props} />
                        ) : (
                          <ConversationRow key={conversation.id} {...props} />
                        );
                      })}
                    </div>
                  </SortableContext>
                )}
              </div>
            )}

            {(!collapsed || projectGroups.length > 0) && (
              <div ref={projectsBlockRef} className='min-w-0'>
                {!collapsed && (
                  <SectionLabel
                    sectionKey='projects'
                    label={t('conversation.history.projectsSection')}
                    trailing={
                      <div className='flex items-center gap-4px'>
                        <button
                          type='button'
                          className={SECTION_ACTION_CLASS}
                          title={t('conversation.history.addWorkspace', { defaultValue: 'Add workspace' })}
                          aria-label={t('conversation.history.addWorkspace', { defaultValue: 'Add workspace' })}
                          onClick={() => void handleAddWorkspace()}
                        >
                          <Plus theme='outline' size={14} fill='currentColor' />
                          <span>{t('conversation.history.addWorkspace', { defaultValue: 'Add workspace' })}</span>
                        </button>
                        {projectGroups.length > 0 && renderViewAllButton('projects')}
                      </div>
                    }
                    spaced={pinnedConversations.length > 0}
                  />
                )}
                {!collapsedSections.has('projects') &&
                  projectGroups.map((group, index) => {
                    const projectMenu = (
                      <Menu
                        onClickMenuItem={(key) => {
                          if (key === 'up') moveWorkspace(index, -1);
                          if (key === 'down') moveWorkspace(index, 1);
                          if (key === 'remove-folder') {
                            updateWorkspaceFolders(workspaceFolders.filter((path) => path !== group.workspace));
                          }
                          if (key === 'remove') handleRemoveProject(group.displayName, group.conversations);
                        }}
                      >
                        <Menu.Item key='up' disabled={index === 0}>
                          {t('conversation.history.moveWorkspaceUp', { defaultValue: 'Move up' })}
                        </Menu.Item>
                        <Menu.Item key='down' disabled={index === projectGroups.length - 1}>
                          {t('conversation.history.moveWorkspaceDown', { defaultValue: 'Move down' })}
                        </Menu.Item>
                        {workspaceFolders.includes(group.workspace) && (
                          <Menu.Item key='remove-folder'>
                            {t('conversation.history.unpinWorkspace', { defaultValue: 'Remove workspace shortcut' })}
                          </Menu.Item>
                        )}
                        {group.conversations.length > 0 && (
                          <Menu.Item key='remove' className='!text-[rgba(var(--danger-6),1)]'>
                            <span className='flex items-center gap-8px'>
                              <Delete theme='outline' size='14' />
                              {t('conversation.history.removeProject')}
                            </span>
                          </Menu.Item>
                        )}
                      </Menu>
                    );
                    return (
                      <div key={group.workspace} className='min-w-0'>
                        <ProjectDropTarget
                          workspace={group.workspace}
                          disabled={!isDragEnabled}
                          expanded={expandedWorkspaces.includes(group.workspace)}
                          onToggle={() => handleToggleWorkspace(group.workspace)}
                          siderCollapsed={collapsed}
                          stickyHeader
                          stickyTop={0}
                          header={
                            <span
                              className={classNames('min-w-0 flex-1 truncate', siderStyles.workspaceFolderName)}
                              data-han={/\p{Script=Han}/u.test(group.displayName) || undefined}
                            >
                              {group.displayName}
                            </span>
                          }
                          trailing={
                            <span className='flex items-center gap-6px'>
                              <Tooltip content={t('conversation.history.newConversationInProject')} position='top'>
                                <span
                                  role='button'
                                  tabIndex={0}
                                  aria-label={t('conversation.history.newConversationInProject')}
                                  className={classNames(
                                    'flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
                                    isMobile ? 'flex' : 'hidden group-hover:flex'
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void navigate('/guid', {
                                      state: { workspace: group.workspace, resetAssistant: true },
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      void navigate('/guid', {
                                        state: { workspace: group.workspace, resetAssistant: true },
                                      });
                                    }
                                  }}
                                >
                                  <Plus theme='outline' size='14' fill='currentColor' className='block leading-none' />
                                </span>
                              </Tooltip>
                              <Dropdown
                                droplist={projectMenu}
                                trigger='click'
                                position='br'
                                getPopupContainer={() => document.body}
                                unmountOnExit={false}
                              >
                                <span
                                  aria-label='Project actions'
                                  className={classNames(
                                    'flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
                                    isMobile ? 'flex' : 'hidden group-hover:flex'
                                  )}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MoreOne
                                    theme='outline'
                                    size='14'
                                    fill='currentColor'
                                    className='block leading-none'
                                  />
                                </span>
                              </Dropdown>
                            </span>
                          }
                        >
                          <div className={classNames('flex flex-col min-w-0', { 'mt-1px': !collapsed })}>
                            {group.conversations.map((conversation) => renderConversation(conversation, true))}
                          </div>
                        </ProjectDropTarget>
                      </div>
                    );
                  })}
              </div>
            )}

            {!collapsed && (
              <SectionLabel
                sectionKey='conversations'
                label={t('conversation.history.conversationsSection')}
                trailing={
                  <div className='flex items-center gap-4px'>
                    <button
                      type='button'
                      className={SECTION_ACTION_CLASS}
                      title={newGroupLabel}
                      aria-label={newGroupLabel}
                      onClick={() => openGroupDialog()}
                    >
                      <Plus theme='outline' size={14} fill='currentColor' />
                      <span>{newGroupLabel}</span>
                    </button>
                    {conversations.length > 0 && renderViewAllButton('conversations')}
                  </div>
                }
                spaced={pinnedConversations.length > 0 || projectGroups.length > 0}
              />
            )}
            {!collapsed &&
              !collapsedSections.has('conversations') &&
              historyGroups.map((group) => (
                <WorkspaceCollapse
                  key={group.id}
                  expanded={!collapsedSections.has(`history-group:${group.id}`)}
                  onToggle={() => toggleSection(`history-group:${group.id}`)}
                  header={
                    <span
                      className={classNames('min-w-0 flex-1 truncate', siderStyles.workspaceFolderName)}
                      data-han={/\p{Script=Han}/u.test(group.name) || undefined}
                    >
                      {group.name}
                    </span>
                  }
                  trailing={
                    <Dropdown
                      trigger='click'
                      position='br'
                      droplist={
                        <Menu
                          onClickMenuItem={(key) => {
                            if (key === 'rename') openGroupDialog(undefined, group);
                            if (key === 'remove') saveHistoryGroups(historyGroups.filter(({ id }) => id !== group.id));
                          }}
                        >
                          <Menu.Item key='rename'>{renameGroupLabel}</Menu.Item>
                          <Menu.Item key='remove'>{removeGroupLabel}</Menu.Item>
                        </Menu>
                      }
                    >
                      <button
                        type='button'
                        className='sider-action-btn flex-center size-24px'
                        aria-label={group.name}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreOne theme='outline' size={14} />
                      </button>
                    </Dropdown>
                  }
                >
                  {group.conversationIds.map((id) => {
                    const conversation = historyConversationById.get(id);
                    return conversation
                      ? renderConversation(
                          conversation,
                          true,
                          duplicateGroupRowIds.has(id) ? `history-group:${id}` : id,
                          !duplicateGroupRowIds.has(id)
                        )
                      : null;
                  })}
                </WorkspaceCollapse>
              ))}
            {!collapsed && !loadErrorNotice && conversations.length === 0 && historyGroups.length === 0 && (
              <Empty description={t('conversation.history.noHistory')} />
            )}
            {visibleHistoryConversations.length > 0 && !collapsedSections.has('conversations') && (
              <div className='min-w-0'>
                {visibleHistoryConversations.map((conversation) =>
                  renderConversation(conversation, false, undefined, true)
                )}
              </div>
            )}

            <DragOverlay dropAnimation={null}>
              {activeId && activeConversation ? <DragOverlayContent conversation={activeConversation} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </>
  );
};

export default WorkspaceGroupedHistory;
