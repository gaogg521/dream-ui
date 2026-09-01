/**
 * Enterprise login channel grid — desktop opens the system browser for every
 * channel (OAuth, LDAP, local). SSO configuration stays in the WebUI admin.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Message, Spin } from '@arco-design/web-react';
import { DataServer, HardDisk, Key } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import ChannelDingTalkLogo from '@renderer/assets/channel-logos/dingtalk.svg';
import ChannelFeishuLogo from '@renderer/assets/channel-logos/lark.svg';
import ChannelWecomLogo from '@renderer/assets/channel-logos/wecom.svg';
import type { SsoProviderStatus } from '@/common/types/org/orgTypes';
import { getLocalBaseUrl } from '@/common/adapter/httpBridge';
import {
  openEnterpriseOAuthInBrowser,
  openEnterprisePasswordLoginInBrowser,
  type OAuthProvider,
} from '@renderer/utils/enterprise/enterpriseBrowserLogin';
import styles from './EnterpriseLoginChannelPanel.module.css';

type LoginChannel = 'local' | 'ldap' | OAuthProvider;
type ChannelStatus = 'ready' | 'disabled' | 'not_configured' | 'pending';

type ChannelMeta = {
  id: LoginChannel;
  labelKey: string;
  labelDefault: string;
  icon: React.ReactNode;
};

type EnterpriseLoginChannelPanelProps = {
  /** Remote dreamcore origin when connecting as enterprise client. */
  remoteOrigin?: string | null;
  oauthRedirect?: string;
};

function resolveChannelStatus(channel: LoginChannel, providers: SsoProviderStatus[], loading: boolean): ChannelStatus {
  if (channel === 'local') return 'ready';
  if (loading) return 'pending';
  const row = providers.find((p) => p.provider === channel);
  if (!row) return 'not_configured';
  if (row.enabled && row.configured) return 'ready';
  if (row.configured) return 'disabled';
  return 'not_configured';
}

const EnterpriseLoginChannelPanel: React.FC<EnterpriseLoginChannelPanelProps> = ({
  remoteOrigin = null,
  oauthRedirect = '/settings/enterprise',
}) => {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<SsoProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    // Desktop renderer pages are file:// based, so a bare relative `/api/...`
    // fetch never reaches the co-located dreamcore (which listens on
    // http://127.0.0.1:{port}). Resolve against the backend origin: an explicit
    // remote server when connecting as an enterprise client, otherwise always
    // the LOCAL co-located backend (never an ambient remote-mode toggle that
    // has nothing to do with this specific login flow's caller intent).
    const origin = remoteOrigin?.replace(/\/+$/, '') || getLocalBaseUrl().replace(/\/+$/, '');
    const url = `${origin}/api/one/sso/providers`;

    void (async () => {
      setLoading(true);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) {
          setProviders([]);
          return;
        }
        const json = (await response.json()) as { data?: SsoProviderStatus[] };
        setProviders(json.data ?? []);
      } catch {
        setProviders([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [remoteOrigin]);

  const channels = useMemo<ChannelMeta[]>(
    () => [
      {
        id: 'feishu',
        labelKey: 'login.methods.feishu',
        labelDefault: '飞书账号',
        icon: <img src={ChannelFeishuLogo} alt='' className={styles.channelIconImg} />,
      },
      {
        id: 'dingtalk',
        labelKey: 'login.methods.dingtalk',
        labelDefault: '钉钉',
        icon: <img src={ChannelDingTalkLogo} alt='' className={styles.channelIconImg} />,
      },
      {
        id: 'wecom',
        labelKey: 'login.methods.wecom',
        labelDefault: '企业微信',
        icon: <img src={ChannelWecomLogo} alt='' className={styles.channelIconImg} />,
      },
      {
        id: 'oidc',
        labelKey: 'login.methods.oidc',
        labelDefault: '企业账号 (OIDC)',
        icon: <Key theme='filled' size={22} fill='#0ea5e9' />,
      },
      {
        id: 'ldap',
        labelKey: 'login.methods.ldap',
        labelDefault: 'LDAP 域控',
        icon: <DataServer theme='filled' size={22} fill='#6366f1' />,
      },
      {
        id: 'local',
        labelKey: 'login.methods.local',
        labelDefault: '本地账户',
        icon: <HardDisk theme='filled' size={22} fill='#64748b' />,
      },
    ],
    []
  );

  const channelLabel = useCallback((item: ChannelMeta) => t(item.labelKey, { defaultValue: item.labelDefault }), [t]);

  const showUnavailable = useCallback(
    (item: ChannelMeta) => {
      Message.warning(
        t('common.enterprise.loginChannelUnavailable', {
          defaultValue: '您的企业尚未开通 {{method}} 登录，请联系管理员或改用其他方式。',
          method: channelLabel(item),
        })
      );
    },
    [channelLabel, t]
  );

  const handleChannelClick = useCallback(
    async (item: ChannelMeta) => {
      const status = resolveChannelStatus(item.id, providers, loading);
      if (status === 'pending') return;
      if (status !== 'ready') {
        showUnavailable(item);
        return;
      }

      let ok = false;
      if (item.id === 'feishu' || item.id === 'dingtalk' || item.id === 'wecom' || item.id === 'oidc') {
        ok = await openEnterpriseOAuthInBrowser(item.id, { redirect: oauthRedirect, remoteOrigin });
        if (ok) {
          Message.info(
            t('common.enterprise.loginBrowserOpened', {
              defaultValue: '已在浏览器打开登录页，完成授权后返回本应用继续。',
            })
          );
        }
      } else {
        ok = await openEnterprisePasswordLoginInBrowser(oauthRedirect);
        if (ok) {
          Message.info(
            t('common.enterprise.loginBrowserOpenedPassword', {
              defaultValue: '已在浏览器打开登录页，请使用 {{method}} 完成登录。',
              method: channelLabel(item),
            })
          );
        }
      }

      if (!ok) {
        Message.warning(
          t('common.enterprise.loginWebuiRequired', {
            defaultValue: '无法打开浏览器登录页，请先在设置 → 远程连接 中启动 WebUI。',
          })
        );
      }
    },
    [channelLabel, loading, oauthRedirect, providers, remoteOrigin, showUnavailable, t]
  );

  return (
    <Spin loading={loading}>
      <div className={styles.channelGrid}>
        {channels.map((item) => {
          const status = resolveChannelStatus(item.id, providers, loading);
          return (
            <button
              key={item.id}
              type='button'
              className={styles.channelTile}
              disabled={status === 'pending' || status === 'not_configured'}
              onClick={() => void handleChannelClick(item)}
            >
              {item.icon}
              <span className={styles.channelLabel}>{channelLabel(item)}</span>
            </button>
          );
        })}
      </div>
      <p className={styles.hint}>
        {t('common.enterprise.loginBrowserHint', {
          defaultValue:
            '飞书、钉钉、企微将打开系统浏览器完成授权，LDAP 与本地账户在浏览器登录页完成。完成后返回本应用，在「企业」页加入团队。',
        })}
      </p>
    </Spin>
  );
};

export default EnterpriseLoginChannelPanel;
