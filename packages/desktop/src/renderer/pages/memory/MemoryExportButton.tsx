/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { isNativeDialogAvailable, memory as memoryIpc } from '@/common/adapter/ipcBridge';
import { joinFilePath } from '@/renderer/utils/chat/conversationExport';
import {
  downloadDecision,
  prepareExport,
  writeEncryptedPackage,
} from '@/renderer/utils/enterprise/secureExport/gateway';
import {
  buildMemoryExportMarkdown,
  memoryExportFileName,
  type MemoryExportSection,
} from '@/renderer/utils/memory/memoryExport';
import { Button, Message } from '@arco-design/web-react';
import { Download } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

const parentDirectoryOf = (filePath: string): string | undefined => {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return index > 0 ? filePath.slice(0, index) : undefined;
};

/** One source failing (an agent that was never installed, say) must not sink the rest of the export. */
const settle = async <T,>(read: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await read();
  } catch {
    return fallback;
  }
};

/**
 * Writes everything the Memory page shows into one Markdown file. Desktop asks where to save it;
 * WebUI downloads it, because a save dialog there would name a path on the server rather than the
 * person's own machine. Goes through the export-protection gateway like every other export.
 */
const MemoryExportButton: React.FC = () => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const collect = useCallback(async (): Promise<MemoryExportSection[]> => {
    const sections: MemoryExportSection[] = [];

    const overview = await settle(() => memoryIpc.engineList.invoke(), null);
    for (const group of overview?.groups ?? []) {
      sections.push({
        title: `${t('memory.tabEngine')} · ${group.label}`,
        location: group.dir,
        files: group.files.map((file) => ({
          name: file.name,
          filename: file.filename,
          content: file.content,
          updatedAt: file.updatedAt,
        })),
      });
    }

    const claudeEntries = await settle(() => memoryIpc.list.invoke(), []);
    sections.push({
      title: t('memory.export.claudeAuto'),
      files: (claudeEntries ?? []).map((entry) => ({
        name: entry.name,
        filename: entry.filename,
        content: entry.content,
        updatedAt: entry.updatedAt,
      })),
    });

    const agents = await settle(() => memoryIpc.agentList.invoke(), []);
    for (const agent of agents ?? []) {
      if (!agent.used || !agent.globalExists) continue;
      const file = await settle(() => memoryIpc.agentRead.invoke({ agent: agent.key, scope: 'global' }), null);
      if (!file?.exists || !file.content.trim()) continue;
      sections.push({
        title: agent.label,
        location: file.path,
        files: [{ name: agent.label, filename: file.path.split(/[\\/]/).pop() ?? agent.label, content: file.content }],
      });
    }
    return sections;
  }, [t]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const markdown = buildMemoryExportMarkdown(await collect(), {
        title: t('memory.export.title'),
        exportedAt: t('memory.export.exportedAt'),
        updatedAt: t('memory.export.updatedAt'),
        empty: t('memory.export.empty'),
      });
      const fileName = memoryExportFileName();

      const decision = await prepareExport({
        kind: 'preview_download',
        files: [{ name: fileName, text: markdown }],
        suggestedName: fileName,
        t: (key, values) => String(t(key as never, values as never)),
      });
      if (decision.mode === 'cancelled') return;
      if (decision.mode === 'blocked') {
        Message.error({ content: decision.message, duration: 6000 });
        return;
      }

      if (!isNativeDialogAvailable()) {
        downloadDecision(decision, 'text/markdown;charset=utf-8');
        Message.success(t('memory.export.downloaded'));
        return;
      }

      const encrypted = decision.mode === 'encrypted';
      const targetName = encrypted ? decision.fileName : fileName;
      const desktop = await ipcBridge.application.getPath.invoke({ name: 'desktop' }).catch(() => '');
      const target = await ipcBridge.dialog.showSave.invoke({
        defaultPath: desktop ? joinFilePath(desktop, targetName) : targetName,
        filters: encrypted
          ? [{ name: t('messages.secureExport.fileTypeName'), extensions: ['owenc'] }]
          : [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!target) return;

      const saved =
        decision.mode === 'encrypted'
          ? await writeEncryptedPackage(target, decision.bytes)
          : await ipcBridge.fs.writeFile.invoke({
              path: target,
              data: decision.files[0].text ?? markdown,
              workspace: parentDirectoryOf(target),
            });
      if (!saved) {
        Message.error(t('memory.export.failed'));
        return;
      }
      decision.report();
      Message.success({
        content: (
          <div className='flex items-center gap-8px'>
            <span>{t('memory.export.saved')}</span>
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
      console.error('[MemoryExportButton] export failed:', error);
      Message.error(t('memory.export.failed'));
    } finally {
      setExporting(false);
    }
  }, [collect, t]);

  return (
    <Button
      size='small'
      loading={exporting}
      icon={<Download theme='outline' size='14' />}
      data-testid='memory-export'
      onClick={() => {
        void handleExport();
      }}
    >
      {t('memory.export.button')}
    </Button>
  );
};

export default MemoryExportButton;
