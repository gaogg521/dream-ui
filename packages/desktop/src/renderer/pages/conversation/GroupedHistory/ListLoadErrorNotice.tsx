/**
 * Copyright 2026 One Work
 */

import { Button } from '@arco-design/web-react';
import { Attention } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationListLoadError } from './hooks/useConversationListSync';

/** Backend code for "the local database file is damaged": retrying cannot fix it. */
export const DATABASE_CORRUPT_CODE = 'DATABASE_CORRUPT';

type ListLoadErrorNoticeProps = {
  error: ConversationListLoadError;
  onRetry: () => void;
};

/**
 * Says why the sidebar has no (or an out-of-date) history, instead of letting a failed
 * load look like "no conversations yet". A damaged data file gets its own wording and
 * no retry button, since asking again cannot help and the person should not go
 * deleting things.
 */
const ListLoadErrorNotice: React.FC<ListLoadErrorNoticeProps> = ({ error, onRetry }) => {
  const { t } = useTranslation();
  const damaged = error.code === DATABASE_CORRUPT_CODE;

  return (
    <div
      role='alert'
      data-testid='conversation-list-load-error'
      className='flex flex-col gap-6px mx-8px my-8px px-10px py-8px rd-6px text-12px lh-18px bg-fill-2 text-t-secondary'
    >
      <div className='flex items-center gap-6px text-t-primary font-medium'>
        <Attention theme='outline' size={14} className='shrink-0' />
        <span>{damaged ? t('conversation.history.databaseCorrupt') : t('conversation.history.loadFailed')}</span>
      </div>
      {damaged && <span>{t('conversation.history.databaseCorruptHint')}</span>}
      {!damaged && (
        <div>
          <Button size='mini' onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default ListLoadErrorNotice;
