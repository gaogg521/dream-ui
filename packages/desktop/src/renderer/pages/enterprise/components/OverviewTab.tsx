/**
 * Enterprise overview tab — membership info for enterprise members,
 * join / create forms for personal-mode users, exit flow for members.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Divider, Input, Message, Modal, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';
import { webui } from '@/common/adapter/ipcBridge';
import { getEnterpriseServerUrl, isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import { DEPLOYMENT_ROLE_CHANGED_EVENT } from '@/common/config/webuiEnterpriseConfig';
import { openExternalUrl } from '@/renderer/utils/platform';
import { clearTeamResources } from '@renderer/utils/enterprise/teamSkillSync';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { ORG_CONTEXT_CHANGED_EVENT } from '@renderer/pages/enterprise/hooks/useOrgContext';
import type { OrgContext } from '@/common/types/org/orgTypes';

const resolveLocalAdminUrl = async (): Promise<string> => {
  try {
    const status = await webui.getStatus.invoke();
    if (status?.running && status.localUrl) {
      return status.localUrl.replace(/\/+$/, '');
    }
  } catch {
    // fall through
  }
  return `http://127.0.0.1:${WEBUI_DEFAULT_PORT}`;
};

type OverviewTabProps = {
  context: OrgContext | null;
  error: string | null;
  onChanged: () => void;
};

const roleLabelKey: Record<string, { key: string; fallback: string }> = {
  system_admin: { key: 'common.enterprise.roleSystemAdmin', fallback: '系统管理员' },
  org_admin: { key: 'common.enterprise.roleOrgAdmin', fallback: '组织管理员' },
  member: { key: 'common.enterprise.roleMember', fallback: '成员' },
};

const OverviewTab: React.FC<OverviewTabProps> = ({ context, error, onChanged }) => {
  const { t } = useTranslation();
  const {
    isClient: isDeploymentClient,
    isServer: isDeploymentServer,
    loading: deploymentLoading,
  } = useDeploymentRole();
  const hideLocalAdmin = !deploymentLoading && isDeploymentClient;
  // Role decides the action: a client joins an existing enterprise; a server
  // hosts (creates) one. Never show both — that confused users into thinking
  // a server could also "join" itself.
  const showJoinEnterprise = !deploymentLoading && isDeploymentClient;
  const showCreateEnterprise = !deploymentLoading && isDeploymentServer;
  const [inviteCode, setInviteCode] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showResetPrompt, setShowResetPrompt] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [exitVisible, setExitVisible] = useState(false);
  const [exitCode, setExitCode] = useState('');
  const [exiting, setExiting] = useState(false);

  const [adminConsoleUrl, setAdminConsoleUrl] = useState('');

  useEffect(() => {
    // `disposed` guards the async branch: when hideLocalAdmin flips true (e.g.
    // deployment role resolves to client after an initial loading render), the
    // cleanup cancels the in-flight resolveLocalAdminUrl() so its late result
    // can't overwrite the '' we just set — otherwise a client leaks the local
    // admin console URL it should never show.
    let disposed = false;

    const resolve = () => {
      if (hideLocalAdmin) {
        // Client: never show the LOCAL admin console. Once actually connected
        // to a remote server, THAT is the admin console to link to (BUG: this
        // branch used to be unreachable because the `hideLocalAdmin` check
        // above always returned first for every client, connected or not —
        // a client who had joined a remote enterprise had no way to reach its
        // admin backend from this page). Before connecting there is nothing
        // to link to yet.
        setAdminConsoleUrl(isEnterpriseModeEnabled() ? (getEnterpriseServerUrl() ?? '') : '');
        return;
      }
      void resolveLocalAdminUrl().then((url) => {
        if (!disposed) setAdminConsoleUrl(url);
      });
    };

    resolve();
    // The connect toggle lives on a different settings surface and only
    // triggers a full reload when a session already exists — re-resolve on
    // its change event so a client that connects and then joins within the
    // same mount picks up the remote admin URL without needing a reload.
    window.addEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, resolve);
    return () => {
      disposed = true;
      window.removeEventListener(DEPLOYMENT_ROLE_CHANGED_EVENT, resolve);
    };
  }, [hideLocalAdmin]);

  const handleJoin = async () => {
    const code = inviteCode.trim();
    if (!code) {
      Message.warning(t('common.enterprise.inviteCodeRequired', { defaultValue: '请输入邀请码' }));
      return;
    }
    // A client that hasn't flipped the connect toggle on 设置 → 远程连接 has
    // `isEnterpriseModeEnabled()` false, which makes httpBridge route this
    // governance call LOCALLY (see GOVERNANCE_PATH_PREFIXES) instead of to the
    // remote server the invite code actually belongs to — the join would
    // silently hit the wrong backend and fail with a confusing "invalid code"
    // instead of the real problem. Block it here with the actual instruction.
    if (!isEnterpriseModeEnabled()) {
      Message.warning(
        t('common.enterprise.remoteInviteJoinNeedsConnectHint', {
          defaultValue: '仅用邀请码加入项目组（不走 SSO）需要先在「设置 → 远程连接」手动打开连接开关。',
        })
      );
      return;
    }
    setJoining(true);
    try {
      const tenant = await ipcBridge.oneOrg.join.invoke({ code });
      Message.success(
        t('common.enterprise.joinSuccess', {
          name: tenant?.tenantName ?? '',
          defaultValue: '已加入企业 {{name}}',
        })
      );
      setInviteCode('');
      onChanged();
      window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
    } catch (e) {
      // The join may have actually succeeded even though this call threw:
      //  - ALREADY_IN_ENTERPRISE: SSO JIT already provisioned membership, or a
      //    duplicate/racing request whose first hit already joined us.
      //  - INVALID_CODE: a single-use invite the first hit already consumed.
      // Re-check context: if we're now in an enterprise the join effectively
      // worked — surface "already joined" and refresh so the stale form flips
      // to the membership view instead of a scary red error. A genuinely bad
      // code leaves us outside any enterprise, so real errors still show.
      const alreadyMember = isBackendHttpError(e) && (e.code === 'ALREADY_IN_ENTERPRISE' || e.code === 'INVALID_CODE');
      if (alreadyMember) {
        try {
          const ctx = await ipcBridge.oneOrg.context.invoke();
          if (ctx?.isEnterprise) {
            Message.info(t('common.enterprise.joinAlready', { defaultValue: '您已加入该企业' }));
            setInviteCode('');
            onChanged();
            window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
            return;
          }
        } catch {
          // Context re-check failed — fall through to the normal error path.
        }
      }
      Message.error(t('common.enterprise.joinFailed', { defaultValue: '加入失败' }) + ': ' + String(e));
    } finally {
      setJoining(false);
    }
  };

  const handleCreate = async () => {
    const name = tenantName.trim();
    if (!name) {
      Message.warning(t('common.enterprise.tenantNameRequired', { defaultValue: '请输入企业名称' }));
      return;
    }
    setCreating(true);
    setShowResetPrompt(false);
    try {
      const tenant = await ipcBridge.oneOrg.create.invoke({ name });
      const { markDeploymentAsServer } = await import('@renderer/hooks/enterprise/useDeploymentRole');
      await markDeploymentAsServer();
      Message.success(
        t('common.enterprise.createSuccess', {
          name: tenant?.tenantName ?? name,
          defaultValue: '已创建企业 {{name}}',
        })
      );
      setTenantName('');
      onChanged();
      window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'ALREADY_HOSTS_ENTERPRISE') {
        setShowResetPrompt(true);
      } else {
        Message.error(t('common.enterprise.createFailed', { defaultValue: '创建失败' }) + ': ' + String(e));
      }
    } finally {
      setCreating(false);
    }
  };

  const handleResetLocal = () => {
    Modal.confirm({
      title: t('common.enterprise.resetLocalConfirmTitle', { defaultValue: '重置本机企业数据？' }),
      content: t('common.enterprise.resetLocalConfirmDesc', {
        defaultValue:
          '本机保留有历史企业数据，会归档到本地文件后清空，本机之前记录的企业成员关系将全部作废。如果这台机器正在被其他人当作真正的企业服务器使用，请不要继续。',
      }),
      onOk: async () => {
        setResetting(true);
        try {
          await ipcBridge.oneOrg.resetLocal.invoke();
          Message.success(t('common.enterprise.resetLocalSuccess', { defaultValue: '已重置本机企业数据' }));
          setShowResetPrompt(false);
          onChanged();
        } catch (e) {
          Message.error(t('common.enterprise.resetLocalFailed', { defaultValue: '重置失败' }) + ': ' + String(e));
        } finally {
          setResetting(false);
        }
      },
    });
  };

  const handleExit = async () => {
    setExiting(true);
    try {
      await ipcBridge.oneOrg.exit.invoke({ exitCode: exitCode.trim() });
      // D2: purge locally-materialized team skills / MCP so the departing
      // member's agent stops auto-loading enterprise resources. Best-effort.
      await clearTeamResources();
      Message.success(t('common.enterprise.exitSuccess', { defaultValue: '已退出企业' }));
      setExitVisible(false);
      setExitCode('');
      onChanged();
      window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
    } catch (e) {
      if (isBackendHttpError(e) && e.code === 'LAST_ADMIN_CANNOT_LEAVE') {
        Message.error(
          t('common.enterprise.exitLastAdmin', {
            defaultValue: '您是当前唯一的管理员，请先将至少一名成员提升为管理员，再退出企业。',
          })
        );
        return;
      }
      Message.error(t('common.enterprise.exitFailed', { defaultValue: '退出失败' }) + ': ' + String(e));
    } finally {
      setExiting(false);
    }
  };

  if (error) {
    return (
      <Alert
        type='error'
        title={t('common.enterprise.contextError', { defaultValue: '无法获取企业信息' })}
        content={error}
      />
    );
  }

  if (!context) {
    return null;
  }

  if (context.isEnterprise) {
    const role = roleLabelKey[context.role] ?? roleLabelKey.member;
    // Deep-link straight to the admin backend route. Without the hash the
    // WebUI root redirects to /guid (the member's own chat), which is why the
    // bare base URL looked like "the user's own web interface".
    const adminConsoleHref = adminConsoleUrl ? `${adminConsoleUrl.replace(/\/+$/, '')}/#/enterprise/console` : '';

    const descData: { label: string; value: React.ReactNode }[] = [
      { label: t('common.enterprise.fieldTenantName', { defaultValue: '企业名称' }), value: context.tenantName ?? '-' },
      { label: t('common.enterprise.fieldTenantId', { defaultValue: '企业 ID' }), value: context.tenantId },
    ];
    descData.push({
      label: t('common.enterprise.fieldRole', { defaultValue: '我的角色' }),
      value: (
        <Tag color={context.role === 'member' ? 'gray' : 'arcoblue'}>
          {t(role.key, { defaultValue: role.fallback })}
        </Tag>
      ),
    });
    descData.push({
      label: t('common.enterprise.fieldMemberCount', { defaultValue: '成员数' }),
      value: String(context.memberCount),
    });
    return (
      <div className='max-w-560px'>
        {adminConsoleHref ? (
          <Alert
            type='info'
            className='mb-16px'
            title={t('common.enterprise.adminConsoleTitle', { defaultValue: '企业管理后台' })}
            content={
              <div className='flex flex-col gap-8px'>
                <span>
                  {t('common.enterprise.adminConsoleHint', {
                    defaultValue: '在浏览器打开以下地址可管理邀请码、成员、SSO 等（需使用管理员账号登录 WebUI）：',
                  })}
                </span>
                <Button
                  type='text'
                  className='!p-0 !h-auto !text-left'
                  onClick={() => void openExternalUrl(adminConsoleHref)}
                >
                  {adminConsoleHref}
                </Button>
              </div>
            }
          />
        ) : null}
        <Descriptions column={1} border data={descData} />
        <Divider />
        <Button status='danger' onClick={() => setExitVisible(true)}>
          {t('common.enterprise.exitButton', { defaultValue: '退出企业' })}
        </Button>
        <Modal
          title={t('common.enterprise.exitTitle', { defaultValue: '退出企业' })}
          visible={exitVisible}
          onCancel={() => setExitVisible(false)}
          onOk={handleExit}
          confirmLoading={exiting}
          maskClosable={false}
        >
          <div className='mb-8px text-t-secondary'>
            {t('common.enterprise.exitHint', {
              defaultValue: '退出后将回到个人模式。若管理员设置了退出口令，请输入：',
            })}
          </div>
          <Input.Password
            value={exitCode}
            onChange={setExitCode}
            placeholder={t('common.enterprise.exitCodePlaceholder', { defaultValue: '退出口令（未设置可留空）' })}
          />
        </Modal>
      </div>
    );
  }

  return (
    <div className='max-w-560px flex flex-col gap-24px'>
      {showJoinEnterprise && (
        <div>
          <div className='text-15px font-600 text-t-primary mb-8px'>
            {t('common.enterprise.joinTitle', { defaultValue: '加入企业' })}
          </div>
          <div className='text-t-secondary mb-12px'>
            {t('common.enterprise.joinHint', { defaultValue: '输入管理员提供的邀请码加入企业。' })}
          </div>
          {!isEnterpriseModeEnabled() && (
            <Alert
              type='warning'
              className='mb-12px'
              content={t('common.enterprise.remoteInviteJoinNeedsConnectHint', {
                defaultValue: '仅用邀请码加入项目组（不走 SSO）需要先在「设置 → 远程连接」手动打开连接开关。',
              })}
            />
          )}
          <div className='flex gap-8px'>
            <Input
              value={inviteCode}
              onChange={setInviteCode}
              placeholder={t('common.enterprise.inviteCodePlaceholder', { defaultValue: '邀请码' })}
              style={{ maxWidth: 240 }}
            />
            <Button type='primary' loading={joining} onClick={handleJoin}>
              {t('common.enterprise.joinButton', { defaultValue: '加入' })}
            </Button>
          </div>
          <div className='text-t-tertiary text-12px mt-8px'>
            {t('common.enterprise.joinModeHint', {
              defaultValue: '本机为客户端模式。如需在本机托管企业，请在设置 → 远程连接 中切换为服务器。',
            })}
          </div>
        </div>
      )}
      {showCreateEnterprise && (
        <div>
          <div className='text-15px font-600 text-t-primary mb-8px'>
            {t('common.enterprise.createTitle', { defaultValue: '创建企业' })}
          </div>
          <div className='text-t-secondary mb-12px'>
            {t('common.enterprise.createHint', {
              defaultValue: '创建后本机将成为企业服务器，你会成为系统管理员。',
            })}
          </div>
          <div className='flex gap-8px'>
            <Input
              value={tenantName}
              onChange={setTenantName}
              placeholder={t('common.enterprise.tenantNamePlaceholder', { defaultValue: '企业名称' })}
              style={{ maxWidth: 240 }}
            />
            <Button loading={creating} onClick={handleCreate}>
              {t('common.enterprise.createButton', { defaultValue: '创建' })}
            </Button>
          </div>
          {showResetPrompt && (
            <Alert
              type='warning'
              className='mt-12px'
              content={
                <div className='flex flex-col gap-8px'>
                  <span>
                    {t('common.enterprise.staleDataDetected', {
                      defaultValue: '检测到本机保留有历史企业数据，需要先归档并清空才能重新创建企业。',
                    })}
                  </span>
                  <Button status='warning' loading={resetting} className='!w-fit' onClick={handleResetLocal}>
                    {t('common.enterprise.resetLocalButton', { defaultValue: '重置本机企业数据' })}
                  </Button>
                </div>
              }
            />
          )}
        </div>
      )}
    </div>
  );
};

export default OverviewTab;
