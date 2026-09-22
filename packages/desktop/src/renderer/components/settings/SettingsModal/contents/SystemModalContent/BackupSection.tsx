/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { httpRequest } from '@/common/adapter/httpBridge';
import { dialog, isNativeDialogAvailable } from '@/common/adapter/ipcBridge';
import { Alert, Button, Checkbox, Message, Modal } from '@arco-design/web-react';
import { FolderOpen } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { iconColors } from '@/renderer/styles/colors';
import PassphrasePrompt from './PassphrasePrompt';

/**
 * 备份与恢复 / Backup and restore.
 *
 * 换新机器以前只能从零开始：唯一的导出是单个会话的文字存档，会话、模型配置、技能
 * 都带不走。这一节是那个缺口的出入口。
 *
 * Moving to a new machine used to mean starting from zero — the only export was a
 * per-conversation transcript, and nothing carried conversations, providers or
 * skills across. This section is that missing door.
 *
 * 只在桌面端显示：备份写的是**后端所在机器**的路径，WebUI 模式下后端可能在另一台
 * 机器上，"保存到我的电脑"这个语义根本不成立。
 *
 * Desktop only: a backup names a path on the machine running the backend, and in
 * WebUI that is a server the user cannot browse, so "save to my computer" is not
 * a thing that can be honoured there.
 */

type BackupScope = {
  conversations: boolean;
  attachments: boolean;
  providers: boolean;
  skills: boolean;
  appSettings: boolean;
};

/**
 * How the archive is sealed. Absent on an archive written before backups were
 * encrypted — those still restore, and asking for a passphrase they do not have
 * would be asking for something that cannot exist.
 */
type ArchiveEncryption = {
  cipher: string;
  kdf: string;
};

type BackupManifest = {
  formatVersion: number;
  exportedAt: number;
  appVersion: string;
  scope: BackupScope;
  totalBytes: number;
  containsCredentials: boolean;
  encryption?: ArchiveEncryption;
};

type CreateBackupResponse = {
  path: string;
  archiveBytes: number;
  manifest: BackupManifest;
};

type RestoreBackupResponse = {
  rowsByTable: Record<string, number>;
  filesRestored: number;
  /**
   * Rows the backend dropped because what they pointed at was not part of this
   * restore — restoring conversations without app settings leaves the assistant
   * snapshots referring to definitions that never arrived. Reported so a
   * partial restore is not presented as a lossless one.
   */
  orphansRemoved?: Record<string, number>;
};

const SCOPE_KEYS = ['conversations', 'attachments', 'providers', 'skills', 'appSettings'] as const;

/**
 * Everything a new machine needs, minus the one category that can take half an
 * hour.
 *
 * `attachments` is off by default because it is not what "carry my setup
 * across" means: the conversations, messages, providers and skills all live in
 * the catalog, and this category is the files agents read and wrote while
 * working. Measured on a developer install, it was 13,304 files / 228 MB and
 * roughly thirty minutes to compress — with the rest of the backup finishing in
 * seconds. Defaulting it on made the common case look like the app had hung.
 */
const DEFAULT_SCOPE: BackupScope = {
  conversations: true,
  attachments: false,
  providers: true,
  skills: true,
  appSettings: true,
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
};

const defaultFileName = (): string => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `one-work-backup-${stamp}.zip`;
};

const BackupSection: React.FC = () => {
  const { t } = useTranslation();
  const [scope, setScope] = useState<BackupScope>(DEFAULT_SCOPE);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** The archive just written, so it can be revealed without re-picking it. */
  const [lastArchive, setLastArchive] = useState<string | null>(null);
  /**
   * The passphrase dialog, and what it is for.
   *
   * Held as one piece of state rather than a boolean per flow: the dialog is
   * the same dialog, and what changes is which operation is waiting on it and
   * what that operation already knows (the destination, or the archive and its
   * manifest).
   */
  const [prompt, setPrompt] = useState<
    null | { kind: 'export'; destination: string } | { kind: 'import'; source: string; manifest: BackupManifest }
  >(null);
  const [promptError, setPromptError] = useState<string | undefined>(undefined);

  const nothingSelected = useMemo(() => SCOPE_KEYS.every((key) => !scope[key]), [scope]);

  const toggle = useCallback((key: keyof BackupScope, checked: boolean) => {
    setScope((previous) => ({ ...previous, [key]: checked }));
  }, []);

  const handleExport = useCallback(async () => {
    const destination = await dialog.showSave.invoke({
      defaultPath: defaultFileName(),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (!destination) return;
    // The archive is written only once the passphrase is set: every backup
    // carries this install's identity secret, so there is no scope that would
    // be safe to write in the clear.
    setPromptError(undefined);
    setPrompt({ kind: 'export', destination });
  }, []);

  const runExport = useCallback(
    async (destination: string, passphrase: string) => {
      setExporting(true);
      try {
        const result = await httpRequest<CreateBackupResponse>('POST', '/api/system/backup', {
          destination,
          scope,
          passphrase,
        });
        // Remember where it went, so the button below can open it. A path the
        // user chose minutes ago in a native dialog is not something they should
        // have to go hunting for afterwards.
        setLastArchive(result.path);
        setPrompt(null);
        Message.success({
          content: t('settings.backup.exportSuccess', { size: formatBytes(result.archiveBytes) }),
          // A long export outlives the default toast: someone who waited minutes
          // for it should not have to wonder whether it finished.
          duration: 6000,
        });
      } catch (error) {
        // Kept on the dialog rather than a toast: a passphrase the backend
        // refused is something to fix in the field that is still open.
        setPromptError(error instanceof Error ? error.message : t('settings.backup.exportFailed'));
      } finally {
        setExporting(false);
      }
    },
    [scope, t]
  );

  const handleReveal = useCallback(() => {
    if (!lastArchive) return;
    void ipcBridge.shell.showItemInFolder.invoke(lastArchive).catch(() => {
      Message.error(t('settings.backup.revealFailed'));
    });
  }, [lastArchive, t]);

  const runRestore = useCallback(
    async (source: string, manifest: BackupManifest, passphrase: string) => {
      setRestoring(true);
      try {
        const result = await httpRequest<RestoreBackupResponse>('POST', '/api/system/backup/restore', {
          source,
          scope: manifest.scope,
          passphrase,
        });
        const rows = Object.values(result.rowsByTable).reduce((sum, count) => sum + count, 0);
        const dropped = Object.values(result.orphansRemoved || {}).reduce((sum, count) => sum + count, 0);
        setPrompt(null);
        if (dropped > 0) {
          // A warning rather than a success: the restore worked, but it did not
          // bring everything, and "restored N rows" alone would read as
          // lossless.
          Message.warning(
            t('settings.backup.restoreSuccessWithDropped', { rows, files: result.filesRestored, dropped })
          );
        } else {
          Message.success(t('settings.backup.restoreSuccess', { rows, files: result.filesRestored }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : t('settings.backup.restoreFailed');
        // A wrong passphrase belongs on the dialog, where it can be retyped.
        // Anything else is a toast, because the dialog is not where it is fixed.
        if (manifest.encryption) {
          setPromptError(message);
        } else {
          Message.error(message);
        }
      } finally {
        setRestoring(false);
      }
    },
    [t]
  );

  const handleImport = useCallback(async () => {
    const picked = await dialog.showOpen.invoke({
      properties: ['openFile'],
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    const source = picked?.[0];
    if (!source) return;

    let manifest: BackupManifest;
    try {
      manifest = await httpRequest<BackupManifest>('POST', '/api/system/backup/preview', { source });
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('settings.backup.previewFailed'));
      return;
    }

    // 说清楚这个包里有什么、会往哪儿合并，再让用户点确认 —— 恢复是合并不是覆盖，
    // 没勾的类别原样不动，这一点必须让用户看到，否则会以为要丢数据。
    // Say what the archive holds and how it will be applied before confirming:
    // a restore merges, and categories it does not carry are left alone.
    const carried = SCOPE_KEYS.filter((key) => manifest.scope[key]).map((key) => t(`settings.backup.scope.${key}`));
    Modal.confirm({
      title: t('settings.backup.restoreConfirmTitle'),
      content: (
        <div className='flex flex-col gap-8px'>
          <div>
            {t('settings.backup.restoreConfirmContent', { items: carried.join(t('settings.backup.listSeparator')) })}
          </div>
          <div className='text-12px text-t-secondary'>
            {t('settings.backup.restoreExportedAt', {
              date: new Date(manifest.exportedAt).toLocaleString(),
              version: manifest.appVersion,
            })}
          </div>
        </div>
      ),
      onOk: () => {
        // An archive written before encryption existed has no passphrase to
        // ask for; one written since cannot be opened without it.
        if (manifest.encryption) {
          setPromptError(undefined);
          setPrompt({ kind: 'import', source, manifest });
          return;
        }
        void runRestore(source, manifest, '');
      },
    });
  }, [runRestore, t]);
  const handlePassphrase = useCallback(
    (passphrase: string) => {
      if (!prompt) return;
      if (prompt.kind === 'export') {
        void runExport(prompt.destination, passphrase);
      } else {
        void runRestore(prompt.source, prompt.manifest, passphrase);
      }
    },
    [prompt, runExport, runRestore]
  );

  if (!isNativeDialogAvailable()) return null;

  return (
    <div className='px-[12px] md:px-[32px] py-16px bg-2 rd-16px'>
      <div className='text-14px font-medium text-t-primary mb-4px'>{t('settings.backup.title')}</div>
      <div className='text-12px text-t-secondary mb-12px'>{t('settings.backup.description')}</div>

      <div className='flex flex-col gap-8px mb-12px'>
        {SCOPE_KEYS.map((key) => (
          <Checkbox key={key} checked={scope[key]} onChange={(checked) => toggle(key, checked)}>
            <span className='text-13px text-t-primary'>{t(`settings.backup.scope.${key}`)}</span>
            <span className='text-12px text-t-secondary ml-8px'>{t(`settings.backup.scopeHint.${key}`)}</span>
          </Checkbox>
        ))}
      </div>

      {scope.providers && <Alert type='warning' content={t('settings.backup.credentialWarning')} className='mb-12px' />}
      {/* Says so before the click, not after: this category is the difference
          between a backup that finishes in seconds and one that runs for half
          an hour with nothing on screen to explain it. */}
      {scope.attachments && (
        <Alert type='info' content={t('settings.backup.attachmentsSlowWarning')} className='mb-12px' />
      )}

      <div className='flex items-center gap-8px'>
        <Button type='primary' size='small' loading={exporting} disabled={nothingSelected} onClick={handleExport}>
          {t('settings.backup.exportButton')}
        </Button>
        <Button size='small' loading={restoring} onClick={handleImport}>
          {t('settings.backup.importButton')}
        </Button>
        {/* Only after something has been written — before that there is
            nothing to reveal, and a dead button is worse than no button. */}
        {lastArchive && (
          <Button size='small' type='text' onClick={handleReveal}>
            <span className='flex items-center gap-4px'>
              <FolderOpen theme='outline' size='13' fill={iconColors.secondary} />
              {t('settings.backup.revealButton')}
            </span>
          </Button>
        )}
      </div>
      {lastArchive && <div className='text-12px text-t-secondary mt-8px break-all'>{lastArchive}</div>}

      <PassphrasePrompt
        visible={!!prompt}
        mode={prompt?.kind === 'import' ? 'open' : 'create'}
        busy={exporting || restoring}
        error={promptError}
        onCancel={() => {
          setPrompt(null);
          setPromptError(undefined);
        }}
        onSubmit={handlePassphrase}
      />
    </div>
  );
};

export default BackupSection;
