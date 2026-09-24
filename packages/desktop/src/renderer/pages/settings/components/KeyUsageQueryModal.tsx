/**
 * Copyright 2026 One Work
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { KeyUsageLogEntry, KeyUsageQueryResponse } from '@/common/types/provider/providerApi';
import { Button, Input, Message, Table } from '@arco-design/web-react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DreamModal from '@renderer/components/base/DreamModal';
import { formatMajorUnits } from '@renderer/hooks/agent/useTrialQuota';
import type { TrialVendor } from '@renderer/hooks/agent/useTrialModelClaim';

/**
 * "Paste your key, see your usage" — a self-service lookup modeled on
 * public token-usage-checker pages. Identity is proving possession of the
 * key itself (the broker matches it by hash, never storing the plaintext),
 * not this install — so it also works for a key pasted from anywhere, not
 * just this device's own.
 */
const KeyUsageQueryModal: React.FC<{
  visible: boolean;
  vendor: TrialVendor;
  onClose: () => void;
}> = ({ visible, vendor, onClose }) => {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<KeyUsageQueryResponse | null>(null);

  const reset = useCallback(() => {
    setKey('');
    setLoading(false);
    setResult(null);
  }, []);

  const handleQuery = useCallback(async () => {
    const trimmed = key.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const response = await ipcBridge.mode.queryKeyUsage.invoke({ vendor, key: trimmed });
      if (!response) {
        Message.error(t('settings.keyUsageQuery.notFound'));
        return;
      }
      setResult(response);
    } catch (e) {
      if (isBackendHttpError(e) && e.status === 404) {
        Message.error(t('settings.keyUsageQuery.notFound'));
      } else {
        Message.error(t('settings.keyUsageQuery.genericError'));
      }
    } finally {
      setLoading(false);
    }
  }, [key, loading, t, vendor]);

  const typeLabel = (kind: string) => {
    if (kind === 'charge') return t('settings.keyUsageQuery.typeCharge');
    if (kind === 'error') return t('settings.keyUsageQuery.typeError');
    if (kind === 'refund') return t('settings.keyUsageQuery.typeRefund');
    return kind;
  };

  const columns = [
    {
      title: t('settings.keyUsageQuery.columnTime'),
      dataIndex: 'created_at',
      render: (value: number) => new Date(value * 1000).toLocaleString(),
    },
    {
      title: t('settings.keyUsageQuery.columnModel'),
      dataIndex: 'model',
      ellipsis: true,
    },
    {
      title: t('settings.keyUsageQuery.columnType'),
      dataIndex: 'kind',
      render: (value: string) => typeLabel(value),
    },
    {
      title: t('settings.keyUsageQuery.columnTokens'),
      dataIndex: 'prompt_tokens',
      render: (_: number, row: KeyUsageLogEntry) => `${row.prompt_tokens} / ${row.completion_tokens}`,
    },
    {
      title: t('settings.keyUsageQuery.columnCost'),
      dataIndex: 'amount',
      render: (value: number) => formatMajorUnits(value, result?.currency ?? 'CNY'),
    },
  ];

  return (
    <DreamModal
      variant='standard'
      visible={visible}
      onCancel={() => {
        reset();
        onClose();
      }}
      header={{ title: t('settings.keyUsageQuery.title'), showClose: true }}
      footer={null}
      style={{ maxWidth: '92vw', width: 560 }}
    >
      <div className='flex flex-col gap-12px'>
        <div className='flex gap-8px'>
          <Input.Password
            className='!flex-1'
            value={key}
            onChange={(value) => setKey(value)}
            onPressEnter={handleQuery}
            placeholder={t('settings.keyUsageQuery.inputPlaceholder')}
          />
          <Button type='primary' loading={loading} disabled={!key.trim()} onClick={handleQuery}>
            {t('settings.keyUsageQuery.queryButton')}
          </Button>
        </div>

        {result && (
          <>
            <div className='flex gap-16px text-13px text-t-secondary'>
              <span>
                {t('settings.keyUsageQuery.balanceLabel', {
                  amount: formatMajorUnits(result.remaining_usd ?? 0, result.currency),
                })}
              </span>
              {result.limit_usd !== null && (
                <span>
                  {t('settings.keyUsageQuery.limitLabel', {
                    amount: formatMajorUnits(result.limit_usd, result.currency),
                  })}
                </span>
              )}
            </div>

            <div className='text-13px font-medium text-t-primary'>{t('settings.keyUsageQuery.recentCalls')}</div>
            <Table
              columns={columns}
              data={result.logs}
              rowKey='id'
              size='small'
              pagination={result.logs.length > 10 ? { pageSize: 10 } : false}
              noDataElement={
                <div className='text-center text-t-secondary py-24px'>{t('settings.keyUsageQuery.emptyLogs')}</div>
              }
            />
          </>
        )}
      </div>
    </DreamModal>
  );
};

export default KeyUsageQueryModal;
