/**
 * Copyright 2026 One Work
 */

/**
 * Offers to tidy the assistant's memory when it has grown long.
 *
 * Only the newest memories reach the assistant's prompt and older ones are found by keyword, so a
 * long memory costs little while it runs — but it gets slow to scan and hard to read. The tidy
 * folds old memories into a few files without changing a word, after taking a backup, and can be
 * undone from the memory page. It is never done without the person saying yes, and "later" is
 * respected for a week.
 */

import { useEffect } from 'react';
import { Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { isNativeDialogAvailable, memory as memoryIpc } from '@/common/adapter/ipcBridge';

const SHARED_GROUP = '_shared';
const SNOOZE_KEY = 'memory.tidy.snoozeUntil';
const FIRST_CHECK_DELAY_MS = 20_000;
const RECHECK_MS = 6 * 60 * 60 * 1000;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

const readSnooze = (): number => {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
};

const writeSnooze = (until: number): void => {
  try {
    localStorage.setItem(SNOOZE_KEY, String(until));
  } catch {
    /* a private window or blocked storage: the prompt may reappear, which is harmless */
  }
};

export function useMemoryTidyPrompt(): void {
  const { t } = useTranslation();

  useEffect(() => {
    // The memory files live on this computer; a WebUI has no main process to answer.
    if (!isNativeDialogAvailable()) return;
    let showing = false;
    let disposed = false;

    const check = async () => {
      if (showing || disposed || Date.now() < readSnooze()) return;
      try {
        const status = await memoryIpc.engineCompactionStatus.invoke({ groupId: SHARED_GROUP });
        if (!status.suggested || disposed) return;
        showing = true;
        Modal.confirm({
          title: t('memory.tidy.title'),
          content: t('memory.tidy.content', { total: status.total, mergeable: status.mergeable }),
          okText: t('memory.tidy.agree'),
          cancelText: t('memory.tidy.later'),
          okButtonProps: { status: 'success' },
          onOk: async () => {
            try {
              const result = await memoryIpc.engineCompact.invoke({ groupId: SHARED_GROUP });
              Message.success(t('memory.tidy.done', result));
            } catch {
              Message.error(t('memory.tidy.failed'));
            } finally {
              showing = false;
            }
          },
          onCancel: () => {
            writeSnooze(Date.now() + SNOOZE_MS);
            showing = false;
          },
        });
      } catch {
        // No answer from the main process: try again at the next check.
      }
    };

    const first = setTimeout(() => void check(), FIRST_CHECK_DELAY_MS);
    const every = setInterval(() => void check(), RECHECK_MS);
    return () => {
      disposed = true;
      clearTimeout(first);
      clearInterval(every);
    };
  }, [t]);
}
