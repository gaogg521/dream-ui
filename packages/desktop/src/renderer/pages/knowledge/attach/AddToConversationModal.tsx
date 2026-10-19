/**
 * Copyright 2026 One Work
 */

import type { RagDocumentEntry } from '@/common/types/devops/devopsTypes';
import { useConversationHistoryContextSafe } from '@/renderer/hooks/context/ConversationHistoryContext';
import { requestConversationSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxDraft';
import { Message, Modal, Spin } from '@arco-design/web-react';
import { Plus, Right } from '@icon-park/react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LibraryFileIcon from '../shared/LibraryFileIcon';
import { uploadLibraryDocumentPaths } from './libraryAttachments';

/** Recent conversations offered next to "new conversation". */
const RECENT_CONVERSATION_LIMIT = 8;

type AddToConversationModalProps = {
  /** The documents to attach; the dialog is shown while this is set. */
  documents: RagDocumentEntry[] | null;
  onClose: () => void;
};

const Row: React.FC<{
  icon: React.ReactNode;
  title: string;
  hint?: string;
  disabled: boolean;
  onClick: () => void;
}> = ({ icon, title, hint, disabled, onClick }) => (
  <div
    role='button'
    tabIndex={disabled ? -1 : 0}
    aria-disabled={disabled}
    className={`flex items-center gap-10px rounded-8px px-10px py-9px transition-colors ${
      disabled ? 'cursor-default opacity-60' : 'cursor-pointer hover:bg-fill-2'
    }`}
    onClick={disabled ? undefined : onClick}
    onKeyDown={(event) => {
      if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onClick();
      }
    }}
  >
    <span className='inline-flex h-20px w-20px flex-shrink-0 items-center justify-center text-t-secondary'>{icon}</span>
    <span className='min-w-0 flex-1 truncate text-14px text-t-primary' title={title}>
      {title}
    </span>
    {hint && <span className='flex-shrink-0 text-12px text-t-tertiary'>{hint}</span>}
    <Right theme='outline' size={12} strokeWidth={3} className='flex-shrink-0 text-t-tertiary' />
  </div>
);

/**
 * "Add to conversation" for library documents: start a new conversation with
 * them attached, or drop them into one of the recent conversations.
 */
const AddToConversationModal: React.FC<AddToConversationModalProps> = ({ documents, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const history = useConversationHistoryContextSafe();
  const [busy, setBusy] = useState(false);

  const recent = useMemo(
    () =>
      (history?.conversations ?? [])
        .toSorted((a, b) => b.modified_at - a.modified_at)
        .slice(0, RECENT_CONVERSATION_LIMIT),
    [history?.conversations]
  );

  const run = async (conversationId?: string) => {
    if (!documents?.length) return;
    setBusy(true);
    try {
      const paths = await uploadLibraryDocumentPaths(documents, conversationId);
      if (paths.length === 0) return;
      if (conversationId) {
        requestConversationSendBoxFiles(conversationId, paths);
        void navigate(`/conversation/${conversationId}`);
      } else {
        void navigate('/guid', { state: { attachFiles: paths } });
      }
      Message.success(t('common.knowledgeLibrary.addedToConversation', { count: paths.length }));
      onClose();
    } catch (error) {
      Message.error(`${t('common.fileAttach.failed')}: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const first = documents?.[0];
  return (
    <Modal
      title={t('common.knowledgeLibrary.addToConversation')}
      visible={Boolean(documents)}
      onCancel={busy ? undefined : onClose}
      footer={null}
      unmountOnExit
      style={{ width: 460, maxWidth: 'calc(100vw - 32px)' }}
    >
      <Spin loading={busy} className='block'>
        {first && (
          <div className='mb-12px flex items-center gap-8px text-13px text-t-secondary'>
            <LibraryFileIcon title={first.title} mimeType={first.mimeType} filePath={first.filePath} size={16} />
            <span className='min-w-0 flex-1 truncate'>{first.title}</span>
          </div>
        )}
        <Row
          icon={<Plus theme='outline' size={16} />}
          title={t('common.knowledgeLibrary.newConversation')}
          disabled={busy}
          onClick={() => void run()}
        />
        {recent.length > 0 && (
          <div className='mb-4px mt-8px px-10px text-12px text-t-tertiary'>
            {t('common.knowledgeLibrary.recentConversations')}
          </div>
        )}
        <div className='max-h-300px overflow-y-auto'>
          {recent.map((conversation) => (
            <Row
              key={conversation.id}
              icon={<span className='h-6px w-6px rounded-full bg-fill-4' />}
              title={conversation.name || conversation.id}
              disabled={busy}
              onClick={() => void run(conversation.id)}
            />
          ))}
        </div>
      </Spin>
    </Modal>
  );
};

export default AddToConversationModal;
