/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { isNativeDialogAvailable } from '@/common/adapter/ipcBridge';
import type { TChatConversation } from '@/common/config/storage';
import {
  buildConversationMarkdownTranscript,
  buildMarkdownExportFileName,
  buildMarkdownTranscriptLabels,
  joinFilePath,
} from '@/renderer/utils/chat/conversationExport';
import { loadAllConversationMessagesPaged } from '@/renderer/utils/chat/messagePagination';
import { downloadTextContent } from '@/renderer/utils/file/download';
import { Button, Message, Tooltip } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const parentDirectoryOf = (filePath: string): string | undefined => {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index > 0 ? filePath.slice(0, index) : undefined;
};

/**
 * Chat-header action that exports the current conversation as one Markdown
 * chat record. Desktop asks where to save it; WebUI downloads it, because a
 * save dialog there would name a path on the server, not on the user's machine.
 */
const ConversationExportButton: React.FC<{ conversation: TChatConversation }> = ({ conversation }) => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const messages = await loadAllConversationMessagesPaged(conversation.id);
      const markdown = buildConversationMarkdownTranscript(conversation, messages, buildMarkdownTranscriptLabels(t));
      const fileName = buildMarkdownExportFileName(conversation);

      if (!isNativeDialogAvailable()) {
        downloadTextContent(markdown, fileName, 'text/markdown;charset=utf-8');
        Message.success(t('messages.export.markdownDownloaded'));
        return;
      }

      const baseDirectory =
        conversation.extra?.workspace?.trim() ||
        (await ipcBridge.application.getPath.invoke({ name: 'desktop' }).catch(() => ''));
      const target = await ipcBridge.dialog.showSave.invoke({
        defaultPath: baseDirectory ? joinFilePath(baseDirectory, fileName) : fileName,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!target) return;

      const saved = await ipcBridge.fs.writeFile.invoke({
        path: target,
        data: markdown,
        workspace: parentDirectoryOf(target),
      });
      if (!saved) {
        Message.error(t('messages.export.saveFailed'));
        return;
      }
      Message.success({
        content: (
          <div className='flex items-center gap-8px'>
            <span>{t('messages.export.markdownSaved')}</span>
            <Button
              size='mini'
              type='text'
              onClick={() => {
                void ipcBridge.shell.showItemInFolder.invoke(target);
              }}
            >
              {t('messages.export.showInFolder')}
            </Button>
          </div>
        ),
        duration: 5000,
      });
    } catch (error) {
      console.error('[ConversationExportButton] export failed:', error);
      Message.error(t('messages.export.saveFailed'));
    } finally {
      setExporting(false);
    }
  }, [conversation, t]);

  return (
    <Tooltip content={t('messages.export.headerTooltip')}>
      <Button
        type='text'
        size='small'
        loading={exporting}
        aria-label={t('messages.export.headerTooltip')}
        data-testid='conversation-export-markdown'
        icon={<Download theme='outline' size='16' />}
        onClick={() => {
          void handleExport();
        }}
      />
    </Tooltip>
  );
};

export default ConversationExportButton;
