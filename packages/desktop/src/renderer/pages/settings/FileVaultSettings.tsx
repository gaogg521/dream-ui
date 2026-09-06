/**
 * @license
 * Copyright 2026 1ONE
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Personal file vault settings page (§4.3 of the 09-05 handoff) — the member
 * self-service half of P2-4. The vault lives on the enterprise server (the
 * rows are server-scoped, routed through the governance prefixes in
 * httpBridge), so the page is only reachable in enterprise mode and shows a
 * connect-first empty state otherwise.
 *
 * Spec: list (name / size / time), upload, download, delete, quota usage, and
 * the frozen state — a frozen vault refuses uploads but keeps existing
 * objects readable and deletable (backend contract, mirrored here).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message, Modal } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import type { FileVaultInfo, FileVaultObject } from '@/common/types/platform/enterpriseTypes';
import { isElectronDesktop } from '@renderer/utils/platform';
import SettingsPageWrapper from './components/SettingsPageWrapper';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}

const FileVaultSettings: React.FC = () => {
  const { t } = useTranslation();
  const enterpriseEnabled = isEnterpriseModeEnabled();
  const desktop = isElectronDesktop();

  const [vault, setVault] = useState<FileVaultInfo | null>(null);
  const [files, setFiles] = useState<FileVaultObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const frozen = vault?.status === 'frozen';

  const refresh = useCallback(async () => {
    if (!enterpriseEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const [vaultInfo, fileList] = await Promise.all([
        ipcBridge.onePlatform.myVault.invoke(),
        ipcBridge.onePlatform.listMyVaultFiles.invoke(),
      ]);
      setVault(vaultInfo);
      // The ledger keeps tombstones for the audit trail; a member's file list
      // shows only live objects.
      setFiles((fileList ?? []).filter((f) => f.deletedAt == null));
    } catch (e) {
      setError(isBackendHttpError(e) ? e.backendMessage : String(e));
    } finally {
      setLoading(false);
    }
  }, [enterpriseEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpload = useCallback(
    async (file: File) => {
      if (frozen) return;
      setUploading(true);
      try {
        await ipcBridge.onePlatform.uploadVaultFile.invoke(file);
        await refresh();
      } catch (e) {
        const detail = isBackendHttpError(e) ? e.backendMessage : String(e);
        Message.error(t('common.fileVault.uploadFailed', { defaultValue: '上传失败', message: detail }));
      } finally {
        setUploading(false);
      }
    },
    [frozen, refresh, t]
  );

  const handleDownload = useCallback(
    async (object: FileVaultObject) => {
      try {
        const { blob, fileName } = await ipcBridge.onePlatform.downloadVaultFile.invoke(object.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName || object.fileName;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        Message.error(
          t('common.fileVault.downloadFailed', {
            defaultValue: '下载失败',
            message: isBackendHttpError(e) ? e.backendMessage : String(e),
          })
        );
      }
    },
    [t]
  );

  const handleDelete = useCallback(
    (object: FileVaultObject) => {
      Modal.confirm({
        title: t('common.fileVault.deleteConfirmTitle', { defaultValue: '删除文件' }),
        content: t('common.fileVault.deleteConfirmBody', { name: object.fileName, defaultValue: '确定删除「{{name}}」吗？此操作不可撤销。' }),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          try {
            await ipcBridge.onePlatform.deleteVaultFile.invoke({ id: object.id });
            await refresh();
          } catch (e) {
            Message.error(
              t('common.fileVault.deleteFailed', {
                defaultValue: '删除失败',
                message: isBackendHttpError(e) ? e.backendMessage : String(e),
              })
            );
          }
        },
      });
    },
    [refresh, t]
  );

  const usagePercent = useMemo(() => {
    if (!vault?.quotaBytes) return null;
    if (vault.quotaBytes <= 0) return 100;
    return Math.min(100, Math.round((vault.usageBytes / vault.quotaBytes) * 100));
  }, [vault]);

  const renderBody = () => {
    if (!enterpriseEnabled) {
      return (
        <div className='py-40px text-center text-14px text-t-tertiary'>
          {t('common.fileVault.notConnected', {
            defaultValue: '文件保险箱属于企业版功能。请先在「企业身份」页连接企业服务器。',
          })}
        </div>
      );
    }
    if (loading && !vault) {
      return <div className='py-40px text-center text-14px text-t-tertiary'>{t('common.loading', { defaultValue: '加载中…' })}</div>;
    }
    if (error && !vault) {
      return <div className='py-40px text-center text-14px text-t-tertiary'>{error}</div>;
    }
    if (!vault) return null;

    return (
      <div className='flex flex-col gap-12px'>
        {frozen && (
          <div className='rd-8px border border-[rgb(var(--warning-6))]/40 bg-[rgb(var(--warning-6))]/10 px-12px py-10px text-13px text-t-primary'>
            {t('common.fileVault.frozenNotice', {
              defaultValue: '管理员已冻结此保险箱：暂停上传，已有文件仍可查看、下载和删除。如有疑问请联系管理员。',
            })}
          </div>
        )}

        {/* Quota / status card */}
        <div className='rd-8px border border-border-2 px-14px py-12px'>
          <div className='mb-8px flex items-center justify-between text-13px'>
            <span className='text-t-primary'>
              {vault.quotaBytes == null
                ? t('common.fileVault.usageUnlimited', { used: formatBytes(vault.usageBytes), defaultValue: '已用 {{used}} · 不限量' })
                : t('common.fileVault.usageQuota', {
                    used: formatBytes(vault.usageBytes),
                    quota: formatBytes(vault.quotaBytes),
                    defaultValue: '已用 {{used}} / {{quota}}',
                  })}
            </span>
            <span className='text-t-tertiary'>
              {frozen
                ? t('common.fileVault.statusFrozen', { defaultValue: '已冻结' })
                : t('common.fileVault.statusAvailable', { defaultValue: '可用' })}
              {' · '}
              {t('common.fileVault.objectCount', { n: vault.objectCount, defaultValue: '{{n}} 个文件' })}
            </span>
          </div>
          {usagePercent != null && (
            <div className='h-6px w-full overflow-hidden rd-3px bg-fill-2'>
              <div
                className='h-full rd-3px bg-[rgb(var(--primary-6))]'
                style={{ width: `${usagePercent}%` }}
                role='progressbar'
                aria-valuenow={usagePercent}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className='flex items-center justify-between'>
          <span className='text-13px font-500 text-t-primary'>
            {t('common.fileVault.fileListTitle', { defaultValue: '文件列表' })}
          </span>
          <input
            ref={fileInputRef}
            type='file'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
              // Reset so picking the same file again still fires onChange.
              event.target.value = '';
            }}
          />
          <button
            type='button'
            className='rd-6px border border-border-2 px-12px py-5px text-13px text-t-primary transition-colors hover:bg-fill-3 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={frozen || uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading
              ? t('common.fileVault.uploading', { defaultValue: '上传中…' })
              : t('common.fileVault.upload', { defaultValue: '上传文件' })}
          </button>
        </div>

        {/* File list */}
        {files.length === 0 ? (
          <div className='py-32px text-center text-13px text-t-tertiary'>
            {t('common.fileVault.empty', { defaultValue: '保险箱为空。上传的文件仅自己可见。' })}
          </div>
        ) : (
          <div className='rd-8px border border-border-2 overflow-hidden'>
            <div className='flex bg-fill-2 px-14px py-8px text-12px text-t-tertiary'>
              <span className='flex-1'>{t('common.fileVault.colName', { defaultValue: '文件名' })}</span>
              <span className='w-90px text-right'>{t('common.fileVault.colSize', { defaultValue: '大小' })}</span>
              <span className='w-160px text-right'>{t('common.fileVault.colTime', { defaultValue: '上传时间' })}</span>
              <span className='w-110px text-right'>{t('common.fileVault.colActions', { defaultValue: '操作' })}</span>
            </div>
            {files.map((object) => (
              <div
                key={object.id}
                className='flex items-center border-t border-border-2 px-14px py-9px text-13px'
                data-vault-file={object.fileName}
              >
                <span className='flex-1 truncate text-t-primary' title={object.fileName}>
                  {object.fileName}
                </span>
                <span className='w-90px text-right text-t-secondary'>{formatBytes(object.sizeBytes)}</span>
                <span className='w-160px text-right text-t-tertiary'>
                  {new Date(object.createdAt).toLocaleString()}
                </span>
                <span className='flex w-110px items-center justify-end gap-10px'>
                  <button
                    type='button'
                    className='border-none bg-transparent p-0 text-13px text-[rgb(var(--primary-6))] hover:underline'
                    onClick={() => void handleDownload(object)}
                  >
                    {t('common.fileVault.download', { defaultValue: '下载' })}
                  </button>
                  <button
                    type='button'
                    className='border-none bg-transparent p-0 text-13px text-[rgb(var(--danger-6))] hover:underline'
                    onClick={() => handleDelete(object)}
                  >
                    {t('common.fileVault.delete', { defaultValue: '删除' })}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {!desktop && (
          <div className='text-12px text-t-tertiary'>
            {t('common.fileVault.browserHint', { defaultValue: '当前为浏览器会话，文件操作直接发生在企业服务器上。' })}
          </div>
        )}
      </div>
    );
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-960px'>
      <div className='flex h-full flex-col'>
        <div className='flex items-center border-b border-border-2 px-16px py-12px'>
          <div className='text-16px font-600 text-t-primary'>
            {t('common.fileVault.title', { defaultValue: '文件保险箱' })}
          </div>
        </div>
        <div className='flex-1 overflow-auto p-16px'>{renderBody()}</div>
      </div>
    </SettingsPageWrapper>
  );
};

export default FileVaultSettings;
