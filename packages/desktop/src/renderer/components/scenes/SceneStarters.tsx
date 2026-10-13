/**
 * Copyright 2026 One Work
 */

/**
 * The example openers of the scene a conversation was started from, as chips
 * above the input.
 *
 * A scene that asks first knows how people tend to start ("make me a website").
 * Those sentences were only a tooltip; here they are one click away: a chip puts
 * its sentence into the input — it never sends anything on the person's behalf —
 * and they go away once the conversation has begun, since they are for starting.
 * The starters ride on the conversation (`extra.scene_starters`), written when
 * the scene was opened, so they survive a reload.
 */

import { ipcBridge } from '@/common';
import { emitter } from '@/renderer/utils/emitter';
import { useMessageList } from '@renderer/pages/conversation/Messages/hooks';
import { Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

const SceneStarters: React.FC<{ conversationId: string; hasInput: boolean }> = ({ conversationId, hasInput }) => {
  const { t } = useTranslation();
  const messages = useMessageList();
  const { data: conversation } = useSWR(conversationId ? ['scene-starters', conversationId] : null, () =>
    ipcBridge.conversation.get.invoke({ id: conversationId })
  );
  const starters = (conversation?.extra as { scene_starters?: unknown } | undefined)?.scene_starters;
  const list = Array.isArray(starters)
    ? starters.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  // They are for starting: not once anything has been said, nor over a draft.
  if (list.length === 0 || messages.length > 0 || hasInput) return null;

  return (
    <div className='flex flex-wrap items-center gap-6px px-4px py-4px' data-testid='scene-starters'>
      <span className='text-12px text-t-tertiary'>{t('common.scenes.tryOpening')}</span>
      {list.map((starter) => (
        <Button
          key={starter}
          size='mini'
          shape='round'
          onClick={() => emitter.emit('sendbox.fill', starter)}
          data-testid='scene-starter'
        >
          {starter}
        </Button>
      ))}
    </div>
  );
};

export default SceneStarters;
