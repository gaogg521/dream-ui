/**
 * Consolidated media ledger (T8): every generated image/video, individually
 * searchable and attributable — one row per FILE (a job producing 4 images is
 * 4 rows), distinct from the usage dashboard's cost rollups. Admin-only.
 *
 * Prompt retention is off by default: what a company needs from the ledger is
 * "who generated this, where, and what file it is" — the prompt column stays
 * NULL unless an admin explicitly opts in below, and the backend enforces
 * that server-side regardless of what the client sends.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input, Message, Switch, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { MediaAssetLedgerEntry } from '@/common/types/billing/billingTypes';

const KIND_COLOR: Record<string, string> = { image: 'arcoblue', video: 'purple' };

const MediaLedgerTab: React.FC = () => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MediaAssetLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');
  const [promptFilter, setPromptFilter] = useState('');
  const [retainPrompts, setRetainPrompts] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [assets, settings] = await Promise.all([
        ipcBridge.oneBilling.listMediaAssets.invoke({
          kind: kindFilter.trim() || undefined,
          userId: userFilter.trim() || undefined,
          model: modelFilter.trim() || undefined,
          promptContains: promptFilter.trim() || undefined,
          limit: 500,
        }),
        ipcBridge.oneBilling.getMediaLedgerSettings.invoke(),
      ]);
      setRows(assets ?? []);
      setRetainPrompts(settings?.retainPrompts ?? false);
    } catch (error) {
      Message.error(t('common.mediaLedger.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  }, [t, kindFilter, userFilter, modelFilter, promptFilter]);

  useEffect(() => {
    void refresh();
    // Initial load only; filters apply via the "查询" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleRetainPrompts = async (next: boolean) => {
    setSavingSettings(true);
    try {
      const settings = await ipcBridge.oneBilling.setMediaLedgerSettings.invoke({ retainPrompts: next });
      setRetainPrompts(settings.retainPrompts);
      Message.success(t('common.mediaLedger.settingsSaved', { defaultValue: '已保存' }));
    } catch (error) {
      Message.error(t('common.mediaLedger.settingsSaveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSavingSettings(false);
    }
  };

  const columns = [
    {
      title: t('common.mediaLedger.colTime', { defaultValue: '时间' }),
      render: (_: unknown, r: MediaAssetLedgerEntry) => new Date(r.createdAt).toLocaleString(),
    },
    {
      title: t('common.mediaLedger.colUser', { defaultValue: '成员' }),
      dataIndex: 'userId',
    },
    {
      title: t('common.mediaLedger.colKind', { defaultValue: '类型' }),
      render: (_: unknown, r: MediaAssetLedgerEntry) => (
        <Tag size='small' color={KIND_COLOR[r.kind] ?? 'gray'}>
          {r.kind}
        </Tag>
      ),
    },
    {
      title: t('common.mediaLedger.colModel', { defaultValue: '模型' }),
      render: (_: unknown, r: MediaAssetLedgerEntry) => r.model ?? '—',
    },
    {
      title: t('common.mediaLedger.colPrompt', { defaultValue: '提示词' }),
      render: (_: unknown, r: MediaAssetLedgerEntry) => (
        <span className='text-12px text-t-secondary break-all'>
          {r.prompt ?? (retainPrompts ? '' : t('common.mediaLedger.promptNotRetained', { defaultValue: '（未留存）' }))}
        </span>
      ),
    },
    {
      title: t('common.mediaLedger.colFile', { defaultValue: '文件' }),
      render: (_: unknown, r: MediaAssetLedgerEntry) => (
        <span className='text-12px text-t-secondary break-all'>{r.filePath}</span>
      ),
    },
  ];

  return (
    <Card title={t('common.mediaLedger.title', { defaultValue: '生成物账本' })}>
      <div className='mb-12px flex flex-wrap items-center gap-8px'>
        <Switch checked={retainPrompts} loading={savingSettings} onChange={(v) => void handleToggleRetainPrompts(v)} />
        <span className='text-13px text-t-secondary'>
          {t('common.mediaLedger.retainPromptsLabel', { defaultValue: '保留生成提示词' })}
        </span>
        <span className='text-11px text-t-tertiary'>
          {t('common.mediaLedger.retainPromptsHint', {
            defaultValue: '默认关闭。开启后，此后新生成的图片/视频提示词会计入账本，可供检索；已有记录不受影响。',
          })}
        </span>
      </div>
      <div className='mb-12px flex flex-wrap items-center gap-8px'>
        <Input
          allowClear
          style={{ width: 120 }}
          value={kindFilter}
          onChange={setKindFilter}
          placeholder={t('common.mediaLedger.filterKind', { defaultValue: 'image / video' })}
        />
        <Input
          allowClear
          style={{ width: 180 }}
          value={modelFilter}
          onChange={setModelFilter}
          placeholder={t('common.mediaLedger.filterModel', { defaultValue: '按模型' })}
        />
        <Input
          allowClear
          style={{ width: 200 }}
          value={userFilter}
          onChange={setUserFilter}
          placeholder={t('common.mediaLedger.filterUser', { defaultValue: '按成员 ID' })}
        />
        <Input
          allowClear
          style={{ width: 220 }}
          value={promptFilter}
          onChange={setPromptFilter}
          disabled={!retainPrompts}
          placeholder={
            retainPrompts
              ? t('common.mediaLedger.filterPrompt', { defaultValue: '按提示词关键字' })
              : t('common.mediaLedger.filterPromptDisabled', { defaultValue: '未开启提示词留存，无法按提示词检索' })
          }
        />
        <Button type='primary' size='small' onClick={() => void refresh()}>
          {t('common.mediaLedger.query', { defaultValue: '查询' })}
        </Button>
      </div>
      <div className='mb-8px text-11px text-t-tertiary'>
        {t('common.mediaLedger.hint', {
          defaultValue: '记录公司内每一次图片/视频生成——谁生成的、在哪个会话、文件在哪，用于检索、归属与灾备。',
        })}
      </div>
      <Table
        rowKey='id'
        loading={loading}
        columns={columns}
        data={rows}
        size='small'
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
};

export default MediaLedgerTab;
