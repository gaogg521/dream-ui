/**
 * Copyright 2026 One Work
 */

/**
 * The member's own encrypted packages: who opened them, and a way to stop
 * further opening. Plus the in-app way to open a `.owenc` file someone sent,
 * for when the OS file association is not there (or not trusted).
 *
 * Hidden unless the company's plan includes export protection.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Collapse, Empty, Message, Modal, Popconfirm, Table, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { SecurePackage, SecurePackageOpen } from '@/common/adapter/ipcBridge';
import { isNativeDialogAvailable } from '@/common/adapter/ipcBridge';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import { requestOpenSecurePackage } from '@renderer/utils/enterprise/secureExport/openPackage';
import { loadExportPolicy } from '@renderer/utils/enterprise/secureExport/policy';

const STATUS_COLOR: Record<SecurePackage['status'], string> = {
  active: 'green',
  revoked: 'gray',
  expired: 'orange',
};

const SecurePackagesSection: React.FC = () => {
  const { t } = useTranslation();
  const [entitled, setEntitled] = useState(false);
  const [packages, setPackages] = useState<SecurePackage[]>([]);
  const [opens, setOpens] = useState<{ pkg: SecurePackage; rows: SecurePackageOpen[] } | null>(null);

  const load = useCallback(async () => {
    const policy = await loadExportPolicy({ fresh: true });
    setEntitled(policy.entitled);
    if (!policy.entitled) return;
    try {
      setPackages((await ipcBridge.onePlatform.mySecurePackages.invoke()) ?? []);
    } catch (e) {
      Message.error(friendlyEnterpriseError(e, t));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = useCallback(
    async (packageId: string) => {
      try {
        await ipcBridge.onePlatform.revokeMySecurePackage.invoke({ packageId });
        Message.success(t('messages.secureExport.revoked'));
        await load();
      } catch (e) {
        Message.error(friendlyEnterpriseError(e, t));
      }
    },
    [load, t]
  );

  const showOpens = useCallback(
    async (pkg: SecurePackage) => {
      try {
        const rows = (await ipcBridge.onePlatform.mySecurePackageOpens.invoke({ packageId: pkg.id })) ?? [];
        setOpens({ pkg, rows });
      } catch (e) {
        Message.error(friendlyEnterpriseError(e, t));
      }
    },
    [t]
  );

  const pickAndOpen = useCallback(async () => {
    const picked = await ipcBridge.dialog.showOpen.invoke({
      properties: ['openFile'],
      filters: [{ name: t('messages.secureExport.fileTypeName'), extensions: ['owenc'] }],
    });
    const path = picked?.[0];
    if (path) requestOpenSecurePackage(path);
  }, [t]);

  if (!entitled) return null;

  const scopeLabel = (pkg: SecurePackage) =>
    pkg.recipientScope === 'users'
      ? t('messages.secureExport.scopeUsersCount', { count: pkg.recipientUserIds.length })
      : pkg.recipientScope === 'enterprise'
        ? t('messages.secureExport.scopeEnterprise')
        : t('messages.secureExport.scopeTenant');

  return (
    <>
      <Collapse bordered={false} className='mt-8px'>
        <Collapse.Item
          name='secure-packages'
          header={t('messages.secureExport.sectionTitle')}
          extra={<span className='text-12px text-t-tertiary'>{packages.length}</span>}
        >
          {isNativeDialogAvailable() && (
            <div className='mb-12px'>
              <Button size='small' data-testid='secure-package-open-file' onClick={() => void pickAndOpen()}>
                {t('messages.secureExport.openFileButton')}
              </Button>
            </div>
          )}
          {packages.length === 0 ? (
            <Empty description={t('messages.secureExport.sectionEmpty')} />
          ) : (
            <Table
              size='small'
              rowKey='id'
              pagination={false}
              data={packages}
              columns={[
                {
                  title: t('messages.secureExport.colFiles'),
                  render: (_: unknown, row: SecurePackage) => row.fileNames.join(', '),
                },
                {
                  title: t('messages.secureExport.colRecipients'),
                  width: 130,
                  render: (_: unknown, row: SecurePackage) => scopeLabel(row),
                },
                {
                  title: t('messages.secureExport.colCreatedAt'),
                  dataIndex: 'createdAt',
                  width: 170,
                  render: (at: number) => new Date(at).toLocaleString(),
                },
                {
                  title: t('messages.secureExport.colStatus'),
                  dataIndex: 'status',
                  width: 90,
                  render: (status: SecurePackage['status']) => (
                    <Tag size='small' color={STATUS_COLOR[status]}>
                      {t(`messages.secureExport.status.${status}`)}
                    </Tag>
                  ),
                },
                {
                  title: t('messages.secureExport.colOpens'),
                  dataIndex: 'openCount',
                  width: 80,
                  render: (count: number, row: SecurePackage) => (
                    <a className='cursor-pointer' onClick={() => void showOpens(row)}>
                      {count}
                    </a>
                  ),
                },
                {
                  title: t('messages.secureExport.colAction'),
                  width: 90,
                  render: (_: unknown, row: SecurePackage) =>
                    row.status === 'active' ? (
                      <Popconfirm title={t('messages.secureExport.revokeConfirm')} onOk={() => void revoke(row.id)}>
                        <a className='text-danger-6 cursor-pointer'>{t('messages.secureExport.revoke')}</a>
                      </Popconfirm>
                    ) : (
                      '—'
                    ),
                },
              ]}
            />
          )}
        </Collapse.Item>
      </Collapse>
      <Modal
        visible={opens !== null}
        title={t('messages.secureExport.opensTitle')}
        footer={null}
        onCancel={() => setOpens(null)}
      >
        {opens && opens.rows.length === 0 ? (
          <Empty description={t('messages.secureExport.opensEmpty')} />
        ) : (
          <Table
            size='small'
            rowKey='id'
            pagination={false}
            data={opens?.rows ?? []}
            columns={[
              { title: t('messages.secureExport.colWho'), dataIndex: 'userName' },
              {
                title: t('messages.secureExport.colResult'),
                dataIndex: 'result',
                width: 110,
                render: (result: string, row: SecurePackageOpen) =>
                  result === 'granted'
                    ? t('messages.secureExport.openGranted')
                    : t('messages.secureExport.openDenied', { reason: row.reason ?? '' }),
              },
              {
                title: t('messages.secureExport.colWhen'),
                dataIndex: 'createdAt',
                width: 170,
                render: (at: number) => new Date(at).toLocaleString(),
              },
            ]}
          />
        )}
      </Modal>
    </>
  );
};

export default SecurePackagesSection;
