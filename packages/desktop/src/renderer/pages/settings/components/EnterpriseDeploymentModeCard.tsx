/**
 * Enterprise deployment role — server vs client on the same desktop bundle.
 */

import React, { useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, Message, Modal, Radio, Switch, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { webui, type IWebUIStatus } from '@/common/adapter/ipcBridge';
import {
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
  setEnterpriseServerUrl,
} from '@/common/adapter/enterpriseMode';
import {
  DEPLOYMENT_ROLE_CHANGED_EVENT,
  normalizeEnterpriseServerUrl,
  type WebuiDeploymentRole,
} from '@/common/config/webuiEnterpriseConfig';
import { useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';
import {
  clearDeploymentServerUrlHistory,
  persistDeploymentRole,
  persistDeploymentServerUrl,
  useDeploymentRole,
} from '@renderer/hooks/enterprise/useDeploymentRole';
import { isElectronDesktop } from '@renderer/utils/platform';

type ConnectProbeResult = 'ok' | 'unreachable' | 'no-enterprise';

/** Same probe RemoteServerSection used to own — moved here so "type the
 * address" and "connect" are one action on one page instead of two. */
async function probeRemoteEnterpriseServer(baseUrl: string): Promise<ConnectProbeResult> {
  try {
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (!health.ok) return 'unreachable';
    const org = await fetch(`${baseUrl}/api/one/org/public-info`, { signal: AbortSignal.timeout(8000) });
    if (org.status === 404) return 'no-enterprise';
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

const reloadApp = (): void => {
  window.location.reload();
};

const EnterpriseDeploymentModeCard: React.FC = () => {
  const { t } = useTranslation();
  const { context } = useOrgContext();
  const { role: savedRole, serverUrl: savedUrl, serverUrlHistory, normalizedServerUrl, refresh } = useDeploymentRole();
  const [role, setRole] = useState<WebuiDeploymentRole>('client');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [webuiStatus, setWebuiStatus] = useState<IWebUIStatus | null>(null);
  // Reflects the actual routing flag (`isEnterpriseModeEnabled`), not just
  // whether an address is saved — those are deliberately two different
  // states (BUG: a saved address alone never made governance requests
  // actually reach the remote server, only this flag does).
  const [connected, setConnected] = useState(isEnterpriseModeEnabled());

  useEffect(() => {
    setRole(savedRole);
    setUrl(savedUrl);
  }, [savedRole, savedUrl]);

  useEffect(() => {
    if (!isElectronDesktop()) return;
    void webui.getStatus
      .invoke()
      .then(setWebuiStatus)
      .catch(() => setWebuiStatus(null));
  }, []);

  if (!isElectronDesktop()) return null;

  const handleConnectToggle = (next: boolean) => {
    if (!next) {
      Modal.confirm({
        title: t('common.enterprise.remoteDisableTitle', { defaultValue: '断开企业服务器' }),
        content: t('common.enterprise.remoteDisableHint', {
          defaultValue:
            '断开后企业成员/邀请码/团队资源将不再从服务器获取，本机个人数据不受影响。远端登录状态会保留，下次连接无需重新登录。',
        }),
        onOk: () => {
          setEnterpriseModeEnabled(false);
          window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
          reloadApp();
        },
      });
      return;
    }
    if (!normalizedServerUrl) {
      Message.warning(
        t('settings.webui.deployServerUrlInvalid', {
          defaultValue: '请先填写并保存服务器地址',
        })
      );
      return;
    }
    Modal.confirm({
      title: t('common.enterprise.remoteEnableTitle', { defaultValue: '连接企业服务器' }),
      content: t('common.enterprise.remoteEnableWarning', {
        defaultValue:
          '连接后，成员、邀请码、SSO 与团队资源将来自企业服务器；本机的会话、助手与个人数据仍在本地，服务器离线也可继续使用。请确认对方已部署带企业模块的 One Work / 1oneCore（v2.1.32+），地址为对方 WebUI 访问地址。',
      }),
      onOk: async () => {
        setConnecting(true);
        try {
          const probe = await probeRemoteEnterpriseServer(normalizedServerUrl);
          if (probe === 'no-enterprise') {
            Message.error(
              t('common.enterprise.remoteEnterpriseNoModule', {
                defaultValue:
                  '远端服务器未提供企业 API（/api/one/*）。请确认对方运行的是带企业模块的 One Work，而不是旧版或仅静态 WebUI。',
              })
            );
            throw new Error('remote enterprise API missing');
          }
          if (probe === 'unreachable') {
            Message.error(
              t('common.enterprise.remoteEnterpriseUnreachable', {
                defaultValue: '无法连接远端服务器，请检查地址、端口与防火墙后重试。',
              })
            );
            throw new Error('remote enterprise unreachable');
          }
          setEnterpriseServerUrl(normalizedServerUrl);
          setEnterpriseModeEnabled(true);
          setConnected(true);
          window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
          if (getEnterpriseSession()) {
            reloadApp();
          }
        } finally {
          setConnecting(false);
        }
      },
    });
  };

  const hasLocalEnterprise = Boolean(context?.isEnterprise);
  const reachableServerAddress =
    webuiStatus?.running && webuiStatus.allowRemote && webuiStatus.lanIP
      ? `http://${webuiStatus.lanIP}:${webuiStatus.port}`
      : null;

  // Role and server address are persisted independently: switching the role
  // must never wipe the address the user typed (it stays available in client
  // mode and in the address history).
  const applyRole = async (nextRole: WebuiDeploymentRole) => {
    setSaving(true);
    try {
      await persistDeploymentRole(nextRole);
      await refresh();
      setRole(nextRole);
      Message.success(t('settings.webui.deploySaved', { defaultValue: '已保存部署模式' }));
    } catch {
      Message.error(t('settings.webui.deploySaveFailed', { defaultValue: '保存失败' }));
      setRole(savedRole);
    } finally {
      setSaving(false);
    }
  };

  // Apply the role from the toggle itself (after confirming, where the switch
  // has consequences) so the whole enterprise page stays in one consistent
  // state: the remote-connection card and the create/join tabs all key off the
  // persisted role, which changes here. The previous "select radio, then click
  // Save" flow left the page in a confusing limbo where the radio previewed one
  // role but everything else still showed the old one. The server address is no
  // longer required just to *become* a client — it's entered/connected
  // afterwards.
  const handleRoleChange = (next: WebuiDeploymentRole) => {
    if (next === savedRole) {
      setRole(next);
      return;
    }
    setRole(next);
    if (next === 'client' && hasLocalEnterprise) {
      Modal.confirm({
        title: t('settings.webui.demoteConfirmTitle', { defaultValue: '切换为客户端？' }),
        content: t('settings.webui.demoteConfirmDesc', {
          defaultValue:
            '本机当前托管项目组数据。切换为客户端后，请在「项目组」页退出项目组，并改用远端服务器地址登录。',
        }),
        onOk: () => void applyRole('client'),
        onCancel: () => setRole(savedRole),
      });
      return;
    }
    // Server/client are mutually exclusive by design (D3: one server = one
    // enterprise). A client that has joined an enterprise (locally hosted, or
    // via an active remote connection — both surface as `context.isEnterprise`)
    // must leave it first; otherwise flipping to "server" here would silently
    // drop that membership with no way back short of re-joining.
    if (next === 'server' && savedRole === 'client' && hasLocalEnterprise) {
      Modal.warning({
        title: t('settings.webui.switchToServerBlockedTitle', { defaultValue: '暂时无法切换为服务器' }),
        content: t('settings.webui.switchToServerBlockedDesc', {
          defaultValue:
            '您当前的模式是客户端，且已加入项目组。如需切换为服务器，请先在「项目组」页退出当前加入的项目组。',
        }),
      });
      setRole(savedRole);
      return;
    }
    // Becoming the server is a mode change with visible consequences (the
    // machine starts hosting project-group data and the remote connection is
    // dropped), so it gets its own confirmation instead of applying silently
    // the instant the radio is touched.
    if (next === 'server') {
      Modal.confirm({
        title: t('settings.webui.promoteConfirmTitle', { defaultValue: '切换为服务器？' }),
        content: t('settings.webui.promoteConfirmDesc', {
          defaultValue:
            '本机将作为项目组服务器托管项目组数据，并断开与远端服务器的连接。已填写的服务器地址会保留在历史记录中，切回客户端时可直接选用。',
        }),
        onOk: () => void applyRole('server'),
        onCancel: () => setRole(savedRole),
      });
      return;
    }
    void applyRole(next);
  };

  // Client mode only: persist the entered server address.
  const handleSaveUrl = async () => {
    if (!normalizeEnterpriseServerUrl(url)) {
      Message.warning(
        t('settings.webui.deployServerUrlInvalid', {
          defaultValue: '请输入有效的服务器地址，例如 192.168.1.10:25809',
        })
      );
      return;
    }
    setSaving(true);
    try {
      await persistDeploymentServerUrl(url);
      await refresh();
      Message.success(t('settings.webui.deploySaved', { defaultValue: '已保存部署模式' }));
    } catch {
      Message.error(t('settings.webui.deploySaveFailed', { defaultValue: '保存失败' }));
    } finally {
      setSaving(false);
    }
  };

  const handleClearHistory = () => {
    Modal.confirm({
      title: t('settings.webui.deployServerUrlHistoryClearTitle', { defaultValue: '清空地址历史记录？' }),
      content: t('settings.webui.deployServerUrlHistoryClearDesc', {
        defaultValue: '仅清除历史记录列表，当前已保存的服务器地址不受影响。',
      }),
      onOk: async () => {
        await clearDeploymentServerUrlHistory();
        await refresh();
      },
    });
  };

  return (
    <div className='px-[12px] md:px-[28px] py-14px bg-2 rd-16px mb-12px'>
      <div className='text-14px font-600 text-t-primary mb-4px'>
        {t('settings.webui.deployModeTitle', { defaultValue: '项目组部署模式' })}
      </div>
      <Typography.Paragraph type='secondary' className='text-12px mb-12px'>
        {t('settings.webui.deployModeDesc', {
          defaultValue:
            '同一局域网内应只有一台作为服务器，其余均为客户端连接到它。默认本机为客户端；创建项目组后本机自动成为服务器，托管项目组数据。',
        })}
      </Typography.Paragraph>
      <Radio.Group
        type='button'
        value={role}
        onChange={(v) => handleRoleChange(v as WebuiDeploymentRole)}
        disabled={saving}
        className='mb-12px enterprise-deploy-role'
      >
        <Radio value='server'>{t('settings.webui.deployRoleServer', { defaultValue: '本机作为服务器' })}</Radio>
        <Radio value='client'>{t('settings.webui.deployRoleClient', { defaultValue: '本机作为客户端' })}</Radio>
      </Radio.Group>
      {role === 'client' ? (
        <div className='mb-12px'>
          <div className='text-12px text-t-secondary mb-4px'>
            {t('settings.webui.deployServerUrlLabel', { defaultValue: '项目组服务器地址' })}
          </div>
          {/* AutoComplete (not a plain Input) so previously used addresses are
              one click away — LAN host:port strings are tedious and error-prone
              to retype, and a role switch used to leave the field empty. */}
          <AutoComplete
            value={url}
            onChange={setUrl}
            data={serverUrlHistory}
            placeholder={t('settings.webui.deployServerUrlPlaceholder', {
              defaultValue: '例如 192.168.1.10:25809',
            })}
          />
          <div className='text-11px text-t-tertiary mt-4px'>
            {t('settings.webui.deployServerUrlHint', {
              defaultValue: '请填写含端口的完整地址（服务端端口可在服务器 WebUI 设置中查看）',
            })}
          </div>
          {serverUrlHistory.length > 0 && (
            <div className='flex items-center gap-8px flex-wrap mt-6px'>
              <span className='text-11px text-t-tertiary'>
                {t('settings.webui.deployServerUrlHistoryLabel', { defaultValue: '历史地址' })}
              </span>
              {serverUrlHistory.map((item) => (
                <Button key={item} size='mini' onClick={() => setUrl(item)}>
                  {item}
                </Button>
              ))}
              <Button size='mini' type='text' onClick={handleClearHistory}>
                {t('settings.webui.deployServerUrlHistoryClear', { defaultValue: '清空' })}
              </Button>
            </div>
          )}
          <div className='mt-8px flex items-center gap-8px'>
            <Button type='primary' size='small' loading={saving} onClick={() => void handleSaveUrl()}>
              {t('settings.webui.deploySaveAddress', { defaultValue: '保存地址' })}
            </Button>
          </div>
          {/* Connect toggle — moved here from the 企业身份 page (BUG: saving an
              address here never made anything actually route to it; only this
              flag does, and it used to live behind a second, disconnected
              settings page). Address + connect are now one action on one page. */}
          <div className='mt-12px pt-12px border-t border-line'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-8px'>
                <span className='text-13px font-600 text-t-primary'>
                  {t('common.enterprise.remoteTitle', { defaultValue: '连接远端企业服务器' })}
                </span>
                <Tag color={connected ? 'green' : 'gray'} size='small'>
                  {connected
                    ? t('common.enterprise.remoteEnabledShort', { defaultValue: '已连接' })
                    : t('common.enterprise.remoteDisabled', { defaultValue: '未启用' })}
                </Tag>
              </div>
              <Switch
                className='settings-switch-on'
                checked={connected}
                loading={connecting}
                onChange={handleConnectToggle}
              />
            </div>
            <div className='text-11px text-t-tertiary mt-4px'>
              {t('common.enterprise.remoteCardHint', {
                defaultValue: '连接后才能用邀请码加入该服务器上的项目组，或前往「企业身份」页做 SSO 登录。',
              })}
            </div>
          </div>
          <Alert
            type='info'
            className='mt-8px'
            content={t('settings.webui.deployClientHint', {
              defaultValue: '客户端模式下，企业 SSO 与后台管理均在远端服务器浏览器完成，本机不显示项目组管理后台入口。',
            })}
          />
        </div>
      ) : (
        <Alert
          type='info'
          className='mb-12px'
          content={
            <div className='flex flex-col gap-4px'>
              <span>
                {t('settings.webui.deployServerHint', {
                  defaultValue: '本机作为项目组服务器，局域网内其他客户端可连接到本机地址。',
                })}
              </span>
              {reachableServerAddress ? (
                <span className='font-600'>
                  {t('settings.webui.deployServerAddressLabel', {
                    url: reachableServerAddress,
                    defaultValue: '其他客户端请填写地址：{{url}}',
                  })}
                </span>
              ) : (
                <span>
                  {t('settings.webui.deployServerAddressUnavailable', {
                    defaultValue:
                      '尚未开启可供局域网访问的 WebUI，其他客户端暂时无法连接。请先在设置 → WebUI 中启用并允许远程访问。',
                  })}
                </span>
              )}
            </div>
          }
        />
      )}
    </div>
  );
};

export default EnterpriseDeploymentModeCard;
