/**
 * Copyright 2026 One Work
 */

import type { MediaIntent } from '@/common/media/detectMediaIntent';
import { Button, Message, Modal } from '@arco-design/web-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Confirms a suggested media-mode switch before a keyword can move a chat out
 * of its text model. Closing or cancelling the dialog deliberately does
 * nothing, leaving the composer in chat mode.
 */
export const useMediaIntentConfirmation = () => {
  const { t } = useTranslation();

  return useCallback(
    (
      intent: Exclude<MediaIntent, null>,
      hasModelFor: (mode: 'image' | 'video') => boolean,
      onConfirm: (mode: 'image' | 'video') => void
    ) => {
      const isVideo = intent === 'video';
      let close: (() => void) | undefined;
      const chooseMode = (mode: 'image' | 'video') => {
        onConfirm(mode);
        Message.info(
          t(mode === 'video' ? 'conversation.mediaIntentSwitchedVideo' : 'conversation.mediaIntentSwitchedImage')
        );
        close?.();
      };

      const modal = Modal.confirm({
        title: t('conversation.mediaIntentConfirmTitle'),
        content: t(isVideo ? 'conversation.mediaIntentConfirmVideo' : 'conversation.mediaIntentConfirmImage'),
        footer: (
          <div className='flex justify-end gap-8px'>
            <Button onClick={() => close?.()}>{t('conversation.mediaIntentKeepChat')}</Button>
            {hasModelFor('image') ? (
              <Button type='primary' onClick={() => chooseMode('image')}>
                {t('conversation.mediaIntentConfirmSwitchImage')}
              </Button>
            ) : null}
            {hasModelFor('video') ? (
              <Button type='primary' onClick={() => chooseMode('video')}>
                {t('conversation.mediaIntentConfirmSwitchVideo')}
              </Button>
            ) : null}
          </div>
        ),
        alignCenter: true,
      });
      close = () => modal.close();
    },
    [t]
  );
};
