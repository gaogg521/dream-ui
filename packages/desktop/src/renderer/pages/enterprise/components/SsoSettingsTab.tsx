/**
 * SSO settings tab — configure feishu / dingtalk / wecom OAuth providers.
 *
 * The admin status endpoint (`/api/one/admin/sso/providers`) returns stored
 * non-secret config values (App ID, Redirect URI, ...) so the form pre-fills
 * with what's already saved; secret fields (App Secret / Secret / Bind
 * Password) are still never echoed and stay blank. Saves are incremental
 * merges on the backend — blank fields keep their stored value, so
 * re-saving to tweak one field doesn't wipe the rest.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input, Message, Switch, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { friendlyEnterpriseError } from '@renderer/utils/enterprise/friendlyEnterpriseError';
import type { SsoProviderConfig } from '@/common/types/org/orgTypes';

type FieldSpec = {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
};

/**
 * The callback PATH is fixed by the backend router (`crates/one-sso/src/routes.rs`
 * — `GET /api/one/sso/{provider}/callback`) and is NOT configurable; only the
 * host/port varies by deployment. This field being free-text with no hint is
 * an easy trap — admins naturally guess `/api/auth/...` by analogy with the
 * rest of the auth API, register that with the OAuth provider, and every
 * login then 404s at the callback. `window.location.origin` is a reasonable
 * best-effort default when this page is viewed over http(s) (i.e. via WebUI
 * hitting the real server address); it's still just a suggestion the admin
 * can edit before saving, since reverse-proxy setups may need a different
 * externally-visible host.
 */
function suggestedRedirectUri(provider: string): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location.origin;
  if (!origin.startsWith('http://') && !origin.startsWith('https://')) return null;
  return `${origin}/api/one/sso/${provider}/callback`;
}

type ProviderSpec = {
  provider: 'feishu' | 'dingtalk' | 'wecom' | 'ldap' | 'oidc';
  title: string;
  fields: FieldSpec[];
};

// Field keys mirror the camelCase serde configs in crates/one-sso/src/providers/*.rs
const PROVIDERS: ProviderSpec[] = [
  {
    provider: 'feishu',
    title: '飞书 / Lark',
    fields: [
      { key: 'appId', label: 'App ID', required: true },
      { key: 'appSecret', label: 'App Secret', required: true, secret: true },
      { key: 'redirectUri', label: 'Redirect URI', required: true },
      { key: 'externalIdField', label: 'External ID Field (union_id/open_id)', required: false },
    ],
  },
  {
    provider: 'dingtalk',
    title: '钉钉',
    fields: [
      { key: 'appKey', label: 'App Key', required: true },
      { key: 'appSecret', label: 'App Secret', required: true, secret: true },
      { key: 'corpId', label: 'Corp ID', required: false },
      { key: 'redirectUri', label: 'Redirect URI', required: false },
    ],
  },
  {
    provider: 'wecom',
    title: '企业微信',
    fields: [
      { key: 'corpId', label: 'Corp ID', required: true },
      { key: 'agentId', label: 'Agent ID', required: true },
      { key: 'secret', label: 'Secret', required: true, secret: true },
      { key: 'redirectUri', label: 'Redirect URI', required: false },
    ],
  },
  {
    // Standard OpenID Connect — covers Okta / Azure AD (Entra) / Google
    // Workspace with one provider. Field keys mirror the camelCase
    // OidcProviderConfig parsed in crates/one-sso/src/service.rs
    // (parse_oidc_config). Issuer + Client ID are required; the rest default
    // on the backend (scopes → "openid profile email", externalIdClaim →
    // "sub", nameClaim → "name").
    provider: 'oidc',
    title: 'OIDC（Okta / Azure AD / Google）',
    fields: [
      { key: 'issuer', label: 'Issuer URL（如 https://xxx.okta.com）', required: true },
      { key: 'clientId', label: 'Client ID', required: true },
      { key: 'clientSecret', label: 'Client Secret', required: true, secret: true },
      { key: 'redirectUri', label: 'Redirect URI', required: true },
      { key: 'scopes', label: 'Scopes（默认 openid profile email）', required: false },
      { key: 'companyClaim', label: 'Company Claim（可选，如 Google 的 hd，用于同公司自动入伙）', required: false },
    ],
  },
  {
    // Password-based, not OAuth: the login page shows a username/password
    // form instead of a redirect button. Field keys mirror
    // crates/one-sso/src/providers/ldap.rs LdapProviderConfig.
    provider: 'ldap',
    title: 'LDAP / Active Directory',
    fields: [
      { key: 'url', label: 'Server URL (ldap:// 或 ldaps://)', required: true },
      { key: 'baseDN', label: 'Base DN', required: true },
      { key: 'bindDN', label: 'Bind DN（服务绑定，优先）', required: false },
      { key: 'bindAccount', label: 'Bind Account（DOMAIN\\user 或 UPN）', required: false },
      { key: 'bindPassword', label: 'Bind Password', required: false, secret: true },
      { key: 'loginAttribute', label: 'Login Attribute（AD: sAMAccountName / OpenLDAP: uid）', required: false },
      { key: 'searchFilter', label: 'Search Filter（支持 {{username}} 占位）', required: false },
      { key: 'externalIdAttribute', label: 'External ID Attribute', required: false },
    ],
  },
];

type ProviderCardProps = {
  spec: ProviderSpec;
  status: SsoProviderConfig | undefined;
  onSaved: () => void;
};

const ProviderCard: React.FC<ProviderCardProps> = ({ spec, status, onSaved }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(status?.enabled ?? false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(status?.enabled ?? false);
  }, [status?.enabled]);

  // Pre-fill non-secret fields from the stored config. Fires on mount and
  // again after a successful save (which reloads `status`) — never on a
  // timer, so it doesn't clobber in-progress typing.
  useEffect(() => {
    const nextValues: Record<string, string> = {};
    const config = status?.config;
    if (config) {
      for (const field of spec.fields) {
        if (field.secret) continue;
        const raw = config[field.key];
        if (typeof raw === 'string') nextValues[field.key] = raw;
      }
    }
    setValues(nextValues);
  }, [spec.fields, status?.config]);

  const handleSave = async () => {
    const filled = Object.fromEntries(
      Object.entries(values)
        .map(([k, v]) => [k, v.trim()])
        .filter(([, v]) => v !== '')
    ) as Record<string, string>;
    const hasConfig = Object.keys(filled).length > 0;
    // Only enforce "all required fields present" on the FIRST configuration.
    // Once configured, saves are incremental merges on the backend (blank =
    // keep stored value, incl. the non-echoed secret), so re-saving to tweak
    // one field must not demand re-typing every required field (BUG5).
    if (hasConfig && !status?.configured) {
      const missing = spec.fields.filter((f) => f.required && !filled[f.key]);
      if (missing.length > 0) {
        Message.warning(
          t('common.enterprise.ssoMissingFields', { defaultValue: '缺少必填字段' }) +
            ': ' +
            missing.map((f) => f.label).join(', ')
        );
        return;
      }
    }
    setSaving(true);
    try {
      await ipcBridge.oneAdmin.upsertSsoProvider.invoke({
        provider: spec.provider,
        input: { enabled, ...(hasConfig ? { config: filled } : {}) },
      });
      Message.success(t('common.enterprise.ssoSaved', { defaultValue: '已保存' }));
      setValues({});
      onSaved();
    } catch (e) {
      Message.error(
        t('common.enterprise.ssoSaveFailed', { defaultValue: '保存失败' }) + ': ' + friendlyEnterpriseError(e, t)
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='border border-border-2 rd-8px p-16px'>
      <div className='flex items-center justify-between mb-12px'>
        <div className='flex items-center gap-8px'>
          <span className='text-15px font-600'>{spec.title}</span>
          {status?.configured ? (
            <Tag color='green'>{t('common.enterprise.ssoConfigured', { defaultValue: '已配置' })}</Tag>
          ) : (
            <Tag color='gray'>{t('common.enterprise.ssoNotConfigured', { defaultValue: '未配置' })}</Tag>
          )}
        </div>
        <div className='flex items-center gap-8px'>
          <span className='text-t-secondary text-13px'>
            {t('common.enterprise.ssoEnabled', { defaultValue: '启用' })}
          </span>
          <Switch checked={enabled} onChange={setEnabled} />
        </div>
      </div>
      <div className='flex flex-col gap-8px'>
        {spec.fields.map((field) => {
          if (field.key === 'redirectUri') {
            const suggestion = suggestedRedirectUri(spec.provider);
            return (
              <div key={field.key} className='flex items-start gap-8px'>
                <span className='w-260px shrink-0 text-t-secondary text-13px mt-6px'>
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                <div className='flex-1 flex flex-col gap-4px'>
                  <div className='flex items-center gap-8px'>
                    <Input
                      className='flex-1'
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                    {suggestion ? (
                      <Button size='small' onClick={() => setValues((prev) => ({ ...prev, [field.key]: suggestion }))}>
                        {t('common.enterprise.ssoRedirectUriFillButton', { defaultValue: '填入建议地址' })}
                      </Button>
                    ) : null}
                  </div>
                  <span className='text-11px text-t-tertiary'>
                    {t('common.enterprise.ssoRedirectUriHint', {
                      provider: spec.provider,
                      defaultValue:
                        '回调路径固定为 /api/one/sso/{{provider}}/callback（不是 /api/auth/...），需在此和 OAuth 应用后台同时配置一致。',
                    })}
                  </span>
                </div>
              </div>
            );
          }
          return (
            <div key={field.key} className='flex items-center gap-8px'>
              <span className='w-260px shrink-0 text-t-secondary text-13px'>
                {field.label}
                {field.required ? ' *' : ''}
              </span>
              {field.secret ? (
                <Input.Password
                  value={values[field.key] ?? ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                  placeholder={t('common.enterprise.ssoSecretPlaceholder', {
                    defaultValue: '出于安全不回显，留空保持不变',
                  })}
                />
              ) : (
                <Input
                  value={values[field.key] ?? ''}
                  onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className='mt-12px flex justify-end'>
        <Button type='primary' loading={saving} onClick={handleSave}>
          {t('common.enterprise.ssoSaveButton', { defaultValue: '保存' })}
        </Button>
      </div>
    </div>
  );
};

const SsoSettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<SsoProviderConfig[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await ipcBridge.oneAdmin.listSsoProviders.invoke();
      setStatuses(data ?? []);
    } catch (e) {
      Message.error(
        t('common.enterprise.loadSsoFailed', { defaultValue: '加载 SSO 配置失败' }) +
          ': ' +
          friendlyEnterpriseError(e, t)
      );
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className='max-w-720px flex flex-col gap-16px'>
      <div className='text-t-secondary'>
        {t('common.enterprise.ssoHint', {
          defaultValue:
            '配置企业 SSO 登录（OAuth / LDAP）。保存后登录页会显示对应的 SSO 入口。密钥字段出于安全不回显，留空保持不变；其余字段会显示已保存的值。',
        })}
      </div>
      {PROVIDERS.map((spec) => (
        <ProviderCard
          key={spec.provider}
          spec={spec}
          status={statuses.find((s) => s.provider === spec.provider)}
          onSaved={() => void load()}
        />
      ))}
    </div>
  );
};

export default SsoSettingsTab;
