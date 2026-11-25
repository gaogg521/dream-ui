import { Popover } from '@arco-design/web-react';
import { IconCheck, IconDown, IconList, IconRight } from '@arco-design/web-react/icon';
import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IMessagePlan } from '@/common/chat/chatLib';

export function TaskChecklist({
  entries,
  compact = false,
}: {
  entries: IMessagePlan['content']['entries'];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (!entries.length) return null;
  const completed = entries.filter(({ status }) => status === 'completed').length;
  const canExpand = entries.length > 3;
  const prioritized = ['in_progress', 'pending', 'completed'].flatMap((status) =>
    entries.filter((entry) => entry.status === status)
  );
  const displayed = !canExpand ? entries : prioritized.slice(0, compact || expanded ? 10 : 3);

  const rows = (
    <ul id={listId} className='m-0 max-h-180px list-none overflow-y-auto px-14px pb-10px'>
      {displayed.map(({ content, status }, index) => (
        <li key={index} className='flex min-h-30px items-start gap-9px py-4px text-13px leading-5'>
          <span
            aria-hidden='true'
            className={`mt-3px inline-flex size-14px shrink-0 items-center justify-center rounded-full border border-solid ${
              status === 'completed'
                ? 'border-transparent text-[var(--success)]'
                : status === 'in_progress'
                  ? 'border-[var(--primary)] bg-[var(--primary)]'
                  : 'border-dashed border-[var(--text-secondary)]'
            }`}
          >
            {status === 'completed' && <IconCheck />}
          </span>
          <span
            className={`min-w-0 flex-1 break-words ${status === 'in_progress' ? 'font-medium text-t-primary' : 'text-t-secondary'}`}
          >
            {content}
          </span>
          <span className='shrink-0 text-12px text-t-secondary'>{t(`team.activity.status.${status}`)}</span>
        </li>
      ))}
    </ul>
  );

  if (compact) {
    return (
      <div className='mb-6px flex justify-center'>
        <Popover
          trigger='click'
          position='top'
          popupVisible={expanded}
          onVisibleChange={setExpanded}
          content={<div className='w-336px max-w-[calc(100vw-64px)]'>{rows}</div>}
        >
          <button
            type='button'
            className='inline-flex min-h-30px items-center gap-6px rounded-full border border-solid border-[var(--border-base)] bg-2 px-10px text-12px text-t-primary hover:bg-3'
            aria-expanded={expanded}
          >
            <IconList aria-hidden='true' />
            {t('messages.taskPlan')}
            <span className='text-t-secondary tabular-nums'>
              {completed} / {entries.length}
            </span>
          </button>
        </Popover>
      </div>
    );
  }

  return (
    <div className='my-8px max-w-640px overflow-hidden rounded-12px border border-solid border-[var(--border-base)] bg-2'>
      <button
        type='button'
        className='flex min-h-40px w-full items-center gap-8px px-14px text-start text-13px text-t-primary hover:bg-3'
        aria-expanded={canExpand ? expanded : undefined}
        aria-controls={listId}
        disabled={!canExpand}
        onClick={() => setExpanded(!expanded)}
      >
        <span className='font-semibold'>{t('messages.taskPlan')}</span>
        <span className='text-t-secondary tabular-nums'>
          {completed} / {entries.length}
        </span>
        {canExpand && (
          <span className='ms-auto text-t-secondary' aria-hidden='true'>
            {expanded ? <IconDown /> : <IconRight />}
          </span>
        )}
      </button>
      {rows}
    </div>
  );
}

const MessagePlan: React.FC<{ message: IMessagePlan }> = ({ message }) => (
  <TaskChecklist entries={message.content.entries} />
);

export default MessagePlan;
