/** Copyright 2026 One Work */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { memory as memoryIpc, type EngineCompactionStatus } from '@/common/adapter/ipcBridge';

type Props = {
  groupId?: string;
  claude?: boolean;
  label: string;
  version?: number;
  onChanged: () => void | Promise<void>;
};
/** The same explicit consent, backup and undo flow for each supported memory group. */
export default function MemoryTidyActions({
  groupId,
  claude = false,
  label,
  version = 0,
  onChanged,
}: Props): React.ReactElement | null {
  const { t } = useTranslation();
  const [state, setState] = useState<(EngineCompactionStatus & { groupId?: string; label?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (): Promise<void> => {
    try {
      setState(
        claude
          ? await memoryIpc.claudeCompactionStatus.invoke()
          : await memoryIpc.engineCompactionStatus.invoke({ groupId: groupId! })
      );
    } catch {
      setState(null);
    }
  }, [claude, groupId]);
  useEffect(() => {
    void load();
  }, [load, version]);
  const run = (undo: boolean): void => {
    Modal.confirm({
      title: `${state?.label ?? label} · ${t(undo ? 'memory.tidy.undoTitle' : 'memory.tidy.title')}`,
      content: undo
        ? t('memory.tidy.undoContent')
        : t('memory.tidy.content', { total: state?.total ?? 0, mergeable: state?.mergeable ?? 0 }),
      okText: t(undo ? 'memory.tidy.undo' : 'memory.tidy.agree'),
      cancelText: t('common.cancel'),
      okButtonProps: { status: 'success' },
      onOk: async () => {
        setBusy(true);
        try {
          if (undo) {
            const result = claude
              ? await memoryIpc.claudeUndoCompaction.invoke({ groupId: state!.groupId! })
              : await memoryIpc.engineUndoCompaction.invoke({ groupId: groupId! });
            if (!result.restored) throw new Error('The backup is no longer available');
            Message.success(t('memory.tidy.undone'));
          } else {
            const result = claude
              ? await memoryIpc.claudeCompact.invoke({ groupId: state!.groupId! })
              : await memoryIpc.engineCompact.invoke({ groupId: groupId! });
            Message.success(t('memory.tidy.done', result));
          }
          await load();
          await onChanged();
        } catch {
          Message.error(t('memory.tidy.failed'));
        } finally {
          setBusy(false);
        }
      },
    });
  };
  if (!state) return null;
  return (
    <span className='inline-flex gap-8px' onClick={(event) => event.stopPropagation()}>
      {state.mergeable > 0 && (
        <Button size='mini' status='success' disabled={busy} onClick={() => run(false)}>
          {t('memory.tidy.button')}
        </Button>
      )}
      {state.backup && (
        <Button size='mini' disabled={busy} onClick={() => run(true)}>
          {t('memory.tidy.undo')}
        </Button>
      )}
    </span>
  );
}
