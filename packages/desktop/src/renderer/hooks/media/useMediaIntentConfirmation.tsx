/**
 * Copyright 2026 One Work
 */

import type { MediaIntent } from '@/common/media/detectMediaIntent';
import { Button, Message, Modal } from '@arco-design/web-react';
import { Message as MessageIcon, Picture, VideoTwo } from '@icon-park/react';
import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type MediaModeChoice = Exclude<MediaIntent, null> | 'chat';

/**
 * Confirms a suggested media-mode switch before a keyword can move a chat out
 * of its text model. Choosing chat (including closing the dialog) returns to
 * the same send flow, so the original message reaches the text model exactly
 * once instead of reopening this prompt.
 */
export const useMediaIntentConfirmation = () => {
  const { t } = useTranslation();
  const pendingChoice = useRef<Promise<MediaModeChoice> | null>(null);

  return useCallback(
    (
      intent: Exclude<MediaIntent, null>,
      hasModelFor: (mode: Exclude<MediaIntent, null>) => boolean
    ): Promise<MediaModeChoice> => {
      if (pendingChoice.current) return pendingChoice.current;

      const isVideo = intent === 'video';
      let settled = false;
      let close: (() => void) | undefined;
      let resolveChoice: ((choice: MediaModeChoice) => void) | undefined;
      const choice = new Promise<MediaModeChoice>((resolve) => {
        resolveChoice = resolve;
      });
      pendingChoice.current = choice;

      const settle = (next: MediaModeChoice) => {
        if (settled) return;
        settled = true;
        pendingChoice.current = null;
        if (next !== 'chat') {
          Message.info(
            t(next === 'video' ? 'conversation.mediaIntentSwitchedVideo' : 'conversation.mediaIntentSwitchedImage')
          );
        }
        close?.();
        resolveChoice?.(next);
      };

      const modal = Modal.confirm({
        title: t('conversation.mediaIntentConfirmTitle'),
        icon: null,
        content: (
          <div className='flex gap-12px pt-4px'>
            <div className='flex h-40px w-40px flex-none items-center justify-center rd-12px bg-fill-2 text-primary'>
              {isVideo ? <VideoTwo theme='outline' size='20' /> : <Picture theme='outline' size='20' />}
            </div>
            <div className='pt-2px text-14px leading-22px text-2'>
              {t(isVideo ? 'conversation.mediaIntentConfirmVideo' : 'conversation.mediaIntentConfirmImage')}
            </div>
          </div>
        ),
        footer: (
          <div className='flex w-full flex-wrap items-center gap-8px'>
            <Button type='text' className='h-42px rd-10px px-12px' onClick={() => settle('chat')}>
              <MessageIcon theme='outline' size='16' className='mr-6px' />
              {t('conversation.mediaIntentKeepChat')}
            </Button>
            {hasModelFor('image') ? (
              <Button type='primary' className='h-42px rd-10px px-14px' onClick={() => settle('image')}>
                <Picture theme='outline' size='16' className='mr-6px' />
                {t('conversation.mediaIntentConfirmSwitchImage')}
              </Button>
            ) : null}
            {hasModelFor('video') ? (
              <Button type='outline' className='h-42px rd-10px px-14px' onClick={() => settle('video')}>
                <VideoTwo theme='outline' size='16' className='mr-6px' />
                {t('conversation.mediaIntentConfirmSwitchVideo')}
              </Button>
            ) : null}
          </div>
        ),
        onCancel: () => settle('chat'),
        alignCenter: true,
      });
      close = () => modal.close();
      return choice;
    },
    [t]
  );
};
