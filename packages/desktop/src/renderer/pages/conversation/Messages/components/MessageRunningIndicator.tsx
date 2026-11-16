/**
 * Copyright 2026 One Work
 */

import { Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getConversationTurnStart } from '@/renderer/pages/conversation/utils/conversationTurnClock';

type MessageRunningIndicatorProps = {
  conversationId: string;
  rowWidthClass: string;
};

/**
 * The "the assistant is still working" mark that sits at the end of the transcript:
 * a spinner, "working" and the seconds elapsed this turn, inline with the messages
 * rather than in a bar above the input box. That bar now only carries messages with
 * real content (compacting, waiting for approval, a failed start with a retry button).
 */
const MessageRunningIndicator: React.FC<MessageRunningIndicatorProps> = ({ conversationId, rowWidthClass }) => {
  const { t } = useTranslation();
  // Fallback origin for a turn the clock never recorded (e.g. work resumed after a reload).
  const [fallbackStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Re-read the clock on every tick: the origin may be recorded a moment after this mounts.
  const startedAt = getConversationTurnStart(conversationId) ?? fallbackStart;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const sUnit = t('common.unit.second_short', { defaultValue: 's' });
  const mUnit = t('common.unit.minute_short', { defaultValue: 'm' });
  const elapsed = seconds < 60 ? `${seconds}${sUnit}` : `${Math.floor(seconds / 60)}${mUnit} ${seconds % 60}${sUnit}`;

  return (
    <div
      data-testid='message-running-indicator'
      role='status'
      className={`${rowWidthClass} min-w-0 message-item px-8px m-t-10px flex items-center gap-8px text-13px text-t-tertiary`}
    >
      <Spin size={14} />
      <span className='text-t-secondary'>{t('conversation.process.working')}</span>
      <span className='opacity-70'>{elapsed}</span>
    </div>
  );
};

export default MessageRunningIndicator;
