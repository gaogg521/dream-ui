/**
 * Enterprise-org identity card — the caller's own SSO company identity
 * (provider / company / name / department / job title), sourced from the IdP
 * and INDEPENDENT of any project-group membership. Standalone so it can be
 * shown on its own settings page (`/settings/enterprise-identity`), separate
 * from the project-group settings (`/settings/enterprise`).
 */

import React from 'react';
import { Descriptions } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { getEnterpriseSession } from '@/common/adapter/enterpriseMode';
import { useEnterpriseIdentity } from '@renderer/pages/enterprise/hooks/useEnterpriseIdentity';

const ssoProviderLabelKey: Record<string, { key: string; fallback: string }> = {
  feishu: { key: 'common.enterprise.ssoProviderFeishu', fallback: '飞书' },
  dingtalk: { key: 'common.enterprise.ssoProviderDingtalk', fallback: '钉钉' },
  wecom: { key: 'common.enterprise.ssoProviderWecom', fallback: '企业微信' },
  ldap: { key: 'common.enterprise.ssoProviderLdap', fallback: 'LDAP' },
};

const EnterpriseIdentityCard: React.FC = () => {
  const { t } = useTranslation();
  const { identity, loading, error } = useEnterpriseIdentity();
  // The SSO session is the ground truth for "did this user authenticate via
  // company SSO". The `/me` identity (one-enterprise) only exists once a company
  // binding (Feishu tenant_key) was captured — which is a SEPARATE, optional
  // enrichment. So a present session with a null identity means "logged in via
  // SSO, but no company org info yet", NOT "not logged in".
  const session = getEnterpriseSession();

  if (loading) return null;

  if (!identity) {
    // Genuinely not logged in via SSO (no session at all).
    if (!session) {
      return (
        <div className='text-t-secondary text-14px'>
          {error
            ? t('common.enterprise.identityError', { defaultValue: '无法获取企业身份信息' })
            : t('common.enterprise.identityEmpty', {
                defaultValue: '尚未通过企业 SSO 登录，暂无企业身份信息。',
              })}
        </div>
      );
    }
    // Authenticated via SSO, but the company (org) dimension wasn't captured —
    // show the identity we DO have and be honest about the missing company,
    // instead of falsely claiming the user never logged in.
    return (
      <div className='max-w-560px'>
        <div className='text-t-secondary text-12px mb-12px'>
          {t('common.enterprise.orgIdentityHint', {
            defaultValue: '来自你的 SSO 登录身份，与项目组相互独立。',
          })}
        </div>
        <Descriptions
          column={1}
          border
          data={[
            {
              label: t('common.enterprise.orgIdentityStatus', { defaultValue: '认证状态' }),
              value: t('common.enterprise.orgIdentitySsoAuthed', { defaultValue: '已通过企业 SSO 登录' }),
            },
            {
              label: t('common.enterprise.fieldMyName', { defaultValue: '我的姓名' }),
              value: session.name ?? session.username,
            },
            {
              label: t('common.enterprise.orgIdentityCompany', { defaultValue: '所属企业' }),
              value: t('common.enterprise.orgIdentityCompanyMissing', {
                defaultValue: '未获取到企业组织信息（登录未返回企业标识）',
              }),
            },
          ]}
        />
      </div>
    );
  }

  const providerLabel = ssoProviderLabelKey[identity.provider] ?? null;

  return (
    <div className='max-w-560px'>
      <div className='text-t-secondary text-12px mb-12px'>
        {t('common.enterprise.orgIdentityHint', {
          defaultValue: '来自你的 SSO 登录身份，与项目组相互独立。',
        })}
      </div>
      <Descriptions
        column={1}
        border
        data={[
          {
            label: t('common.enterprise.orgIdentitySource', { defaultValue: '认证来源' }),
            value: providerLabel ? t(providerLabel.key, { defaultValue: providerLabel.fallback }) : identity.provider,
          },
          {
            label: t('common.enterprise.orgIdentityCompany', { defaultValue: '所属企业' }),
            value:
              identity.companyName ??
              identity.companyId ??
              t('common.enterprise.orgIdentityUnknownCompany', { defaultValue: '—' }),
          },
          {
            label: t('common.enterprise.fieldMyName', { defaultValue: '我的姓名' }),
            value: identity.displayName ?? '-',
          },
          {
            label: t('common.enterprise.fieldMyDepartment', { defaultValue: '我所在部门' }),
            value:
              identity.department ??
              t('common.enterprise.orgIdentityNeedsContacts', { defaultValue: '—（需飞书通讯录权限）' }),
          },
          {
            label: t('common.enterprise.fieldMyJobTitle', { defaultValue: '我的职位' }),
            value: identity.jobTitle ?? '-',
          },
        ]}
      />
    </div>
  );
};

export default EnterpriseIdentityCard;
