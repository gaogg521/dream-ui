import React, { useEffect, useState } from 'react';
import { Alert, Button, Message, Select, Space } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { mcpService, oneDevops } from '@/common/adapter/ipcBridge';
import { getEnterpriseSession, isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import type { IMcpServer } from '@/common/config/storage';
import { syncTeamMcp } from '@/renderer/utils/enterprise/teamSkillSync';

const LIMIT = 50;
const BATCH_LIMIT = 10;
type Props = { servers: IMcpServer[]; onChanged: (servers: IMcpServer[]) => void };

const companyRegistryId = (server: IMcpServer): string | undefined => {
  try {
    const id = JSON.parse(server.original_json ?? '{}')?.teamRegistryId;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
};
const isCompanyServer = (server: IMcpServer): boolean => Boolean(companyRegistryId(server));

/** Commit the next selection as a whole so replacements never transiently exceed the quota. */
export default function McpActivationPanel({ servers, onChanged }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState<string[]>([]);
  const [company, setCompany] = useState<string[]>([]);
  const [savedCompany, setSavedCompany] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Array<{ id: string; name: string }>>([]);
  const [catalogNames, setCatalogNames] = useState<Record<string, string>>({});
  const [companyReady, setCompanyReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const enterprise = isEnterpriseModeEnabled() && Boolean(getEnterpriseSession());
  const warnQuota = (kind: 'batch' | 'total') => {
    const content = kind === 'batch' ? t('settings.mcpBatchLimit') : t('settings.mcpQuotaReplace');
    Message.warning({ content: <span className='text-12px leading-18px'>{content}</span> });
  };

  useEffect(() => {
    setLocal(servers.filter((s) => s.enabled && !s.builtin && !isCompanyServer(s)).map((s) => s.id));
  }, [servers]);
  useEffect(() => {
    if (!enterprise) return;
    let active = true;
    void oneDevops.getMcpSelection
      .invoke()
      .then((result) => {
        if (active) {
          setCompany(result.selectedIds);
          setSavedCompany(result.selectedIds);
          setCompanyReady(true);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [enterprise]);
  useEffect(() => {
    if (!enterprise) return;
    let active = true;
    const timer = setTimeout(() => {
      void oneDevops.getMcpCatalog
        .invoke({ q: query, offset })
        .then((rows) => {
          if (active) {
            setCatalog(rows);
            setCatalogNames((previous) => ({
              ...previous,
              ...Object.fromEntries(rows.map((row) => [row.id, row.name])),
            }));
          }
        })
        .catch(() => {
          if (active) {
            setCatalog([]);
            setLoadError(true);
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enterprise, query, offset]);

  const choose = (ids: string[], update: (ids: string[]) => void) => {
    if (ids.length > LIMIT) {
      warnQuota('total');
      return;
    }
    if (ids.filter((id) => !savedCompany.includes(id)).length > BATCH_LIMIT) {
      warnQuota('batch');
      return;
    }
    if (ids.length === LIMIT) warnQuota('total');
    update(ids);
  };
  const save = async (companySelection: boolean) => {
    if (companySelection && !companyReady) return;
    setSaving(true);
    try {
      if (companySelection) {
        const saved = await oneDevops.replaceMcpSelection.invoke({ selectedIds: company });
        setSavedCompany(saved.selectedIds);
        const result = await syncTeamMcp();
        if (!result) throw new Error(t('settings.mcpSelectionSyncFailed'));
        onChanged(await mcpService.listServers.invoke());
      } else {
        const companyIds = servers.filter((s) => s.enabled && !s.builtin && isCompanyServer(s)).map((s) => s.id);
        onChanged(await mcpService.replaceSelection.invoke({ ids: [...local, ...companyIds] }));
      }
      Message.success(t('settings.mcpSelectionSaved'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('MCP_BATCH_LIMIT_EXCEEDED')) warnQuota('batch');
      else if (message.includes('MCP_LIMIT_EXCEEDED')) warnQuota('total');
      else Message.error(message || t('settings.mcpImportFailed'));
    } finally {
      setSaving(false);
    }
  };
  const syncedCompanyNames = new Map(servers.map((server) => [companyRegistryId(server), server.name]));
  const companyOptions = [
    ...catalog,
    ...company
      .filter((id) => !catalog.some((row) => row.id === id))
      .map((id) => ({ id, name: catalogNames[id] ?? syncedCompanyNames.get(id) ?? id })),
  ];
  return (
    <Space direction='vertical' className='w-full'>
      {loadError && <Alert type='error' content={t('settings.mcpSelectionSyncFailed')} />}
      <Alert type='info' content={t('settings.mcpQuotaDescription')} />
      <div className='text-t-primary'>
        {t('settings.mcpLocalSelection')} ({local.length})
      </div>
      <Select
        mode='multiple'
        allowClear
        maxTagCount={5}
        value={local}
        disabled={saving}
        onChange={(ids: string[]) => setLocal(ids)}
        options={servers.filter((s) => !s.builtin && !isCompanyServer(s)).map((s) => ({ label: s.name, value: s.id }))}
      />
      <Button disabled={saving} loading={saving} onClick={() => void save(false)}>
        {t('settings.mcpSaveSelection')}
      </Button>
      {enterprise && (
        <>
          <div className='text-t-primary'>
            {t('settings.mcpCompanySelection')} ({company.length}/{LIMIT})
          </div>
          <Select
            mode='multiple'
            allowClear
            showSearch
            filterOption={false}
            maxTagCount={5}
            value={company}
            disabled={saving}
            onSearch={(value) => {
              setQuery(value);
              setOffset(0);
            }}
            onChange={(ids: string[]) => choose(ids, setCompany)}
            options={companyOptions.map((s) => ({ label: s.name, value: s.id }))}
          />
          <Space>
            <Button disabled={offset === 0 || saving} onClick={() => setOffset(Math.max(0, offset - 50))}>
              {t('settings.mcpPreviousPage')}
            </Button>
            <Button disabled={catalog.length < 50 || saving} onClick={() => setOffset(offset + 50)}>
              {t('settings.mcpNextPage')}
            </Button>
            <Button
              loading={saving}
              disabled={saving || !companyReady || loadError}
              type='primary'
              onClick={() => void save(true)}
            >
              {t('settings.mcpSaveCompanySelection')}
            </Button>
          </Space>
        </>
      )}
    </Space>
  );
}
