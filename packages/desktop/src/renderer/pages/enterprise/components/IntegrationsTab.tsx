/**
 * Integration connectors (P2-1 reserved framework).
 *
 * Same "底层适配" shape as OnboardingTab's SMTP card: the config store + entry
 * points are real and wired, but no connector client (Octocrab / GitLab / Jira
 * / Feishu SDK) ships in this crate. An admin fills in a provider's base URL,
 * non-secret config, and credential here; a "test" reports `not_configured`
 * until a real `IntegrationProvider` is dropped in at the backend app layer.
 * Each provider is one row keyed by (tenant, provider).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Message, Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { Integration } from '@/common/types/org/orgTypes';

/** Provider metadata: which connectors the config layer surfaces + their UX. */
type ProviderMeta = {
  provider: string;
  labelDefault: string;
  baseUrlPlaceholder: string;
  secretLabelDefault: string;
  configHintDefault: string;
};

const PROVIDERS: ProviderMeta[] = [
  {
    provider: 'github',
    labelDefault: 'GitHub',
    baseUrlPlaceholder: 'https://api.github.com',
    secretLabelDefault: '访问令牌（PAT）',
    configHintDefault: '{ "org": "your-org" }',
  },
  {
    provider: 'gitlab',
    labelDefault: 'GitLab',
    baseUrlPlaceholder: 'https://gitlab.com',
    secretLabelDefault: '访问令牌',
    configHintDefault: '{ "group": "your-group" }',
  },
  {
    provider: 'jira',
    labelDefault: 'Jira',
    baseUrlPlaceholder: 'https://your-domain.atlassian.net',
    secretLabelDefault: 'API Token',
    configHintDefault: '{ "email": "you@corp.com", "projectKey": "ABC" }',
  },
  {
    provider: 'feishu',
    labelDefault: '飞书',
    baseUrlPlaceholder: 'https://open.feishu.cn',
    secretLabelDefault: 'App Secret',
    configHintDefault: '{ "appId": "cli_xxx" }',
  },
];

type ConnectorCardProps = {
  meta: ProviderMeta;
  /** Existing saved config for this provider (redacted), or null if unset. */
  saved: Integration | null;
  onSaved: (next: Integration) => void;
};

const ConnectorCard: React.FC<ConnectorCardProps> = ({ meta, saved, onSaved }) => {
  const { t } = useTranslation();
  const [baseUrl, setBaseUrl] = useState('');
  const [configText, setConfigText] = useState('');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Seed the form whenever the saved config (re)loads.
  useEffect(() => {
    setBaseUrl(saved?.baseUrl ?? '');
    setConfigText(saved?.config && Object.keys(saved.config).length > 0 ? JSON.stringify(saved.config, null, 2) : '');
    setEnabled(saved?.enabled ?? false);
    setSecret('');
  }, [saved]);

  // Parse the free-form JSON config box; empty = `{}`. Returns null on a syntax
  // error so the caller can block the save with a clear message.
  const parseConfig = (): Record<string, unknown> | null => {
    const text = configText.trim();
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    const config = parseConfig();
    if (config === null) {
      Message.error(t('common.integrations.badConfig', { defaultValue: '配置需为合法的 JSON 对象。' }));
      return;
    }
    setSaving(true);
    try {
      const next = await ipcBridge.oneAdmin.setIntegration.invoke({
        provider: meta.provider,
        baseUrl: baseUrl || undefined,
        config,
        secret: secret || undefined,
        enabled,
      });
      setSecret('');
      onSaved(next);
      Message.success(t('common.integrations.saved', { defaultValue: '已保存' }));
    } catch (error) {
      Message.error(t('common.integrations.saveFailed', { defaultValue: '保存失败' }) + ': ' + String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const result = await ipcBridge.oneAdmin.testIntegration.invoke({ provider: meta.provider });
      if (result.status === 'ok') {
        Message.success(result.message);
      } else if (result.status === 'error') {
        Message.error(result.message);
      } else {
        // `not_configured` — the reserved-adapter default.
        Message.info(result.message);
      }
    } catch (error) {
      Message.error(t('common.integrations.testFailed', { defaultValue: '测试失败' }) + ': ' + String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title={t(`common.integrations.provider.${meta.provider}`, { defaultValue: meta.labelDefault })}
      extra={
        <Tag size='small' color={saved?.enabled ? 'green' : 'gray'}>
          {saved?.enabled
            ? t('common.integrations.enabled', { defaultValue: '已启用' })
            : t('common.integrations.disabled', { defaultValue: '未启用' })}
        </Tag>
      }
    >
      <div className='grid gap-12px' style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.integrations.baseUrl', { defaultValue: '服务地址' })}
          </div>
          <Input value={baseUrl} onChange={setBaseUrl} placeholder={meta.baseUrlPlaceholder} />
        </div>
        <div>
          <div className='text-t-secondary text-12px mb-4px'>
            {t('common.integrations.secret', { defaultValue: meta.secretLabelDefault })}
          </div>
          <Input.Password
            value={secret}
            onChange={setSecret}
            placeholder={
              saved?.hasSecret
                ? t('common.integrations.secretKeep', { defaultValue: '留空保持不变' })
                : t('common.integrations.secretPlaceholder', { defaultValue: '输入凭据' })
            }
          />
        </div>
      </div>
      <div className='mt-12px'>
        <div className='text-t-secondary text-12px mb-4px'>
          {t('common.integrations.config', { defaultValue: '扩展配置（JSON，非密钥字段）' })}
        </div>
        <Input.TextArea
          value={configText}
          onChange={setConfigText}
          placeholder={meta.configHintDefault}
          autoSize={{ minRows: 2, maxRows: 6 }}
        />
      </div>
      <div className='mt-12px flex items-center gap-8px'>
        <Switch checked={enabled} onChange={setEnabled} />
        <span className='text-12px text-t-secondary'>{t('common.integrations.enable', { defaultValue: '启用' })}</span>
        <div className='flex-1' />
        <Button size='small' loading={testing} onClick={() => void handleTest()}>
          {t('common.integrations.test', { defaultValue: '测试连接' })}
        </Button>
        <Button type='primary' size='small' loading={saving} onClick={() => void handleSave()}>
          {t('common.save', { defaultValue: '保存' })}
        </Button>
      </div>
    </Card>
  );
};

const IntegrationsTab: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipcBridge.oneAdmin.listIntegrations.invoke();
      setIntegrations(data ?? []);
    } catch (error) {
      Message.error(t('common.integrations.loadFailed', { defaultValue: '加载失败' }) + ': ' + String(error));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const byProvider = useMemo(() => new Map(integrations.map((i) => [i.provider, i])), [integrations]);

  const handleSaved = (next: Integration) => {
    setIntegrations((prev) => {
      const rest = prev.filter((i) => i.provider !== next.provider);
      return [...rest, next];
    });
  };

  return (
    <div className='flex flex-col gap-16px'>
      <div className='text-12px text-t-tertiary'>
        {t('common.integrations.hint', {
          defaultValue:
            '保存连接器本身不会真正同步——尚未接入连接器客户端。这里预留了配置项与入口，接入后即可直接使用（同 SMTP 预留）。',
        })}
      </div>
      {loading && integrations.length === 0 ? (
        <Card loading />
      ) : (
        PROVIDERS.map((meta) => (
          <ConnectorCard
            key={meta.provider}
            meta={meta}
            saved={byProvider.get(meta.provider) ?? null}
            onSaved={handleSaved}
          />
        ))
      )}
    </div>
  );
};

export default IntegrationsTab;
