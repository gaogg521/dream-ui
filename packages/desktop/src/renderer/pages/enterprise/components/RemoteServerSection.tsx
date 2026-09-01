/**
 * Desktop-only "sign in to remote enterprise server" section.
 *
 * Enterprise client mode is local-first (see httpBridge D1): the co-located
 * dreamcore still serves conversations / agents / skills / personal data;
 * only enterprise GOVERNANCE (org / admin / sso / devops) is fetched from the
 * remote server with the Bearer token. The server ADDRESS *and* the connect
 * toggle both live in the "项目组部署模式" card on 设置 → 远程连接 now —
 * they used to be split across two pages (address here, connect toggle
 * there), which meant saving an address here silently did nothing until a
 * second page's switch was also found and flipped. This section only owns
 * the SSO login / logout lifecycle, an identity concern; it reads the
 * connect state to decide what to show, it does not own it.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Button, Message, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import '@/renderer/pages/settings/components/settings.css';
import {
  getEnterpriseServerUrl,
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
  setEnterpriseSession,
} from '@/common/adapter/enterpriseMode';
import { DEPLOYMENT_ROLE_CHANGED_EVENT } from '@/common/config/webuiEnterpriseConfig';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { openEnterpriseOAuthInBrowser } from '@/renderer/utils/enterprise/enterpriseBrowserLogin';
import type { SsoProviderStatus } from '@/common/types/org/orgTypes';

const SSO_PROVIDER_LABELS: Record<string, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
};

const reloadApp = (): void => {
  window.location.reload();
};

const RemoteServerSection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(isEnterpriseModeEnabled());
  const [ssoProviders, setSsoProviders] = useState<SsoProviderStatus[]>([]);
  const session = getEnterpriseSession();
  // Stable primitive for effect dependencies. `getEnterpriseSession()` JSON-parses
  // fresh each render and returns a NEW object reference every time, so it must
  // never be used directly as a useEffect dependency — that re-runs the effect on
  // every render. Depend on this boolean instead.
  const hasSession = Boolean(session);

  // The connect toggle lives on 设置 → 远程连接 now, in a different React
  // subtree, so `enabled` (and `session`, once SSO completes there) must be
  // refreshed from that page's own change event rather than local state alone.
  useEffect(() => {
    const handler = (): void => setEnabled(isEnterpriseModeEnabled());
    window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, handler);
  }, []);

  // Single source of truth for the address: the deployment-role config filled
  // in the "项目组部署模式" card on 设置 → 远程连接 (BUG1 — no second input here).
  const { normalizedServerUrl } = useDeploymentRole();
  const normalizedUrl = normalizedServerUrl ?? '';
  const urlValid = Boolean(normalizedServerUrl);

  // Probe the remote server for configured SSO providers so JIT-provisioned
  // users (random password — cannot use the password form) get a login path.
  useEffect(() => {
    if (!urlValid || hasSession) {
      // Return the SAME reference when already empty so this state update never
      // itself schedules a re-render. Combined with the `hasSession` primitive
      // dependency below, this prevents an infinite render loop that used to fire
      // whenever a remote session existed (new session object + new `[]` every
      // render), which starved React Router's transition-based navigation and
      // froze the entire UI on the settings page after logging in.
      setSsoProviders((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`${normalizedUrl}/api/one/sso/providers`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          });
          if (!response.ok) return;
          const json = (await response.json()) as { data?: SsoProviderStatus[] };
          if (!controller.signal.aborted) {
            setSsoProviders((json.data ?? []).filter((p) => p.enabled && p.configured && p.provider !== 'ldap'));
          }
        } catch {
          // Unreachable server / older backend — just hide the SSO row.
        }
      })();
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [normalizedUrl, urlValid, hasSession]);

  const handleSsoLogin = (provider: string) => {
    setEnterpriseServerUrl(normalizedUrl);
    void openEnterpriseOAuthInBrowser(provider as 'feishu' | 'dingtalk' | 'wecom', {
      remoteOrigin: normalizedUrl,
      redirect: '/settings/enterprise-identity',
    }).then((ok) => {
      if (ok) {
        Message.info(
          t('common.enterprise.remoteSsoOpened', {
            defaultValue: '已在浏览器打开授权页，完成登录后会自动返回并切换。',
          })
        );
      }
    });
  };

  const handleOpenBrowserLogin = () => {
    if (!urlValid) {
      Message.warning(
        t('common.enterprise.remoteUrlMissing', {
          defaultValue: '请先在「设置 → 远程连接」的「项目组部署模式」中填写服务器地址。',
        })
      );
      return;
    }
    setEnterpriseServerUrl(normalizedUrl);
    navigate(`/enterprise/login?remote=${encodeURIComponent(normalizedUrl)}`);
  };

  const handleLogout = () => {
    const current = getEnterpriseSession();
    if (current) {
      // Best-effort server-side blacklist; ignore failures.
      void fetch(`${normalizedUrl || getEnterpriseServerUrl() || ''}/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.token}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
    setEnterpriseSession(null);
    setEnterpriseModeEnabled(false);
    reloadApp();
  };

  // SSO login is deliberately available regardless of `enabled`: it is its
  // OWN way to reach the connected state, not gated behind it. The deep-link
  // callback (`useDeepLink.ts`'s `sso-callback` handler) calls
  // `setEnterpriseModeEnabled(true)` itself once the token comes back — that
  // is how "connected" has ever been reached via SSO. An earlier version of
  // this gate hid the whole login section behind `enabled`, which meant a
  // user who had typed an address but never touched the manual connect
  // toggle on 设置 → 远程连接 could no longer even start an SSO login to
  // begin with — the one path that would have turned `enabled` on for them.
  // `enabled` only changes what status this card reports and whether the
  // "已连接" banner shows; it must never hide the login affordance itself.
  return (
    <div className='border border-border-2 bg-bg-2 rd-8px p-16px mb-16px'>
      {enabled && (
        <Alert
          type='success'
          className='mb-12px'
          title={t('common.enterprise.remoteActiveTitle', { defaultValue: '已连接企业服务器' })}
          content={t('common.enterprise.remoteActiveHint', {
            defaultValue:
              '本机的会话、助手与个人数据照常使用；成员、邀请码、SSO 与团队资源来自企业服务器。若要仅用本机数据，请在「设置 → 远程连接」关闭连接。',
          })}
        />
      )}
      <div className='flex items-center gap-8px mb-8px'>
        <span className='text-15px font-600 text-t-primary'>
          {t('common.enterprise.remoteTitle', { defaultValue: '连接远端企业服务器' })}
        </span>
        {session ? (
          <Tag color='green'>
            {t('common.enterprise.remoteConnectedAs', {
              name: session.username,
              defaultValue: '已登录：{{name}}',
            })}
          </Tag>
        ) : enabled ? (
          <Tag color='orange'>{t('common.enterprise.remoteNotLoggedIn', { defaultValue: '未登录' })}</Tag>
        ) : (
          <Tag color='gray'>{t('common.enterprise.remoteDisabled', { defaultValue: '未启用' })}</Tag>
        )}
      </div>
      <div className='text-t-secondary text-13px mb-12px'>
        {t('common.enterprise.remoteHint', {
          defaultValue:
            '连接后，本机的会话/助手/个人数据仍在本地，仅企业治理（成员/邀请码/SSO/团队资源）来自企业服务器。企业 SSO（飞书/钉钉/LDAP 等）在浏览器完成登录，登录成功会自动切换为已连接。',
        })}
      </div>
      {!enabled && !session && (
        <div className='text-t-tertiary text-12px mb-12px'>
          {t('common.enterprise.remoteInviteJoinNeedsConnectHint', {
            defaultValue: '仅用邀请码加入项目组（不走 SSO）需要先在「设置 → 远程连接」手动打开连接开关。',
          })}
        </div>
      )}
      {urlValid && (
        <div className='text-t-secondary text-13px mb-12px'>
          {t('common.enterprise.remoteAdminUrlHint', {
            url: normalizedUrl,
            defaultValue: '企业管理后台与 API 同地址，浏览器访问：{{url}}',
          })}
        </div>
      )}
      {!session && (
        <div className='flex items-center gap-8px flex-wrap mt-4px'>
          <Button type='primary' onClick={handleOpenBrowserLogin}>
            {t('common.enterprise.remoteBrowserLoginButton', { defaultValue: '在浏览器登录企业账号' })}
          </Button>
          <span className='text-t-secondary text-12px'>
            {t('common.enterprise.remoteBrowserLoginHint', {
              defaultValue: '飞书、钉钉、LDAP 等 SSO 认证在浏览器完成，完成后自动返回客户端。',
            })}
          </span>
        </div>
      )}
      {!session && ssoProviders.length > 0 && (
        <div className='flex items-center gap-8px mt-8px'>
          <span className='w-100px shrink-0 text-t-primary text-13px'>
            {t('common.enterprise.remoteSsoLabel', { defaultValue: '企业 SSO' })}
          </span>
          {ssoProviders.map((p) => (
            <Button key={p.provider} onClick={() => handleSsoLogin(p.provider)}>
              {SSO_PROVIDER_LABELS[p.provider] ?? p.provider}
            </Button>
          ))}
        </div>
      )}
      {session && (
        <div className='flex justify-end'>
          <Button status='danger' onClick={handleLogout}>
            {t('common.enterprise.remoteLogoutButton', { defaultValue: '退出远端登录' })}
          </Button>
        </div>
      )}
    </div>
  );
};

export default RemoteServerSection;
