/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ParsedSessionBlock,
  SessionMessagePayload,
  SessionTarget,
  SessionsPayload,
} from '@renderer/utils/chat/sessionBlockParser';
import { useNavigate } from 'react-router-dom';
import { iconColors } from '@renderer/styles/colors';
import { Message, Right } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';

const VIEW_TESTID = 'session-block-view-conversation';

const WorkspaceBadge: React.FC<{ same: boolean }> = ({ same }) => {
  const { t } = useTranslation('conversation');
  return (
    <span
      className={classNames(
        'text-11px px-6px py-1px rd-4px select-none',
        same ? 'bg-success text-white' : 'bg-warning text-white'
      )}
      data-testid='session-block-workspace-badge'
    >
      {same
        ? t('sessionBlock.sameWorkspace', { defaultValue: '同一工作区' })
        : t('sessionBlock.differentWorkspace', { defaultValue: '跨工作区' })}
    </span>
  );
};

const CardShell: React.FC<{
  testid: string;
  title: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ testid, title, badge, children, footer }) => (
  <div className='w-full rd-8px border border-4 bg-1 px-10px py-8px flex flex-col gap-6px' data-testid={testid}>
    <div className='flex items-center gap-8px flex-wrap'>
      <span className='text-13px font-medium' style={{ color: 'var(--text-primary)' }}>
        {title}
      </span>
      {badge}
    </div>
    <div className='text-13px whitespace-pre-wrap [overflow-wrap:anywhere]' style={{ color: 'var(--text-primary)' }}>
      {children}
    </div>
    {footer}
  </div>
);

const ViewConversationLink: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const navigate = useNavigate();
  const { t } = useTranslation('conversation');
  return (
    <div
      className='text-12px cursor-pointer select-none mt-2px hover:underline w-max'
      style={{ color: iconColors.secondary }}
      data-testid={VIEW_TESTID}
      onClick={() => navigate(`/conversation/${conversationId}`)}
    >
      {t('sessionBlock.viewConversation', { defaultValue: '查看会话' })}
    </div>
  );
};

const InboundCard: React.FC<{ payload: SessionMessagePayload }> = ({ payload }) => {
  const { t } = useTranslation('conversation');
  return (
    <CardShell
      testid='session-message-block'
      title={
        <>
          <Message theme='outline' size='14' fill={iconColors.secondary} />{' '}
          {t('sessionBlock.messageFrom', {
            defaultValue: '来自会话「{{title}}」的消息',
            title: payload.from_title,
          })}
        </>
      }
      badge={<WorkspaceBadge same={payload.same_workspace} />}
      footer={
        payload.reply_requested && payload.reply_to_conversation_id ? (
          <div className='text-12px' style={{ color: 'var(--text-secondary)' }}>
            {t('sessionBlock.replyRequested', { defaultValue: '发送方要求回信，可直接回复本会话。' })}
          </div>
        ) : (
          <ViewConversationLink conversationId={payload.from_conversation_id} />
        )
      }
    >
      {payload.body}
    </CardShell>
  );
};

const OutboundCard: React.FC<{ payload: SessionsPayload }> = ({ payload }) => {
  const { t } = useTranslation('conversation');
  const navigate = useNavigate();
  const target = (item: SessionTarget, index: number) => {
    const same = item.workspace !== null && item.workspace === payload.from_workspace;
    return (
      <div key={`${item.id}-${index}`} className='flex items-center gap-6px flex-wrap'>
        <span
          className='text-13px cursor-pointer hover:underline'
          style={{ color: iconColors.secondary }}
          data-testid={VIEW_TESTID}
          onClick={() => navigate(`/conversation/${item.id}`)}
        >
          {item.title}
        </span>
        <WorkspaceBadge same={same} />
      </div>
    );
  };
  return (
    <CardShell
      testid='session-sessions-block'
      title={
        <>
          <Right theme='outline' size='14' fill={iconColors.secondary} />{' '}
          {t('sessionBlock.forwardedTo', {
            defaultValue: '已转发到 {{count}} 个会话',
            count: payload.targets.length,
          })}
        </>
      }
      footer={
        payload.reply_requested ? (
          <div className='text-12px' style={{ color: 'var(--text-secondary)' }}>
            {t('sessionBlock.replyRequestedOutbound', { defaultValue: '已要求对方回信。' })}
          </div>
        ) : undefined
      }
    >
      <div className='flex flex-col gap-4px'>{payload.targets.map(target)}</div>
    </CardShell>
  );
};

/**
 * Styled rendering of a cross-session delivery block. `block.head` (user text
 * before the marker, possibly empty) is NOT rendered here — MessageText keeps
 * rendering it above the card.
 */
const SessionDeliveryBlock: React.FC<{ block: ParsedSessionBlock }> = ({ block }) => {
  if (block.marker === '[[DREAM_SESSION_MESSAGE]]') {
    return <InboundCard payload={block.payload} />;
  }
  return <OutboundCard payload={block.payload} />;
};

export default SessionDeliveryBlock;
