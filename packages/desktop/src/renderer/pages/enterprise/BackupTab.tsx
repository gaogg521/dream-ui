/**
 * Enterprise configuration backup / restore (P1-1).
 *
 * Procurement due diligence always asks how the deployment is backed up and
 * how it is recovered. This exports the org-side configuration as a single
 * versioned JSON file and restores it.
 *
 * Two things are deliberately NOT in the bundle, and the UI says so rather than
 * letting an operator find out later:
 *  - user conversations and messages (large, and personal rather than org data)
 *  - credentials (a downloaded file is not a safe place for IdP secrets), which
 *    therefore have to be re-entered after a restore
 *
 * Lives directly under `pages/enterprise/` rather than in `components/`: that
 * directory is already over the per-directory child limit, so adding to it
 * would make an existing violation worse.
 */

import React, { useCallback, useState } from 'react';
import { Button, Card, Message, Modal, Tag, Upload } from '@arco-design/web-react';
import type { UploadItem } from '@arco-design/web-react/es/Upload';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { BackupBundle, BackupImportReport } from '@/common/types/org/orgTypes';

/** `2026-07-29T21-05-33` — filesystem-safe, sorts chronologically. */
const fileStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-');

const BackupTab: React.FC = () => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastExportAt, setLastExportAt] = useState<number | null>(null);
  const [report, setReport] = useState<BackupImportReport | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const bundle = await ipcBridge.oneAdmin.exportBackup.invoke();
      const json = JSON.stringify(bundle, null, 2);
      // Download via an object URL: the renderer has no Node fs access, and this
      // keeps the file entirely in the user's own download flow.
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `one-work-enterprise-backup-${fileStamp(bundle.exportedAt || Date.now())}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setLastExportAt(bundle.exportedAt || Date.now());
      Message.success(t('common.enterprise.backupExported'));
    } catch (e) {
      Message.error(t('common.enterprise.backupExportFailed') + ': ' + String(e));
    } finally {
      setExporting(false);
    }
  }, [t]);

  const runImport = useCallback(
    async (bundle: BackupBundle) => {
      setImporting(true);
      try {
        const result = await ipcBridge.oneAdmin.importBackup.invoke(bundle);
        setReport(result);
        Message.success(t('common.enterprise.backupImported'));
      } catch (e) {
        Message.error(t('common.enterprise.backupImportFailed') + ': ' + String(e));
      } finally {
        setImporting(false);
      }
    },
    [t]
  );

  /**
   * Parse the picked file, then confirm before writing. A restore overwrites
   * live org rows, so it must never happen on a single mis-click.
   */
  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        let bundle: BackupBundle;
        try {
          bundle = JSON.parse(String(reader.result)) as BackupBundle;
        } catch {
          Message.error(t('common.enterprise.backupParseFailed'));
          return;
        }
        if (typeof bundle?.version !== 'number' || typeof bundle?.tables !== 'object') {
          Message.error(t('common.enterprise.backupNotABundle'));
          return;
        }
        Modal.confirm({
          title: t('common.enterprise.backupImportTitle'),
          content: t('common.enterprise.backupImportWarning', {
            tables: Object.keys(bundle.tables).length,
          }),
          okText: t('common.enterprise.backupImportConfirm'),
          okButtonProps: { status: 'danger' },
          onOk: () => void runImport(bundle),
        });
      };
      reader.onerror = () => Message.error(t('common.enterprise.backupReadFailed'));
      reader.readAsText(file);
    },
    [runImport, t]
  );

  return (
    <div className='flex flex-col gap-16px'>
      <Card title={t('common.enterprise.backupExportTitle')}>
        <div className='flex flex-col gap-12px'>
          <div className='text-13px text-t-secondary'>{t('common.enterprise.backupExportHint')}</div>
          <div className='text-12px text-t-tertiary'>{t('common.enterprise.backupScopeNote')}</div>
          <div className='flex items-center gap-12px'>
            <Button type='primary' loading={exporting} onClick={() => void handleExport()}>
              {t('common.enterprise.backupExportAction')}
            </Button>
            {lastExportAt && (
              <span className='text-12px text-t-tertiary'>
                {t('common.enterprise.backupLastExport', { time: new Date(lastExportAt).toLocaleString() })}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card title={t('common.enterprise.backupImportCardTitle')}>
        <div className='flex flex-col gap-12px'>
          <div className='text-13px text-t-secondary'>{t('common.enterprise.backupImportHint')}</div>
          <Upload
            accept='application/json,.json'
            showUploadList={false}
            autoUpload={false}
            onChange={(_: UploadItem[], current: UploadItem) => {
              const file = current?.originFile;
              if (file) handleFile(file);
            }}
          >
            <Button loading={importing}>{t('common.enterprise.backupPickFile')}</Button>
          </Upload>

          {report && (
            <div className='flex flex-col gap-6px text-13px'>
              <div>
                {t('common.enterprise.backupImportResult', {
                  tables: report.tablesApplied,
                  rows: report.rowsApplied,
                })}
              </div>
              {report.tablesSkipped.length > 0 && (
                <div className='flex flex-wrap items-center gap-6px'>
                  <span className='text-12px text-t-tertiary'>{t('common.enterprise.backupSkippedTables')}</span>
                  {report.tablesSkipped.map((table) => (
                    <Tag key={table} size='small' color='orange'>
                      {table}
                    </Tag>
                  ))}
                </div>
              )}
              <div className='text-12px' style={{ color: 'var(--color-warning-6)' }}>
                {t('common.enterprise.backupReenterSecrets')}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default BackupTab;
