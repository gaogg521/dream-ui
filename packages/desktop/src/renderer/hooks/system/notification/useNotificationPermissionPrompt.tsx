/**
 * Copyright 2026 One Work
 */

import { Button, Message } from '@arco-design/web-react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isElectronDesktop } from '@/renderer/utils/platform';

const DISMISSED_KEY = 'one-work-notification-prompt-dismissed';

const readDismissed = (): boolean => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
};

const writeDismissed = (): void => {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Private mode / blocked storage: the prompt may reappear next visit, which is harmless.
  }
};

/**
 * WebUI-only (phone browsers over the remote-access tunnel): offer once to turn on
 * browser notifications. The grant control used to live only in Settings → System,
 * so on a phone nobody found it and "task finished" notifications never appeared.
 * A permission request needs a user gesture, hence a button rather than asking on load.
 * No-op in Electron, in insecure contexts, once decided, or after dismissal.
 */
export const useNotificationPermissionPrompt = (): void => {
  const { t } = useTranslation();

  useEffect(() => {
    if (isElectronDesktop()) return;
    if (typeof window === 'undefined' || !('Notification' in window) || !window.isSecureContext) return;
    if (Notification.permission !== 'default' || readDismissed()) return;

    let toastId: string | undefined;
    const timer = window.setTimeout(() => {
      toastId = `notification-permission-${Date.now()}`;
      Message.info({
        id: toastId,
        duration: 0,
        closable: true,
        onClose: writeDismissed,
        content: (
          <span className='inline-flex items-center gap-8px flex-wrap'>
            <span>{t('settings.browserNotification.prompt')}</span>
            <Button
              type='primary'
              size='mini'
              onClick={() => {
                writeDismissed();
                if (toastId) Message.clear();
                void Notification.requestPermission();
              }}
            >
              {t('settings.browserNotification.enable')}
            </Button>
          </span>
        ),
      });
    }, 4000);

    return () => window.clearTimeout(timer);
  }, [t]);
};
