/**
 * SSO login section — browser/WebUI mode only.
 *
 * OAuth providers (feishu/dingtalk/wecom): fetch /api/one/sso/providers →
 * render a button per enabled+configured provider → click navigates the
 * SAME window to /api/one/sso/{provider}/authorize?redirect=/guid — the
 * backend 302s to the provider, and the OAuth callback Set-Cookies +
 * redirects back to /#/guid.
 *
 * LDAP is password-based, not OAuth: when enabled+configured it renders a
 * username/password form posting to /api/one/sso/ldap/login (Set-Cookie on
 * success), then AuthContext.refresh() picks up the session and LoginPage
 * navigates away.
 *
 * The desktop runtime skips auth entirely today (AuthContext treats
 * isDesktopRuntime as authenticated), so this renders nothing there —
 * desktop SSO arrives with enterprise remote mode (M4d).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../hooks/context/AuthContext';
import type { SsoProviderStatus } from '@/common/types/org/orgTypes';

const PROVIDER_LABELS: Record<string, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
};

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

const LoginSsoButtons: React.FC = () => {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const [providers, setProviders] = useState<SsoProviderStatus[]>([]);
  const [ldapOpen, setLdapOpen] = useState(false);
  const [ldapUsername, setLdapUsername] = useState('');
  const [ldapPassword, setLdapPassword] = useState('');
  const [ldapLoading, setLdapLoading] = useState(false);
  const [ldapError, setLdapError] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktopRuntime) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    void (async () => {
      try {
        const response = await fetch('/api/one/sso/providers', { signal: controller.signal });
        if (!response.ok) return;
        const json = (await response.json()) as { data?: SsoProviderStatus[] };
        setProviders((json.data ?? []).filter((p) => p.enabled && p.configured));
      } catch {
        // No SSO available (or non-dreamcore backend) — render nothing.
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  const oauthProviders = providers.filter((p) => p.provider !== 'ldap');
  const ldapAvailable = providers.some((p) => p.provider === 'ldap');

  const handleLdapSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = ldapUsername.trim();
    if (!username || !ldapPassword) {
      setLdapError(t('login.errors.empty', { defaultValue: '请输入用户名和密码' }));
      return;
    }
    setLdapLoading(true);
    setLdapError(null);
    try {
      const response = await fetch('/api/one/sso/ldap/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: ldapPassword }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        // Session cookie is set; refresh flips AuthContext to authenticated
        // and LoginPage navigates to /guid.
        await refresh();
      } else if (response.status === 401) {
        setLdapError(t('login.errors.invalidCredentials', { defaultValue: '用户名或密码错误' }));
      } else {
        setLdapError(t('login.errors.serverError', { defaultValue: '服务器错误，请稍后再试' }));
      }
    } catch {
      setLdapError(t('login.errors.networkError', { defaultValue: '网络错误，请稍后再试' }));
    } finally {
      setLdapLoading(false);
    }
  };

  if (isDesktopRuntime || providers.length === 0) {
    return null;
  }

  return (
    <div className='login-page__sso'>
      <div className='login-page__sso-divider'>
        <span>{t('login.ssoDivider', { defaultValue: '或使用企业账号登录' })}</span>
      </div>
      <div className='login-page__sso-buttons'>
        {oauthProviders.map((p) => (
          <button
            key={p.provider}
            type='button'
            className='login-page__sso-button'
            onClick={() => {
              window.location.href = `/api/one/sso/${p.provider}/authorize?redirect=${encodeURIComponent('/guid')}`;
            }}
          >
            {PROVIDER_LABELS[p.provider] ?? p.provider}
          </button>
        ))}
        {ldapAvailable ? (
          <button type='button' className='login-page__sso-button' onClick={() => setLdapOpen((prev) => !prev)}>
            {t('login.ldap.button', { defaultValue: 'LDAP 域账号' })}
          </button>
        ) : null}
      </div>
      {ldapAvailable && ldapOpen ? (
        <form className='login-page__sso-ldap-form' onSubmit={(event) => void handleLdapSubmit(event)}>
          <input
            className='login-page__input'
            name='ldap-username'
            autoComplete='username'
            placeholder={t('login.ldap.usernamePlaceholder', {
              defaultValue: '域账号（如 zhangsan 或 user@corp.com）',
            })}
            value={ldapUsername}
            onChange={(event) => setLdapUsername(event.target.value)}
          />
          <input
            className='login-page__input'
            name='ldap-password'
            type='password'
            autoComplete='current-password'
            placeholder={t('login.ldap.passwordPlaceholder', { defaultValue: '域密码' })}
            value={ldapPassword}
            onChange={(event) => setLdapPassword(event.target.value)}
          />
          <button type='submit' className='login-page__submit' disabled={ldapLoading}>
            {ldapLoading
              ? t('login.submitting', { defaultValue: '登录中…' })
              : t('login.ldap.submit', { defaultValue: 'LDAP 登录' })}
          </button>
          {ldapError ? (
            <div role='alert' className='login-page__message login-page__message--visible login-page__message--error'>
              {ldapError}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
};

export default LoginSsoButtons;
