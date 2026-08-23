/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAgentLogos } from '@/renderer/utils/model/agentLogo';
import ThemedLogo from '@/renderer/components/agent/ThemedLogo';
import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { usePresetAssistantInfo } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { CronJobIndicator } from '@/renderer/pages/cron';
import { resolveConversationLeadingMark } from '@/renderer/pages/conversation/utils/conversationAssistantIdentity';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getActivityTime } from '@/renderer/utils/chat/timeline';
import { Checkbox, Dropdown, Menu, Spin, Tooltip } from '@arco-design/web-react';
import { DeleteOne, EditOne, Export, Inbox, MessageOne, MoreOne, Pushpin, Robot, Timer } from '@icon-park/react';
import ForkBranchIcon from '@renderer/components/base/ForkBranchIcon';
import classNames from 'classnames';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { ConversationRowProps } from './types';
import { isConversationPinned } from './utils/groupingHelpers';

// Fixed column widths for `detailed` rows (Session Center's history list).
export const DETAILED_MODE_COL_WIDTH = 76;
export const DETAILED_MODEL_COL_WIDTH = 140;
export const DETAILED_DATE_COL_WIDTH = 160;
// Matches the row's own left padding (pl-10px) + leading-icon width
// (size-22px) + gap (gap-8px) — the offset before the title column starts.
export const DETAILED_LEADING_OFFSET = 40;
// Single source of truth for the detailed row's column layout — the header
// (SessionCenter/index.tsx's `ConversationColumnHeader`) renders this exact
// same template so its labels can never drift out of alignment with the row
// data beneath them (a flex `ml-auto` on one side and not the other did
// exactly that, once).
//
// The title column is `minmax(0, 1fr)`: it claims every pixel the other
// three columns don't need. A short title on a wide window therefore grows a
// wider (still ellipsis-capped) title cell — spare width shows up *inside*
// the title, not as dead space trailing after the last column or floating
// between the title and the data. `minmax(0, …)` rather than bare `1fr` is
// required for the ellipsis to work at all: a grid track's implicit minimum
// is its content's natural width, which for `white-space: nowrap` text is
// the full untruncated string.
export const DETAILED_GRID_TEMPLATE_COLUMNS = `minmax(0, 1fr) ${DETAILED_MODE_COL_WIDTH}px ${DETAILED_MODEL_COL_WIDTH}px ${DETAILED_DATE_COL_WIDTH}px`;

type ModeKind = 'chat' | 'image' | 'video';

/**
 * "对话模式" column — what this conversation's most recent turn actually
 * produced, not what its currently-selected chat model happens to be.
 *
 * `conversation.model` is whichever model the send box is pointed at right
 * now; a conversation whose chat model is a plain text model can still have
 * generated an image last turn through a one-off media-mode selection (or an
 * agent-invoked media tool), and `conversation.model` says nothing about
 * that. The only trustworthy signal is the job history itself, keyed by
 * conversation id — see `latestMedia` (from `useMediaJobs()`, resolved by the
 * caller so this stays a pure lookup instead of every row fetching jobs).
 */
const resolveModeKind = (latestMedia: ConversationRowProps['latestMedia']): ModeKind => latestMedia?.kind ?? 'chat';

const ConversationRow: React.FC<ConversationRowProps> = (props) => {
  const {
    conversation,
    isGenerating,
    hasUnread,
    collapsed,
    tooltipEnabled,
    batchMode,
    checked,
    selected,
    menuVisible,
    dimIcon = false,
    detailed = false,
    latestMedia,
  } = props;
  const logos = useAgentLogos();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const {
    onToggleChecked,
    onConversationClick,
    onOpenMenu,
    onMenuVisibleChange,
    onEditStart,
    onCreateCronTask,
    onDelete,
    onExport,
    onTogglePin,
    onToggleManualUnread,
    isManualUnread,
    getJobStatus,
  } = props;
  const { t, i18n } = useTranslation();
  const { info: assistantInfo } = usePresetAssistantInfo(conversation);
  const isPinned = isConversationPinned(conversation);
  // Fork-lineage badge: present only on forked conversations (extra.fork is
  // server-minted by the fork API). Parent name resolves from the loaded
  // sidebar list; a deleted/unloaded parent degrades to the generic tip.
  const forkLineage = (conversation.extra as { fork?: { parent_conversation_id?: string } } | undefined)?.fork;
  const forkParentName = forkLineage?.parent_conversation_id
    ? props.resolveConversationName?.(forkLineage.parent_conversation_id)
    : undefined;
  const cronStatus = getJobStatus(conversation.id);
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  const inlineNameTooltipEnabled = !collapsed && !isMobile && !!conversation.name;

  // Session Center-only metadata — date, model and mode as separate columns
  // rather than one joined string, so they line up under the header row's
  // "更新时间" / "模型" / "模式" labels instead of reading as a run-on line.
  const detailedMeta = useMemo(() => {
    if (!detailed) return { dateLabel: '', modelLabel: '', modeKind: 'chat' as ModeKind };
    const time = getActivityTime(conversation);
    // `i18n` is optional-chained: this only matters to callers that pass
    // `detailed`, but tests across the codebase mock `useTranslation` with
    // just `{ t }`, and this hook must not crash for those unrelated cases.
    const dateLabel = time
      ? new Intl.DateTimeFormat(i18n?.language, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(time)
      : '';
    // Only 'dream' (1ONE CLI) conversations carry a persisted provider/model
    // selection — ACP-backed types (Claude Code, Codex CLI, Cursor, …) manage
    // their model differently and have no equivalent field to show here. When
    // the last turn was a media generation, the model that actually ran it
    // takes priority — it's frequently a different model than the chat model
    // (a text conversation with one image turn shouldn't claim its chat model
    // made that image).
    const modelLabel = latestMedia?.model || (conversation.type === 'dream' ? conversation.model.use_model : '');
    return { dateLabel, modelLabel, modeKind: resolveModeKind(latestMedia) };
  }, [detailed, conversation, i18n?.language, latestMedia]);

  const modeLabel = {
    chat: t('conversation.sessionCenter.modeChat', { defaultValue: '对话' }),
    image: t('conversation.sessionCenter.modeImage', { defaultValue: '图片生成' }),
    video: t('conversation.sessionCenter.modeVideo', { defaultValue: '视频生成' }),
  }[detailedMeta.modeKind];
  // Semantic-ish but distinct hues per mode so the column is scannable at a
  // glance (not just readable one row at a time): chat stays neutral (it's
  // the overwhelming majority of rows), image/video get their own colors
  // rather than sharing one "media" color, since the user wants to tell them
  // apart from each other too, not just from chat.
  const modeColorClass = {
    chat: 'text-t-tertiary',
    image: 'text-blue-6',
    video: 'text-purple-6',
  }[detailedMeta.modeKind];

  const renderLeadingIcon = () => {
    if (cronStatus !== 'none') {
      return <CronJobIndicator status={cronStatus} size={16} className='flex-shrink-0' />;
    }

    // When the row is pinned, hovering reveals a pushpin marker that overlays
    // the leading icon. We dim the resting icon on hover so the pin reads cleanly.
    const pinnedHoverFade = isPinned ? 'group-hover:opacity-0 transition-opacity' : '';
    const composedClass = classNames(pinnedHoverFade);

    const leadingMark = resolveConversationLeadingMark(conversation, assistantInfo, logos);
    if (leadingMark.kind === 'emoji') {
      return (
        <span className={classNames('text-16px leading-none flex-shrink-0', composedClass)}>{leadingMark.value}</span>
      );
    }
    if (leadingMark.kind === 'image') {
      return (
        <ThemedLogo
          src={leadingMark.value}
          alt={leadingMark.label}
          className={classNames('w-16px h-16px rounded-50% flex-shrink-0', composedClass)}
        />
      );
    }
    if (leadingMark.kind === 'assistant_fallback') {
      return (
        <Robot
          theme='outline'
          size='16'
          className={classNames('line-height-0 flex-shrink-0 text-t-secondary', composedClass)}
        />
      );
    }

    return (
      <MessageOne
        theme='outline'
        size='16'
        className={classNames('line-height-0 flex-shrink-0 text-t-secondary', composedClass)}
      />
    );
  };

  const handleRowClick = () => {
    cleanupSiderTooltips();
    if (batchMode) {
      onToggleChecked(conversation);
      return;
    }
    onConversationClick(conversation);
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    cleanupSiderTooltips();
    if (batchMode) {
      return;
    }
    onOpenMenu(conversation);
  };

  const renderCompletionUnreadDot = () => {
    if (batchMode || !hasUnread || isGenerating) {
      return null;
    }

    return (
      <span className='absolute end-8px top-1/2 -translate-y-1/2 flex items-center justify-center group-hover:hidden'>
        <span className='h-8px w-8px rounded-full bg-#2C7FFF shadow-[0_0_0_2px_rgba(44,127,255,0.18)]' />
      </span>
    );
  };

  return (
    <Tooltip
      key={conversation.id}
      {...siderTooltipProps}
      content={conversation.name || t('conversation.welcome.newConversation')}
      position='right'
    >
      <div
        id={'c-' + conversation.id}
        className={classNames(
          'chat-history__item rd-8px flex items-center group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px min-w-0 transition-colors',
          detailed ? 'h-46px' : 'h-34px',
          collapsed ? 'justify-center px-0' : 'justify-start gap-8px pe-16px',
          // dimIcon means this row sits inside a project/cron parent — visually indent the row content while keeping the bg full-width
          !collapsed && (dimIcon ? 'ps-34px' : 'ps-10px'),
          {
            'hover:bg-fill-3': !batchMode && !selected,
            '!bg-fill-3': selected,
            'bg-[rgba(var(--primary-6),0.08)]': batchMode && checked,
          }
        )}
        onClick={handleRowClick}
        onContextMenu={handleRowContextMenu}
      >
        {batchMode && (
          <span
            className='me-8px flex-center'
            onClick={(event) => {
              event.stopPropagation();
              onToggleChecked(conversation);
            }}
          >
            <Checkbox checked={checked} />
          </span>
        )}
        <span className='size-22px flex items-center justify-center shrink-0 relative'>
          {isGenerating && !batchMode ? <Spin size={16} /> : renderLeadingIcon()}
          {/* Pinned indicator: only visible when row is hovered, overlays leading icon */}
          {!batchMode && isPinned && !isMobile && !isGenerating && (
            <span
              className='absolute inset-0 flex-center text-t-secondary pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity'
              style={{ lineHeight: 0 }}
            >
              <Pushpin theme='outline' size='14' />
            </span>
          )}
        </span>
        {detailed ? (
          // A real table layout (CSS grid), not a flex row: the title track
          // is `minmax(0, 1fr)` so it — not the empty space after the last
          // column — absorbs whatever width the three fixed columns don't
          // need. Must mirror ConversationColumnHeader's grid template
          // exactly or the header labels drift out of alignment with the
          // data beneath them (this has happened once already).
          <div
            className='grid items-center min-w-0 flex-1 collapsed-hidden'
            style={{ gridTemplateColumns: DETAILED_GRID_TEMPLATE_COLUMNS, columnGap: 12 }}
          >
            <Tooltip
              content={conversation.name}
              disabled={!inlineNameTooltipEnabled}
              trigger='hover'
              popupVisible={inlineNameTooltipEnabled ? undefined : false}
              unmountOnExit
              popupHoverStay={false}
              position='top'
            >
              <div className='chat-history__item-name overflow-hidden text-ellipsis flex items-center gap-4px min-w-0 text-14px font-[500] lh-20px whitespace-nowrap text-t-primary'>
                <span className='block overflow-hidden text-ellipsis whitespace-nowrap min-w-0'>
                  {conversation.name}
                </span>
                {forkLineage && (
                  <span className='flex-shrink-0 line-height-0 text-t-tertiary' data-testid='conversation-fork-badge'>
                    <ForkBranchIcon size={12} />
                  </span>
                )}
              </div>
            </Tooltip>
            <div
              className={classNames(
                'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-12px lh-16px font-[500] text-right',
                modeColorClass
              )}
            >
              {modeLabel}
            </div>
            <div className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-12px lh-16px text-t-secondary text-right'>
              {detailedMeta.modelLabel || '—'}
            </div>
            <div className='min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-12px lh-16px text-t-tertiary text-right'>
              {detailedMeta.dateLabel}
            </div>
          </div>
        ) : (
          <FlexFullContainer className='h-24px min-w-0 flex-1 collapsed-hidden'>
            <Tooltip
              content={conversation.name}
              disabled={!inlineNameTooltipEnabled}
              trigger='hover'
              popupVisible={inlineNameTooltipEnabled ? undefined : false}
              unmountOnExit
              popupHoverStay={false}
              position='top'
            >
              <div className='chat-history__item-name overflow-hidden text-ellipsis flex items-center gap-4px w-full text-14px font-[500] lh-24px whitespace-nowrap min-w-0 text-t-primary'>
                <span className='block overflow-hidden text-ellipsis whitespace-nowrap min-w-0'>
                  {conversation.name}
                </span>
                {forkLineage && (
                  <Tooltip
                    content={
                      forkParentName
                        ? t('conversation.history.forkedFrom', { name: forkParentName })
                        : t('conversation.history.forkedConversation')
                    }
                    position='top'
                  >
                    <span className='flex-shrink-0 line-height-0 text-t-tertiary' data-testid='conversation-fork-badge'>
                      <ForkBranchIcon size={12} />
                    </span>
                  </Tooltip>
                )}
              </div>
            </Tooltip>
          </FlexFullContainer>
        )}

        {renderCompletionUnreadDot()}
        {!batchMode && (
          <div
            className={classNames(
              'absolute end-8px top-1/2 -translate-y-1/2 items-center justify-end !collapsed-hidden',
              {
                flex: isMobile || menuVisible,
                'hidden group-hover:flex': !isMobile && !menuVisible,
              }
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <Dropdown
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    if (key === 'pin') {
                      onTogglePin(conversation);
                      return;
                    }
                    if (key === 'toggleManualUnread') {
                      onToggleManualUnread(conversation);
                      return;
                    }
                    if (key === 'rename') {
                      onEditStart(conversation);
                      return;
                    }
                    if (key === 'createCronTask') {
                      onCreateCronTask(conversation);
                      return;
                    }
                    if (key === 'export') {
                      onExport?.(conversation);
                      return;
                    }
                    if (key === 'delete') {
                      onDelete(conversation.id);
                    }
                  }}
                >
                  <Menu.Item key='pin'>
                    <div className='flex items-center gap-8px'>
                      <Pushpin theme='outline' size='14' />
                      <span>{isPinned ? t('conversation.history.unpin') : t('conversation.history.pin')}</span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='toggleManualUnread'>
                    <div className='flex items-center gap-8px'>
                      <Inbox theme='outline' size='14' />
                      <span>
                        {isManualUnread ? t('conversation.history.markAsRead') : t('conversation.history.markAsUnread')}
                      </span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='rename'>
                    <div className='flex items-center gap-8px'>
                      <EditOne theme='outline' size='14' />
                      <span>{t('conversation.history.rename')}</span>
                    </div>
                  </Menu.Item>
                  <Menu.Item key='createCronTask'>
                    <div className='flex items-center gap-8px'>
                      <Timer theme='outline' size='14' />
                      <span>{t('conversation.history.createCronTask')}</span>
                    </div>
                  </Menu.Item>
                  {onExport && (
                    <Menu.Item key='export'>
                      <div className='flex items-center gap-8px'>
                        <Export theme='outline' size='14' />
                        <span>{t('conversation.history.export')}</span>
                      </div>
                    </Menu.Item>
                  )}
                  <Menu.Item key='delete'>
                    <div className='flex items-center gap-8px text-[rgb(var(--warning-6))]'>
                      <DeleteOne theme='outline' size='14' />
                      <span>{t('conversation.history.deleteTitle')}</span>
                    </div>
                  </Menu.Item>
                </Menu>
              }
              trigger='click'
              position='br'
              popupVisible={menuVisible}
              onVisibleChange={(visible) => onMenuVisibleChange(conversation.id, visible)}
              getPopupContainer={() => document.body}
              unmountOnExit={false}
            >
              <span
                data-testid={`conversation-row-menu-${conversation.id}`}
                className={classNames(
                  'flex-center cursor-pointer transition-colors text-t-secondary hover:text-t-primary size-20px rd-4px sider-action-btn',
                  {
                    flex: isMobile || menuVisible,
                    'hidden group-hover:flex': !isMobile && !menuVisible,
                  }
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenMenu(conversation);
                }}
              >
                <MoreOne theme='outline' size='14' fill='currentColor' className='block leading-none' />
              </span>
            </Dropdown>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default ConversationRow;
