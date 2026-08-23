/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ChartStock,
  Code,
  Data,
  DeleteOne,
  EditOne,
  FullScreen,
  Peoples,
  Plus,
  Pushpin,
  Right,
  Search,
  Shield,
  StockMarket,
  TopicDiscussion,
  Target,
  Write,
} from '@icon-park/react';
import { Input, Message, Modal, Spin, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSWRConfig } from 'swr';
import { cleanupSiderTooltips } from '@renderer/utils/ui/siderTooltip';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import { useTeamList } from '@renderer/pages/team/hooks/useTeamList';
import { useSiderTeamBadges } from '@renderer/pages/team/hooks/useSiderTeamBadges';
import TeamCreateModal from '@renderer/pages/team/components/TeamCreateModal';
import { ipcBridge } from '@/common';
import SiderItem from './SiderItem';
import type { SiderMenuItem } from './SiderItem';
import { useSiderTeamRunning } from './useSiderTeamRunning';
import siderStyles from './Sider.module.css';

const TEAM_PINNED_KEY = 'team-pinned-ids';
// Sidebar shows only a preview; the full list lives in the Session Center (/sessions).
const SIDEBAR_TEAM_PREVIEW_LIMIT = 3;

const TEAM_ACCENTS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#059669'] as const;

const getStableAccent = (name: string) => {
  const hash = Array.from(name).reduce((value, char) => (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0, 0);
  return TEAM_ACCENTS[hash % TEAM_ACCENTS.length];
};

const getTeamVisual = (name: string, testId: string) => {
  const commonProps = { 'data-testid': testId, theme: 'outline' as const, size: '13', fill: 'currentColor' };
  if (/安全|security|测试|test/i.test(name)) return { icon: <Shield {...commonProps} />, accent: '#dc2626' };
  if (/讨论|交流|discussion|chat/i.test(name)) {
    return { icon: <TopicDiscussion {...commonProps} />, accent: '#2563eb' };
  }
  if (/分析|analysis|研判/i.test(name)) return { icon: <ChartStock {...commonProps} />, accent: '#059669' };
  if (/股票|股市|stock|finance|投资|基金/i.test(name)) {
    return { icon: <StockMarket {...commonProps} />, accent: '#059669' };
  }
  if (/代码|开发|编程|code|dev/i.test(name)) return { icon: <Code {...commonProps} />, accent: '#7c3aed' };
  if (/调研|研究|搜索|research|search/i.test(name)) return { icon: <Search {...commonProps} />, accent: '#0891b2' };
  if (/写作|文案|报告|write|content/i.test(name)) return { icon: <Write {...commonProps} />, accent: '#db2777' };
  if (/运营|营销|增长|目标|marketing|growth/i.test(name))
    return { icon: <Target {...commonProps} />, accent: '#ea580c' };
  if (/数据|数据库|database/i.test(name)) return { icon: <Data {...commonProps} />, accent: '#0891b2' };
  if (/团队|协作|team|people/i.test(name)) return { icon: <Peoples {...commonProps} />, accent: '#2563eb' };

  const initial = Array.from(name.trim())[0]?.toUpperCase() || 'T';
  return {
    icon: (
      <span data-testid={testId} className={siderStyles.teamInitial} aria-hidden='true'>
        {initial}
      </span>
    ),
    accent: getStableAccent(name),
  };
};

type SiderTooltipProps = React.ComponentProps<typeof Tooltip>;

interface TeamSiderSectionProps {
  collapsed: boolean;
  pathname: string;
  siderTooltipProps: Partial<SiderTooltipProps>;
  onSessionClick?: () => void;
}

const TeamSiderSection: React.FC<TeamSiderSectionProps> = ({
  collapsed,
  pathname,
  siderTooltipProps,
  onSessionClick,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { teams, mutate: refreshTeams, removeTeam } = useTeamList();
  const teamBadgeCounts = useSiderTeamBadges(teams);
  const isTeamRunning = useSiderTeamRunning(teams);
  const { mutate: globalMutate } = useSWRConfig();

  const [createTeamVisible, setCreateTeamVisible] = useState(false);
  const [expanded, setExpanded] = useState<boolean>(() => localStorage.getItem('team-section-expanded') === 'true');
  useEffect(() => {
    localStorage.setItem('team-section-expanded', String(expanded));
  }, [expanded]);

  const [pinnedIds, setPinnedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(TEAM_PINNED_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(TEAM_PINNED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const [renameVisible, setRenameVisible] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameId || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await ipcBridge.team.renameTeam.invoke({ id: renameId, name: renameName.trim() });
      await refreshTeams();
      await globalMutate(`team/${renameId}`);
      Message.success(t('team.sider.renameSuccess'));
      setRenameVisible(false);
      setRenameId(null);
      setRenameName('');
    } catch (err) {
      console.error('Failed to rename team:', err);
      Message.error(t('team.sider.rename'));
    } finally {
      setRenameLoading(false);
    }
  }, [globalMutate, refreshTeams, renameId, renameName, t]);

  const sortedTeams = useMemo(() => {
    const pinned = teams.filter((team) => pinnedIds.includes(team.id));
    const unpinned = teams.filter((team) => !pinnedIds.includes(team.id));
    return [...pinned, ...unpinned];
  }, [teams, pinnedIds]);

  // Sidebar is a preview — cap to a handful, keeping the currently open team
  // visible even if it falls outside the cap (e.g. reached via deep link).
  const visibleTeams = useMemo(() => {
    const capped = sortedTeams.slice(0, SIDEBAR_TEAM_PREVIEW_LIMIT);
    const active = sortedTeams.find((team) => pathname.startsWith(`/team/${team.id}`));
    if (active && !capped.some((team) => team.id === active.id)) {
      capped.push(active);
    }
    return capped;
  }, [sortedTeams, pathname]);

  const handleViewAllClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigate('/sessions?section=teams');
    },
    [navigate]
  );

  const handleTeamClick = useCallback(
    (team_id: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      Promise.resolve(navigate(`/team/${team_id}`)).catch(console.error);
      if (onSessionClick) onSessionClick();
    },
    [navigate, onSessionClick]
  );

  return (
    <>
      {collapsed ? (
        visibleTeams.length > 0 && (
          <div className='shrink-0 flex flex-col gap-2px'>
            {visibleTeams.map((team) => {
              const isActive = pathname.startsWith(`/team/${team.id}`);
              const isRunning = isTeamRunning(team.id);
              const teamVisual = getTeamVisual(team.name, `collapsed-team-icon-${team.id}`);
              return (
                <Tooltip key={team.id} {...siderTooltipProps} content={team.name} position='right'>
                  <div
                    data-testid={`collapsed-team-item-${team.id}`}
                    className={classNames(
                      'relative w-full h-40px flex items-center justify-center cursor-pointer transition-colors rd-8px',
                      isActive ? '!bg-active' : 'hover:bg-fill-3 active:bg-fill-4'
                    )}
                    onClick={() => handleTeamClick(team.id)}
                  >
                    {isRunning ? (
                      <span
                        data-testid={`collapsed-team-spinner-${team.id}`}
                        className='flex items-center justify-center'
                      >
                        <Spin size={16} />
                      </span>
                    ) : (
                      <span
                        className={classNames('flex-center', siderStyles.teamItemIcon)}
                        style={{ '--team-accent': teamVisual.accent } as React.CSSProperties}
                      >
                        {teamVisual.icon}
                      </span>
                    )}
                    {(teamBadgeCounts.get(team.id) ?? 0) > 0 && (
                      <span
                        className='absolute top-4px end-4px w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center leading-none bg-danger-6 text-white'
                        style={{ lineHeight: 1 }}
                      >
                        {(teamBadgeCounts.get(team.id) ?? 0) > 99 ? '99+' : teamBadgeCounts.get(team.id)}
                      </span>
                    )}
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )
      ) : (
        <div className='shrink-0 flex flex-col gap-2px'>
          <div
            className={classNames(
              'group/label sider-section-label flex items-center gap-8px pl-10px pr-8px h-34px select-none mt-2px cursor-pointer',
              siderStyles.teamSectionHeader
            )}
            data-testid='team-section-toggle'
            onClick={() => setExpanded((v) => !v)}
          >
            <span
              className={classNames(
                'flex items-center justify-center shrink-0 transition-colors',
                siderStyles.teamSectionIcon
              )}
            >
              <Peoples theme='outline' size='13' fill='currentColor' style={{ lineHeight: 0 }} />
            </span>
            <span className='text-14px text-t-tertiary sider-section-title group-hover/label:text-t-primary transition-colors font-[500] leading-none'>
              {t('team.sider.title')}
            </span>
            <span className='ms-2px flex items-center justify-center opacity-0 group-hover/label:opacity-100 transition-opacity text-t-tertiary shrink-0'>
              <Right
                theme='outline'
                size={12}
                className={classNames('transition-transform duration-150', { 'rotate-90': expanded })}
              />
            </span>
            {sortedTeams.length > 0 && (
              <Tooltip content={t('conversation.history.viewAllTooltip')} position='top'>
                <div
                  role='button'
                  tabIndex={0}
                  aria-label={t('conversation.history.viewAllTooltip')}
                  className='ml-auto size-20px rd-4px flex items-center justify-center hover:bg-fill-4 transition-all shrink-0 cursor-pointer text-t-secondary hover:text-t-primary'
                  onClick={handleViewAllClick}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void navigate('/sessions?section=teams');
                    }
                  }}
                >
                  <FullScreen theme='outline' size='14' fill='currentColor' className='block leading-none' />
                </div>
              </Tooltip>
            )}
            {/* [E2E SYNC] data-testid="team-create-btn" 是 E2E 测试的入口 selector，不得删除或重命名。
                如需修改，必须同步更新 tests/e2e/cases/teams/team-create.e2e.ts。 */}
            <Tooltip content={t('team.sider.createTeam')} position='top'>
              <div
                data-testid='team-create-btn'
                className={classNames(
                  'size-20px rd-4px flex items-center justify-center hover:bg-fill-4 transition-all shrink-0 cursor-pointer text-t-secondary hover:text-t-primary',
                  sortedTeams.length === 0 && 'ms-auto -me-4px'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setCreateTeamVisible(true);
                }}
              >
                <Plus
                  theme='outline'
                  size='14'
                  fill='currentColor'
                  className='block leading-none'
                  style={{ lineHeight: 0 }}
                />
              </div>
            </Tooltip>
          </div>
          {expanded && visibleTeams.length > 0 && (
            <div className='min-h-0 pl-8px'>
              {visibleTeams.map((team) => {
                const isPinned = pinnedIds.includes(team.id);
                const menuItems: SiderMenuItem[] = [
                  {
                    key: 'pin',
                    icon: <Pushpin theme='outline' size='14' />,
                    label: isPinned ? t('team.sider.unpin') : t('team.sider.pin'),
                  },
                  {
                    key: 'rename',
                    icon: <EditOne theme='outline' size='14' />,
                    label: t('team.sider.rename'),
                  },
                  {
                    key: 'delete',
                    icon: <DeleteOne theme='outline' size='14' />,
                    label: t('team.sider.delete'),
                    danger: true,
                  },
                ];
                const teamBadge = teamBadgeCounts.get(team.id) ?? 0;
                const isRunning = isTeamRunning(team.id);
                const teamVisual = getTeamVisual(team.name, `team-icon-${team.id}`);
                return (
                  <div key={team.id} className='relative group'>
                    <SiderItem
                      icon={
                        isRunning ? (
                          <span data-testid={`team-spinner-${team.id}`} className='flex items-center justify-center'>
                            <Spin size={16} />
                          </span>
                        ) : (
                          <span
                            className={classNames('flex-center', siderStyles.teamItemIcon)}
                            style={{ '--team-accent': teamVisual.accent } as React.CSSProperties}
                          >
                            {teamVisual.icon}
                          </span>
                        )
                      }
                      name={team.name}
                      selected={pathname.startsWith(`/team/${team.id}`)}
                      selectedClassName={siderStyles.teamItemSelected}
                      pinned={isPinned && !isRunning}
                      menuItems={menuItems}
                      onMenuAction={(key) => {
                        if (key === 'pin') {
                          togglePin(team.id);
                        } else if (key === 'rename') {
                          setRenameId(team.id);
                          setRenameName(team.name);
                          setRenameVisible(true);
                        } else if (key === 'delete') {
                          Modal.confirm({
                            title: t('team.sider.deleteConfirm'),
                            content: t('team.sider.deleteConfirmContent'),
                            okText: t('team.sider.deleteOk'),
                            cancelText: t('team.sider.deleteCancel'),
                            okButtonProps: { status: 'warning' },
                            onOk: async () => {
                              const teamIdToDelete = team.id;
                              await removeTeam(teamIdToDelete);
                              Message.success(t('team.sider.deleteSuccess'));
                              if (window.location.hash.includes(`/team/${teamIdToDelete}`)) {
                                window.location.hash = '#/';
                              }
                            },
                            style: { borderRadius: '12px' },
                            alignCenter: true,
                            getPopupContainer: () => document.body,
                          });
                        }
                      }}
                      onClick={() => handleTeamClick(team.id)}
                    />
                    {teamBadge > 0 && (
                      <span
                        className='absolute end-11px top-1/2 -translate-y-1/2 w-18px h-18px rounded-full text-10px font-bold flex items-center justify-center pointer-events-none z-10 group-hover:hidden bg-danger-6 text-white'
                        style={{ lineHeight: 1 }}
                      >
                        {teamBadge > 99 ? '99+' : teamBadge}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <TeamCreateModal
        visible={createTeamVisible}
        onClose={() => setCreateTeamVisible(false)}
        onCreated={(team) => {
          void refreshTeams();
          Promise.resolve(navigate(`/team/${team.id}`)).catch(console.error);
        }}
      />
      <Modal
        title={t('team.sider.renameTitle')}
        visible={renameVisible}
        onOk={() => void handleRenameConfirm()}
        onCancel={() => {
          setRenameVisible(false);
          setRenameId(null);
          setRenameName('');
        }}
        okText={t('team.sider.renameOk')}
        cancelText={t('team.sider.renameCancel')}
        confirmLoading={renameLoading}
        okButtonProps={{ disabled: !renameName.trim() }}
        style={{ borderRadius: '12px' }}
        alignCenter
        getPopupContainer={() => document.body}
      >
        <Input
          autoFocus
          value={renameName}
          onChange={setRenameName}
          onPressEnter={() => void handleRenameConfirm()}
          placeholder={t('team.sider.renamePlaceholder')}
          allowClear
        />
      </Modal>
    </>
  );
};

export default TeamSiderSection;
