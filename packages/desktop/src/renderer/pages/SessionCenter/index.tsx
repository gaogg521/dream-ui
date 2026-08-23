/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { TTeam } from '@/common/types/team/teamTypes';
import WorkspaceCollapse from '@/renderer/pages/conversation/components/WorkspaceCollapse';
import ConversationRow, {
  DETAILED_GRID_TEMPLATE_COLUMNS,
  DETAILED_LEADING_OFFSET,
} from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import { useConversationActions } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationActions';
import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import { useMediaJobs } from '@/renderer/hooks/media/useMediaJobs';
import { normalizeWorkspaceKey } from '@/common/media/jobView';
import { groupConversationsByRecency } from '@/renderer/pages/conversation/GroupedHistory/utils/recencyGrouping';
import { useCronJobsMap } from '@/renderer/pages/cron';
import { useSiderTeamBadges } from '@/renderer/pages/team/hooks/useSiderTeamBadges';
import { useTeamList } from '@/renderer/pages/team/hooks/useTeamList';
import { Empty, Input, Modal } from '@arco-design/web-react';
import { Peoples, Search } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

const noop = () => {};
const EMPTY_SELECTION = new Set<string>();

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='flex items-center px-4px h-28px select-none'>
    <span className='text-14px text-t-tertiary font-[500] leading-none'>{children}</span>
  </div>
);

// Column labels for the detailed history rows below — same grid template as
// ConversationRow's `detailed` layout so the labels land exactly over their
// columns instead of just sitting above a wall of text.
const ConversationColumnHeader: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div
      className='grid items-center h-24px pr-16px select-none'
      style={{
        paddingLeft: DETAILED_LEADING_OFFSET,
        gridTemplateColumns: DETAILED_GRID_TEMPLATE_COLUMNS,
        columnGap: 12,
      }}
    >
      <span className='min-w-0 text-11px text-t-tertiary font-[500]'>
        {t('conversation.sessionCenter.colTitle', { defaultValue: '标题' })}
      </span>
      <span className='min-w-0 text-11px text-t-tertiary font-[500] text-right'>
        {t('conversation.sessionCenter.colMode', { defaultValue: '模式' })}
      </span>
      <span className='min-w-0 text-11px text-t-tertiary font-[500] text-right'>
        {t('conversation.sessionCenter.colModel', { defaultValue: '模型' })}
      </span>
      <span className='min-w-0 text-11px text-t-tertiary font-[500] text-right'>
        {t('conversation.sessionCenter.colUpdatedAt', { defaultValue: '更新时间' })}
      </span>
    </div>
  );
};

const TeamRow: React.FC<{ team: TTeam; badgeCount: number; onClick: () => void }> = ({ team, badgeCount, onClick }) => {
  const { t } = useTranslation();
  return (
    <div
      className='h-34px rd-8px flex items-center gap-8px pl-10px pr-16px cursor-pointer hover:bg-fill-3 transition-colors min-w-0'
      onClick={onClick}
    >
      <span className='size-22px flex items-center justify-center shrink-0 text-t-secondary'>
        <Peoples theme='outline' size='16' fill='currentColor' style={{ lineHeight: 0 }} />
      </span>
      <span className='flex-1 min-w-0 text-14px font-[500] text-t-primary truncate'>{team.name}</span>
      <span className='shrink-0 text-12px text-t-tertiary'>
        {t('team.sider.memberCount', { count: team.assistants.length })}
      </span>
      {badgeCount > 0 && (
        <span className='shrink-0 w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center leading-none bg-danger-6 text-white'>
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </div>
  );
};

const SessionCenter: React.FC = () => {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { getJobStatus, markAsRead } = useCronJobsMap();
  const [search, setSearch] = useState('');
  const teamsRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<HTMLDivElement>(null);
  const hasScrolledToSectionRef = useRef(false);

  const { teams } = useTeamList();
  const teamBadgeCounts = useSiderTeamBadges(teams);
  const sortedTeams = useMemo(() => teams.toSorted((a, b) => b.updated_at - a.updated_at), [teams]);

  const {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    pinnedConversations,
    projectGroups,
    conversationOnlySections,
    expandedWorkspaces,
    handleToggleWorkspace,
  } = useConversations();

  const {
    renameModalVisible,
    renameModalName,
    setRenameModalName,
    renameLoading,
    dropdownVisibleId,
    handleConversationClick,
    handleDeleteClick,
    handleEditStart,
    handleCreateCronTask,
    handleRenameConfirm,
    handleRenameCancel,
    handleTogglePin,
    handleToggleManualUnread,
    handleMenuVisibleChange,
    handleOpenMenu,
  } = useConversationActions({
    batchMode: false,
    selectedConversationIds: EMPTY_SELECTION,
    setSelectedConversationIds: noop,
    toggleSelectedConversation: noop,
    markAsRead,
    markManualUnread,
    clearManualUnread,
    isManualUnread,
  });

  // Unfiltered: every job across every conversation, so the map below can be
  // built once here instead of each row fetching its own history.
  const { jobs: mediaJobs } = useMediaJobs();
  const latestMediaByConversationId = useMemo(() => {
    type MediaEntry = { kind: 'image' | 'video'; model: string };
    const map = new Map<string, MediaEntry>();
    const byWorkspace = new Map<string, MediaEntry>();

    // Jobs come back sorted newest-first, so the first one seen per key is
    // already its most recent — no need to compare timestamps.
    for (const job of mediaJobs) {
      if (job.kind !== 'image' && job.kind !== 'video') continue;
      const entry: MediaEntry = { kind: job.kind, model: job.model };
      const conversationId = job.origin?.conversationId;
      if (conversationId) {
        if (!map.has(conversationId)) map.set(conversationId, entry);
        continue;
      }
      // A job started from the send box carries its conversation id; one an
      // agent started through an MCP tool call carries none — the protocol
      // has no notion of "which conversation called this tool" — only the
      // workspace it ran in. Same fallback `jobBelongsToConversation` uses to
      // attribute these inside an open conversation; reproduced here rather
      // than called per-row so the whole list is one pass instead of one scan
      // of the job history per conversation.
      const workspaceKey = normalizeWorkspaceKey(job.origin?.workspaceDir || '');
      if (workspaceKey && !byWorkspace.has(workspaceKey)) byWorkspace.set(workspaceKey, entry);
    }

    if (byWorkspace.size > 0) {
      for (const conversation of conversations) {
        if (map.has(conversation.id)) continue;
        const workspace = conversation.extra?.workspace;
        if (!workspace) continue;
        const hit = byWorkspace.get(normalizeWorkspaceKey(workspace));
        if (hit) map.set(conversation.id, hit);
      }
    }

    return map;
  }, [mediaJobs, conversations]);

  const getConversationRowProps = useCallback(
    (conversation: TChatConversation, dimIcon = false, detailed = false): ConversationRowProps => ({
      conversation,
      isGenerating: isConversationGenerating(conversation.id),
      hasUnread: hasCompletionUnread(conversation.id) || isManualUnread(conversation.id),
      isManualUnread: isManualUnread(conversation.id),
      collapsed: false,
      tooltipEnabled: false,
      batchMode: false,
      checked: false,
      selected: false,
      menuVisible: dropdownVisibleId === conversation.id,
      dimIcon,
      detailed,
      latestMedia: latestMediaByConversationId.get(conversation.id),
      onToggleChecked: noop,
      onConversationClick: handleConversationClick,
      onOpenMenu: handleOpenMenu,
      onMenuVisibleChange: handleMenuVisibleChange,
      onEditStart: handleEditStart,
      onCreateCronTask: handleCreateCronTask,
      onDelete: handleDeleteClick,
      onTogglePin: handleTogglePin,
      onToggleManualUnread: handleToggleManualUnread,
      getJobStatus,
    }),
    [
      isConversationGenerating,
      hasCompletionUnread,
      isManualUnread,
      dropdownVisibleId,
      latestMediaByConversationId,
      handleConversationClick,
      handleOpenMenu,
      handleMenuVisibleChange,
      handleEditStart,
      handleCreateCronTask,
      handleDeleteClick,
      handleTogglePin,
      handleToggleManualUnread,
      getJobStatus,
    ]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return conversations.filter((c) => (c.name || '').toLowerCase().includes(q));
  }, [conversations, search]);

  // Flatten the plain (non-workspace) conversations out of their timeline
  // wrapper — Session Center shows the full history, not the sidebar's
  // height-capped preview, so `previewLimit`-style truncation doesn't apply.
  const flatHistoryConversations = useMemo(() => {
    const flat: TChatConversation[] = [];
    for (const section of conversationOnlySections) {
      for (const item of section.items) {
        if (item.type === 'conversation' && item.conversation) flat.push(item.conversation);
      }
    }
    return flat;
  }, [conversationOnlySections]);

  const recencyBuckets = useMemo(
    () => groupConversationsByRecency(flatHistoryConversations, i18n.language),
    [flatHistoryConversations, i18n.language]
  );

  const isSearchActive = search.trim().length > 0;
  const isEmpty =
    pinnedConversations.length === 0 &&
    projectGroups.length === 0 &&
    conversationOnlySections.length === 0 &&
    sortedTeams.length === 0;

  // Deep-link entry from the sidebar's per-section "view all" buttons: land
  // directly on that section instead of making the user scroll to find it.
  useEffect(() => {
    if (hasScrolledToSectionRef.current || isSearchActive) return;
    const targetSection = new URLSearchParams(location.search).get('section');
    const targetRef =
      targetSection === 'teams'
        ? teamsRef
        : targetSection === 'projects'
          ? projectsRef
          : targetSection === 'conversations'
            ? conversationsRef
            : null;
    if (targetRef?.current) {
      targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      hasScrolledToSectionRef.current = true;
    }
  }, [location.search, isSearchActive, sortedTeams, projectGroups, conversationOnlySections]);

  return (
    <div className='size-full flex flex-col px-24px py-20px min-h-0'>
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

      <div className='shrink-0 mb-16px'>
        <h2 className='m-0 text-18px font-700 text-t-primary'>{t('conversation.sessionCenter.title')}</h2>
      </div>

      <Input
        prefix={<Search theme='outline' size={14} />}
        placeholder={t('conversation.sessionCenter.searchPlaceholder')}
        value={search}
        onChange={setSearch}
        allowClear
        className='shrink-0 mb-16px !max-w-480px'
      />

      <div className='flex-1 min-h-0 overflow-y-auto'>
        {isSearchActive ? (
          filtered.length === 0 ? (
            <Empty description={t('conversation.sessionCenter.emptySearch')} />
          ) : (
            filtered.map((c) => <ConversationRow key={c.id} {...getConversationRowProps(c)} />)
          )
        ) : isEmpty ? (
          <Empty description={t('conversation.history.noHistory')} />
        ) : (
          <>
            {sortedTeams.length > 0 && (
              <div ref={teamsRef} className='mb-16px'>
                <SectionHeading>{t('team.sider.title')}</SectionHeading>
                {sortedTeams.map((team) => (
                  <TeamRow
                    key={team.id}
                    team={team}
                    badgeCount={teamBadgeCounts.get(team.id) ?? 0}
                    onClick={() => void navigate(`/team/${team.id}`)}
                  />
                ))}
              </div>
            )}

            {pinnedConversations.length > 0 && (
              <div className='mb-16px'>
                <SectionHeading>{t('conversation.history.pinnedSection')}</SectionHeading>
                {pinnedConversations.map((c) => (
                  <ConversationRow key={c.id} {...getConversationRowProps(c)} />
                ))}
              </div>
            )}

            {projectGroups.length > 0 && (
              <div ref={projectsRef} className='mb-16px'>
                <SectionHeading>{t('conversation.history.projectsSection')}</SectionHeading>
                {projectGroups.map((group) => (
                  <WorkspaceCollapse
                    key={group.workspace}
                    expanded={expandedWorkspaces.includes(group.workspace)}
                    onToggle={() => handleToggleWorkspace(group.workspace)}
                    header={
                      <span className='text-14px font-[500] truncate flex-1 text-t-primary min-w-0'>
                        {group.displayName}
                      </span>
                    }
                  >
                    {group.conversations.map((c) => (
                      <ConversationRow key={c.id} {...getConversationRowProps(c, true)} />
                    ))}
                  </WorkspaceCollapse>
                ))}
              </div>
            )}

            {recencyBuckets.length > 0 && (
              <div ref={conversationsRef} className='mb-16px'>
                <SectionHeading>{t('conversation.history.conversationsSection')}</SectionHeading>
                <ConversationColumnHeader />
                {recencyBuckets.map((bucket) => (
                  <div key={bucket.kind === 'recent' ? 'recent' : `${bucket.kind}-${bucket.sortKey}`}>
                    {bucket.kind !== 'recent' && (
                      <div className='flex items-center px-4px h-24px select-none'>
                        <span className='text-12px text-t-secondary font-[500] leading-none'>{bucket.label}</span>
                      </div>
                    )}
                    {bucket.conversations.map((c) => (
                      <ConversationRow key={c.id} {...getConversationRowProps(c, false, true)} />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SessionCenter;
