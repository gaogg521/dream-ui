/**
 * Enterprise server connection — the one decision this machine makes about
 * enterprise: whether it is connected to a company's One Work enterprise
 * server, and which one.
 *
 * This replaces the old "项目组部署模式" card. That card asked users to pick
 * "本机作为服务器 / 本机作为客户端", a choice that only existed while the
 * server shipped inside the desktop bundle. Hosting moved to the separate
 * enterprise edition, so every desktop install is a client: the server option
 * was permanently disabled yet still took the top of the page, and three
 * controls (role, address + save, connect switch) expressed one decision. Now
 * it is an address and a connect button; a saved address means nothing until
 * the probe passes and the connection is on.
 */

import React, { useEffect, useState } from 'react';
import { Alert, AutoComplete, Button, Modal, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { webui, type IWebUIStatus } from '@/common/adapter/ipcBridge';
import {
  getEnterpriseSession,
  isEnterpriseModeEnabled,
  setEnterpriseModeEnabled,
} from '@/common/adapter/enterpriseMode';
import { DEPLOYMENT_ROLE_CHANGED_EVENT, normalizeEnterpriseServerUrl } from '@/common/config/webuiEnterpriseConfig';
import {
  clearDeploymentServerUrlHistory,
  persistDeploymentServerUrl,
  useDeploymentRole,
} from '@renderer/hooks/enterprise/useDeploymentRole';
import { isElectronDesktop } from '@renderer/utils/platform';
import {
  resolveEnterpriseServer,
  type EnterpriseServerResolution,
  type LocalClientInfo,
} from '@renderer/utils/enterprise/probeEnterpriseServer';

declare global {
  interface Window {
    __backendPort?: number;
  }
}

/** This client's own addresses, so the probe can tell "you typed yourself". */
export async function readLocalClientInfo(): Promise<LocalClientInfo> {
  const status: IWebUIStatus | null = await webui.getStatus.invoke().catch((): null => null);
  return {
    lanIP: status?.lanIP ?? null,
    ports: [window.__backendPort, status?.port],
  };
}

/** User-facing explanation for a failed connect attempt. */
export function describeConnectFailure(
  failure: Pick<EnterpriseServerResolution, 'url' | 'reason'>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (failure.reason === 'self') {
    return t('common.enterprise.serverErrSelf', {
      url: failure.url,
      defaultValue:
        '{{url}} 是本机 One Work 客户端自己的地址，不是企业服务器。请填写管理员提供的企业版访问地址（浏览器打开企业管理后台用的那个）。',
    });
  }
  if (failure.reason === 'no-enterprise') {
    return t('common.enterprise.serverErrNoEnterprise', {
      url: failure.url,
      defaultValue:
        '{{url}} 能访问，但不是企业服务器（没有企业接口）。常见原因：填成了某台 One Work 客户端（包括本机）的地址，或对方还没部署企业版。',
    });
  }
  return t('common.enterprise.serverErrUnreachable', {
    url: failure.url,
    defaultValue:
      '连接不上 {{url}}。请确认地址与管理员给的一致、对方服务器已启动、两台电脑网络互通；企业版通常不需要填写端口。',
  });
}

const EnterpriseServerCard: React.FC = () => {
  const { t } = useTranslation();
  const { serverUrl: savedUrl, serverUrlHistory, refresh } = useDeploymentRole();
  const [connected, setConnected] = useState(isEnterpriseModeEnabled());
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setUrl(savedUrl);
  }, [savedUrl]);

  useEffect(() => {
    const sync = (): void => setConnected(isEnterpriseModeEnabled());
    window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, sync);
    return () => window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, sync);
  }, []);

  if (!isElectronDesktop()) return null;

  const handleConnect = async () => {
    setProblem(null);
    setNotice(null);
    const normalized = normalizeEnterpriseServerUrl(url);
    if (!normalized) {
      setProblem(
        t('common.enterprise.serverUrlInvalid', {
          defaultValue: '请输入有效的地址，例如 http://192.168.1.10 或 https://ai.example.com',
        })
      );
      return;
    }
    setConnecting(true);
    try {
      const result = await resolveEnterpriseServer(normalized, await readLocalClientInfo());
      if (!result.ok) {
        setProblem(describeConnectFailure(result, t));
        return;
      }
      await persistDeploymentServerUrl(result.url);
      setEnterpriseModeEnabled(true);
      setConnected(true);
      setEditing(false);
      if (result.adjustedFrom) {
        setNotice(
          t('common.enterprise.serverAdjusted', {
            typed: result.adjustedFrom,
            url: result.url,
            defaultValue: '{{typed}} 不是企业服务器入口，已自动改用 {{url}}。',
          })
        );
      }
      window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
      await refresh();
      // A remembered login for this server makes governance data come from it
      // right away; reload so every view re-reads from the new source.
      if (getEnterpriseSession()) window.location.reload();
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    Modal.confirm({
      title: t('common.enterprise.remoteDisableTitle', { defaultValue: '断开企业服务器' }),
      content: t('common.enterprise.remoteDisableHint', {
        defaultValue:
          '断开后企业成员/邀请码/团队资源将不再从服务器获取，本机个人数据不受影响。远端登录状态会保留，下次连接无需重新登录。',
      }),
      onOk: () => {
        setEnterpriseModeEnabled(false);
        window.dispatchEvent(new CustomEvent(DEPLOYMENT_ROLE_CHANGED_EVENT));
        window.location.reload();
      },
    });
  };

  const showForm = !connected || editing;

  return (
    <div className='px-[12px] md:px-[28px] py-14px bg-2 rd-16px mb-12px'>
      <div className='flex items-center gap-8px mb-4px'>
        <span className='text-14px font-600 text-t-primary'>
          {t('common.enterprise.serverCardTitle', { defaultValue: '企业服务器' })}
        </span>
        <Tag color={connected ? 'green' : 'gray'} size='small'>
          {connected
            ? t('common.enterprise.remoteEnabledShort', { defaultValue: '已连接' })
            : t('common.enterprise.serverNotConnected', { defaultValue: '未连接' })}
        </Tag>
      </div>
      <Typography.Paragraph type='secondary' className='text-12px mb-12px'>
        {t('common.enterprise.serverCardDesc', {
          defaultValue:
            '公司部署了 One Work 企业版时，连接后由企业服务器提供成员身份、项目组、企业登录与团队资源；本机的会话、助手和个人数据始终留在本地。没有企业服务器无需设置。',
        })}
      </Typography.Paragraph>

      {connected && !editing && (
        <div className='flex items-center justify-between gap-8px flex-wrap'>
          <span className='text-13px text-t-primary break-all'>
            {t('common.enterprise.serverConnectedTo', { url: savedUrl, defaultValue: '已连接：{{url}}' })}
          </span>
          <div className='flex items-center gap-8px'>
            <Button size='small' onClick={() => setEditing(true)}>
              {t('common.enterprise.serverChange', { defaultValue: '更换服务器' })}
            </Button>
            <Button size='small' status='danger' onClick={handleDisconnect}>
              {t('common.enterprise.serverDisconnect', { defaultValue: '断开连接' })}
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <div>
          <div className='flex items-center gap-8px'>
            {/* AutoComplete rather than Input: earlier addresses stay one
                click away instead of being retyped. */}
            <AutoComplete
              className='flex-1'
              value={url}
              onChange={setUrl}
              data={serverUrlHistory}
              placeholder={t('common.enterprise.serverUrlPlaceholder', {
                defaultValue: '例如 http://192.168.1.10 或 https://ai.example.com',
              })}
            />
            <Button type='primary' loading={connecting} onClick={() => void handleConnect()}>
              {t('common.enterprise.serverConnect', { defaultValue: '连接' })}
            </Button>
            {editing && (
              <Button
                onClick={() => {
                  setEditing(false);
                  setProblem(null);
                  setUrl(savedUrl);
                }}
              >
                {t('common.cancel', { defaultValue: '取消' })}
              </Button>
            )}
          </div>
          <div className='text-11px text-t-tertiary mt-4px'>
            {t('common.enterprise.serverUrlHint', {
              defaultValue:
                '填写管理员提供的企业版访问地址，也就是浏览器打开企业管理后台用的地址。一般不带端口；不要填 25808、25809 这类内部端口。',
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
              <Button size='mini' type='text' onClick={() => void clearDeploymentServerUrlHistory().then(refresh)}>
                {t('settings.webui.deployServerUrlHistoryClear', { defaultValue: '清空' })}
              </Button>
            </div>
          )}
        </div>
      )}

      {problem && <Alert type='error' className='mt-8px' content={problem} />}
      {notice && <Alert type='info' className='mt-8px' content={notice} />}
    </div>
  );
};

export default EnterpriseServerCard;
