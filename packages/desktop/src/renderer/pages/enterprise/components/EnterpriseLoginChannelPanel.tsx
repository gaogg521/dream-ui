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

  /**
   * Why the SSO channels are unavailable, or `null` when they are usable.
   *
   * Without a remote origin this panel queries the LOCAL co-located dreamcore
   * (see the fetch above), which is a personal-edition backend and has no SSO
   * configured — so every channel reads as unconfigured. That is a completely
   * different fix from "the admin hasn't enabled it on the server", and the
   * panel used to present both as the same silent grey tile.
   */
  const unavailableReason = useMemo<'not_connected' | 'not_configured_on_server' | null>(() => {
    if (loading) return null;
    if (!remoteOrigin) return 'not_connected';
    const anyUsable = providers.some((p) => p.enabled && p.configured);
    return anyUsable ? null : 'not_configured_on_server';
  }, [loading, providers, remoteOrigin]);

  const showUnavailable = useCallback(
    (item: ChannelMeta) => {
      if (unavailableReason === 'not_connected') {
        Message.warning(
          t('common.enterprise.loginChannelNeedsServer', {
            defaultValue:
              '尚未连接企业服务器，本机没有企业 SSO 配置。请先回到第一步填写并连接项目组服务器地址，再用 {{method}} 登录。',
            method: channelLabel(item),
          })
        );
        return;
      }
      Message.warning(
        t('common.enterprise.loginChannelUnavailable', {
          defaultValue: '您的企业尚未开通 {{method}} 登录，请联系管理员或改用其他方式。',
          method: channelLabel(item),
        })
      );
    },
    [channelLabel, t, unavailableReason]
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
        // remoteOrigin must ride along: without it the password-class channels
        // fell back to the LOCAL WebUI login even when connected to a remote
        // server — the browser logged into the wrong backend entirely.
        ok = await openEnterprisePasswordLoginInBrowser(oauthRedirect, { remoteOrigin });
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
          const unavailable = status === 'not_configured' || status === 'disabled';
          return (
            <button
              key={item.id}
              type='button'
              className={`${styles.channelTile} ${unavailable ? styles.channelTileUnavailable : ''}`}
              // Only `pending` is truly non-interactive. An unconfigured
              // channel stays clickable so the click can explain itself —
              // disabling it here is what made the reason unreachable. The
              // badge says WHY it looks grey up front (E5): same visual
              // state as actual interactivity, click still explains.
              disabled={status === 'pending'}
              onClick={() => void handleChannelClick(item)}
            >
              {unavailable && (
                <span className={styles.channelBadge}>
                  {status === 'disabled'
                    ? t('common.enterprise.channelDisabledBadge', { defaultValue: '已停用' })
                    : t('common.enterprise.channelNotConfiguredBadge', { defaultValue: '未配置' })}
                </span>
              )}
              {item.icon}
              <span className={styles.channelLabel}>{channelLabel(item)}</span>
            </button>
          );
        })}
      </div>
      {unavailableReason ? (
        <div className={styles.reason}>
          {unavailableReason === 'not_connected'
            ? t('common.enterprise.loginChannelsNeedServerHint', {
                defaultValue:
                  '企业 SSO 登录方式来自你所连接的企业服务器。当前尚未连接，因此下方仅「本地账户」可用——请回到第一步填写并连接项目组服务器地址。',
              })
            : t('common.enterprise.loginChannelsNoneConfiguredHint', {
                defaultValue: '已连接企业服务器，但管理员尚未在企业管理后台启用任何 SSO 登录方式。可先用「本地账户」登录。',
              })}
        </div>
      ) : null}
      <p className={styles.hint}>
        {t('common.enterprise.loginBrowserHint', {
          defaultValue: '登录在系统浏览器中完成，完成后返回本应用，继续加入项目组。',
        })}
      </p>
    </Spin>
  );
};

export default EnterpriseLoginChannelPanel;
