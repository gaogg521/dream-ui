/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import { Message, Modal, Spin, Tag } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type SharedRow = { conversationId: string; ownerUserId: string; name: string; scope: string; sharedAt: number };
type SharedDetail = {
  share: { conversationId: string; ownerUserId: string; name: string; scope: string; sharedAt: number };
  messages: { id: string; type: string; content: string; position?: string; createdAt?: number }[];
  hasMoreBefore: boolean;
};

const SnapshotMessageRow: React.FC<{ type: string; content: string; position?: string }> = ({
  type,
  content,
  position,
}) => {
  let text = '';
  if (type === 'text') {
    try {
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed === 'string') text = parsed;
      else if (parsed && typeof parsed === 'object' && typeof (parsed as { content?: unknown }).content === 'string') {
        text = (parsed as { content: string }).content;
      }
    } catch {
      text = content;
    }
  }
  const isUser = position === 'right';
  return (
    <div className={text ? 'flex' : 'hidden'} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div
        className='max-w-[85%] px-8px py-4px rd-6px text-12px whitespace-pre-wrap [overflow-wrap:anywhere]'
        style={{
          backgroundColor: isUser ? 'var(--color-fill-2)' : 'var(--color-fill-3)',
          color: 'var(--color-text-1)',
        }}
      >
        {text || `(${type})`}
      </div>
    </div>
  );
};

/**
 * The member-side "shared with me" inbox — the consumption half of P2-2
 * conversation sharing. Lists every share row this member may read and opens
 * a read-only snapshot viewer. The backend routes existed first; this is the
 * UI that was missing.
 */
const SharedInboxModal: React.FC<{ visible: boolean; onCancel: () => void }> = ({ visible, onCancel }) => {
  const { t } = useTranslation('conversation');
  const [rows, setRows] = useState<SharedRow[] | null>(null);
  const [detail, setDetail] = useState<SharedDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRows(null);
      setDetail(null);
      return;
    }
    let cancelled = false;
    void ipcBridge.onePlatform.sharedWithMe
      .invoke()
      .then((list) => {
        if (!cancelled) setRows(list ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          Message.error(
            friendlyEnterpriseError(error, t) ||
              t('conversation.sharedInbox.loadFailed', { defaultValue: '加载共享会话失败' })
          );
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const openDetail = (conversationId: string) => {
    setLoadingDetail(true);
    void ipcBridge.onePlatform.readSharedConversation
      .invoke({ conversationId })
      .then((result) => setDetail(result))
      .catch((error) =>
        Message.error(
          friendlyEnterpriseError(error, t) ||
            t('conversation.sharedInbox.loadFailed', { defaultValue: '加载共享会话失败' })
        )
      )
      .finally(() => setLoadingDetail(false));
  };

  return (
    <Modal
      title={
        detail
          ? t('conversation.sharedInbox.viewTitle', { defaultValue: '共享会话：{{name}}', name: detail.share.name })
          : t('conversation.sharedInbox.title', { defaultValue: '企业共享会话' })
      }
      visible={visible}
      footer={null}
      onCancel={() => {
        if (detail) {
          setDetail(null);
        } else {
          onCancel();
        }
      }}
      style={{ borderRadius: '12px', width: 560 }}
      alignCenter
      getPopupContainer={() => document.body}
    >
      {detail ? (
        <div className='flex flex-col gap-6px max-h-[60vh] overflow-y-auto' data-testid='shared-conversation-detail'>
          {detail.hasMoreBefore && (
            <div className='text-12px text-t-secondary'>
              {t('conversation.sharedInbox.truncated', { defaultValue: '仅显示最近一页消息' })}
            </div>
          )}
          {detail.messages.map((message) => (
            <SnapshotMessageRow
              key={message.id}
              type={message.type}
              content={message.content}
              position={message.position}
            />
          ))}
        </div>
      ) : loadingDetail ? (
        <div className='flex justify-center py-24px'>
          <Spin />
        </div>
      ) : (
        <div className='flex flex-col gap-6px max-h-[60vh] overflow-y-auto' data-testid='shared-conversation-inbox'>
          {(rows ?? []).length === 0 && (
            <div className='text-13px text-t-secondary py-12px text-center'>
              {t('conversation.sharedInbox.empty', { defaultValue: '还没有人分享会话' })}
            </div>
          )}
          {(rows ?? []).map((row) => (
            <div
              key={row.conversationId}
              className='flex items-center justify-between px-10px py-8px rd-8px cursor-pointer hover:bg-3 transition-colors'
              data-testid={`shared-inbox-row-${row.conversationId}`}
              onClick={() => openDetail(row.conversationId)}
            >
              <div className='min-w-0'>
                <div
                  className='text-13px overflow-hidden text-ellipsis whitespace-nowrap'
                  style={{ color: 'var(--color-text-1)' }}
                >
                  {row.name || row.conversationId}
                </div>
                <div className='text-11px text-t-secondary'>
                  {new Date(row.sharedAt).toLocaleString()} · {row.ownerUserId.slice(0, 8)}
                </div>
              </div>
              <Tag size='small' color={row.scope === 'enterprise' ? 'purple' : 'cyan'}>
                {row.scope === 'enterprise'
                  ? t('conversation.sharedInbox.scopeEnterprise', { defaultValue: '全企业' })
                  : t('conversation.sharedInbox.scopeTenant', { defaultValue: '本组' })}
              </Tag>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};

export default SharedInboxModal;
