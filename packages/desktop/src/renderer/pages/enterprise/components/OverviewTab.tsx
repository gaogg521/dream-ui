/**
 * Enterprise overview tab — membership info for enterprise members,
 * join / create forms for personal-mode users, exit flow for members.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Divider, Input, Message, Modal, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { WEBUI_DEFAULT_PORT } from '@/common/config/constants';
import { webui } from '@/common/adapter/ipcBridge';
import { getEnterpriseServerUrl, getEnterpriseSession, isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
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
  /** The context call 401'd: connected to a remote server but not logged in
   * on it. Rendered as an onboarding state with a login affordance, never as
   * the raw error string. */
  unauthorized: boolean;
  onChanged: () => void;
};

/**
 * A user-presentable message for a failed governance call. Backend HTTP errors
 * carry the whole response envelope in `error.message` (`Backend GET … (401):
 * {"success":false,…}`) — status code and JSON are internal details no member
 * should read, so surface the backend's own human sentence when there is one
 * and a neutral fallback otherwise.
 */
function friendlyError(e: unknown, fallback: string): string {
  if (isBackendHttpError(e) && e.backendMessage) return `${fallback}: ${e.backendMessage}`;
  return fallback;
}

const roleLabelKey: Record<string, { key: string; fallback: string }> = {
  system_admin: { key: 'common.enterprise.roleSystemAdmin', fallback: '系统管理员' },
  org_admin: { key: 'common.enterprise.roleOrgAdmin', fallback: '组织管理员' },
  member: { key: 'common.enterprise.roleMember', fallback: '成员' },
};

const OverviewTab: React.FC<OverviewTabProps> = ({ context, error, unauthorized, onChanged }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  // Only reachable from a pre-split config (or `markDeploymentAsServer`);
  // there is no longer any way to enter this state from the UI.
  const showLegacyServerNotice = !deploymentLoading && isDeploymentServer;
  const [inviteCode, setInviteCode] = useState('');
  const [joining, setJoining] = useState(false);
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
    // A client that hasn't connected yet routes governance calls LOCALLY (see
    // httpBridge GOVERNANCE_PATH_PREFIXES) — the join would silently hit the
    // wrong backend and fail with a confusing "invalid code". Block it here.
    // Stating BOTH prerequisites matters: the old copy claimed flipping the
    // connect toggle was enough, but without a session on that server the join
    // still 401s (measured).
    if (!isEnterpriseModeEnabled()) {
      Message.warning(
        t('common.enterprise.joinPrerequisitesHint', {
          defaultValue:
            '用邀请码加入项目组需要：① 连接项目组服务器（「企业身份」页），② 登录该服务器上的企业账号。当前还未连接服务器。',
        })
      );
      return;
    }
    if (!getEnterpriseSession()) {
      Message.warning(
        t('common.enterprise.joinNeedsLoginOnlyHint', {
          defaultValue: '已连接项目组服务器，还需先登录企业账号再加入。',
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
      Message.error(friendlyError(e, t('common.enterprise.joinFailed', { defaultValue: '加入失败' })));
    } finally {
      setJoining(false);
    }
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
      Message.error(friendlyError(e, t('common.enterprise.exitFailed', { defaultValue: '退出失败' })));
    } finally {
      setExiting(false);
    }
  };

  if (error) {
    // 401 is not a malfunction: the app IS connected to a remote server but
    // holds no session on it yet (the server answers org/context before any
    // login). Used to render the raw error — `Backend GET … (401):
    // {"success":false,…}` — which replaced the whole page and left the user
    // stuck on a dead end with no way forward.
    if (unauthorized) {
      return (
        <div className='max-w-560px'>
          <Alert
            type='info'
            className='mb-16px'
            title={t('common.enterprise.notLoggedInTitle', { defaultValue: '已连接企业服务器，尚未登录' })}
            content={t('common.enterprise.notLoggedInHint', {
              defaultValue:
                '本机已连接远端项目组服务器，但还没有在该服务器上登录。请先登录企业账号，登录后即可用邀请码加入项目组。',
            })}
          />
          <div className='mb-16px'>
            <Button type='primary' onClick={() => navigate('/enterprise/login')}>
              {t('common.enterprise.goLoginButton', { defaultValue: '去登录企业账号' })}
            </Button>
          </div>
          <div>
            <div className='text-15px font-600 text-t-primary mb-8px'>
              {t('common.enterprise.joinTitle', { defaultValue: '加入企业' })}
            </div>
            <div className='text-t-tertiary text-13px mb-8px'>
              {t('common.enterprise.joinNeedsLoginHint', { defaultValue: '登录企业账号后可用邀请码加入。' })}
            </div>
            <div className='flex gap-8px'>
              <Input
                disabled
                placeholder={t('common.enterprise.inviteCodePlaceholder', { defaultValue: '邀请码' })}
                style={{ maxWidth: 240 }}
              />
              <Button disabled type='primary'>
                {t('common.enterprise.joinButton', { defaultValue: '加入' })}
              </Button>
            </div>
          </div>
        </div>
      );
    }
    // Everything else stays an error — but a friendly one. The raw string
    // carried the HTTP status and the backend's JSON envelope (internal
    // details, and unreadable to a member).
    return (
      <Alert
        type='error'
        title={t('common.enterprise.contextError', { defaultValue: '无法获取企业信息' })}
        content={t('common.enterprise.contextErrorHint', {
          defaultValue: '获取企业信息失败，请检查与项目组服务器的连接后重试。',
        })}
      />
    );
  }

  if (!context) {
    return null;
  }

  if (context.isEnterprise) {
    const role = roleLabelKey[context.role] ?? roleLabelKey.member;
    // The console is a separate SPA served at /admin by the gateway, no longer
    // a hash route inside the WebUI. The path matters: the WebUI root redirects
    // to /guid (the member's own chat), so a bare base URL looked like "the
    // user's own web interface" rather than the admin backend.
    const adminConsoleHref = adminConsoleUrl ? `${adminConsoleUrl.replace(/\/+$/, '')}/admin` : '';

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
              content={t('common.enterprise.joinPrerequisitesHint', {
                defaultValue:
                  '用邀请码加入项目组需要：① 连接项目组服务器（「企业身份」页），② 登录该服务器上的企业账号。当前还未连接服务器。',
              })}
            />
          )}
          {isEnterpriseModeEnabled() && !getEnterpriseSession() && (
            <Alert
              type='warning'
              className='mb-12px'
              content={t('common.enterprise.joinNeedsLoginOnlyHint', {
                defaultValue: '已连接项目组服务器，还需先登录企业账号再加入。',
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
              defaultValue: '本机为客户端模式，加入由企业版服务端托管的项目组。个人版不提供本机托管项目组的能力。',
            })}
          </div>
        </div>
      )}
      {/* Creating an enterprise locally is gone: hosting lives in the separate
          enterprise edition, and `/api/one/org/create` answers 501 in this
          build. The form used to be shown to anyone whose deployment role
          said `server`, which now only happens for configs left over from
          before the split — so they get an explanation instead of a button
          that cannot work. Joining a remote project group by invite code is
          unaffected and stays above. */}
      {showLegacyServerNotice && (
        <Alert
          type='info'
          content={t('common.enterprise.hostingMovedToEnterpriseEdition', {
            defaultValue:
              '本机记录的部署角色是「服务器」，但个人版不提供项目组托管能力（该能力已随企业版拆分独立）。请在「设置 → 企业身份」将本机切回客户端，并连接由企业版服务端托管的项目组。',
          })}
        />
      )}
    </div>
  );
};

export default OverviewTab;
