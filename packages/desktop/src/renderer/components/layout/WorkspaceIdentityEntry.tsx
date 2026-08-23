/**
 * Sidebar footer identity entry — guest / member pill with login shortcuts.
 * Desktop only; SSO always opens in the system browser.
 */

import React, { useCallback } from 'react';
import { Avatar, Dropdown, Menu, Message } from '@arco-design/web-react';
import { Check, Earth, Login, Peoples, Setting } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ipcBridge } from '@/common';
import { getEnterpriseSession, isEnterpriseModeEnabled } from '@/common/adapter/enterpriseMode';
import {
  isOrgAdminRole,
  ORG_CONTEXT_CHANGED_EVENT,
  useOrgContext,
} from '@renderer/pages/enterprise/hooks/useOrgContext';
import { useMyTenants } from '@renderer/pages/enterprise/hooks/useMyTenants';
import { useEnterpriseIdentity } from '@renderer/pages/enterprise/hooks/useEnterpriseIdentity';
import { useCompanyIdentity } from '@renderer/pages/enterprise/hooks/useCompanyIdentity';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import { isElectronDesktop } from '@renderer/utils/platform';
import { openWebuiAdminLogin } from '@renderer/utils/enterprise/enterpriseBrowserLogin';
import styles from './WorkspaceIdentityEntry.module.css';

type WorkspaceIdentityEntryProps = {
  collapsed?: boolean;
};

const WorkspaceIdentityEntry: React.FC<WorkspaceIdentityEntryProps> = ({ collapsed = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { context, loading } = useOrgContext();
  // Every project group the caller belongs to (Phase 2 multi-membership) — the
  // source for the switcher below. Empty for personal / standalone, so the
  // switcher never renders there.
  const { tenants: myTenants } = useMyTenants();
  // Enterprise-org identity (SSO company + department) — independent of the
  // project-group context above; only used here for a display-name /
  // department fallback, not for the edition tier tag (see below).
  const { identity: enterpriseIdentity } = useEnterpriseIdentity();
  const { isClient: isDeploymentClient, loading: deploymentLoading } = useDeploymentRole();
  const hideLocalAdmin = !deploymentLoading && isDeploymentClient;
  const remoteSession = getEnterpriseSession();
  // A THIRD identity dimension, independent of SSO/project-group membership:
  // any local system_admin can self-establish a company via "设立企业"
  // (CompanyConsole's SetupCompanyCard) without ever touching SSO or joining a
  // project group. Before this, that state fell through to the "个人版·未登录"
  // label/hint below — actively wrong, since the viewer administers a real,
  // reachable company (bug found via CDP-driven regression testing:
  // /api/one/org/context showed isEnterprise:false while /api/one/enterprise/me
  // showed a live "manual"-origin company for the same session).
  const { company: localCompany, isCompanyAdmin: isLocalCompanyAdmin } = useCompanyIdentity();
  const hasLocalCompany = Boolean(localCompany) && isLocalCompanyAdmin;

  // Identity (WHO) and workspace (WHERE) are two independent dimensions and are
  // resolved separately. They used to be collapsed into one `displayName` that
  // fell back to the tenant name — which put the project-group name in the
  // "who are you" slot and made it appear three times in one screen (dropdown
  // title, dropdown detail line, and the trigger beneath it).
  const identityName = remoteSession?.name ?? remoteSession?.username ?? enterpriseIdentity?.displayName ?? null;
  const workspaceName = context?.isEnterprise
    ? (context.tenantName ?? context.tenantId)
    : hasLocalCompany
      ? localCompany?.name
      : null;

  /** The one line that names this menu — workspace first, else the person. */
  const primaryName =
    workspaceName ?? identityName ?? t('settings.workspaceIdentity.personalWorkspace', { defaultValue: '个人工作区' });
  const avatarSeed = primaryName.slice(0, 1).toUpperCase();

  // The edition tag is purely about the project-group dimension now — the
  // enterprise-org (SSO company) dimension is shown independently in the
  // enterprise overview tab, not conflated with this tier tag.
  //
  // `hideLocalAdmin` is the DEPLOYMENT ROLE (client vs server) and stays true
  // for the whole client-role lifetime — it does not tell you whether the
  // connect toggle is actually on right now. Reading connection status off
  // it (as this used to) claimed "连接远端/Connected" for a client that had
  // manually disconnected (session kept, only the toggle flipped off) or had
  // simply never connected yet — the exact "UI says connected, reality says
  // not" contradiction this whole investigation started from, just inverted.
  const isRemoteConnected = isEnterpriseModeEnabled();
  const editionLine = hideLocalAdmin
    ? isRemoteConnected
      ? t('settings.workspaceIdentity.editionClient', { defaultValue: '客户端 · 连接远端' })
      : t('settings.workspaceIdentity.editionClientDisconnected', { defaultValue: '客户端 · 未连接' })
    : context?.isEnterprise
      ? t('settings.workspaceIdentity.editionProjectGroup', { defaultValue: '项目组' })
      : remoteSession
        ? t('settings.workspaceIdentity.editionSsoNoGroup', { defaultValue: '已登录 · 未加入项目组' })
        : hasLocalCompany
          ? t('settings.workspaceIdentity.editionCompanyAdmin', { defaultValue: '企业管理员 · 未加入项目组' })
          : t('settings.workspaceIdentity.editionPersonal', { defaultValue: '个人版 · 未登录' });

  const handleEnterpriseLogin = useCallback(() => {
    navigate('/enterprise/login');
  }, [navigate]);

  // Already authenticated via enterprise SSO — the only thing left is picking a
  // project group, so go straight to the join UI. Sending an authenticated user
  // back through the "登录您的账户" page (enterprise ⊃ project group) is a dead
  // end: they have nothing left to log in to.
  const handleJoinProjectGroup = useCallback(() => {
    navigate('/settings/enterprise');
  }, [navigate]);

  const handleSwitchTenant = useCallback(
    async (tenantId: string) => {
      try {
        await ipcBridge.oneOrg.switchTenant.invoke({ tenantId });
        // Notify sibling useOrgContext / useMyTenants instances to refetch so
        // the badge, edition tag, and downstream team-resource views all
        // follow the newly-active group.
        window.dispatchEvent(new CustomEvent(ORG_CONTEXT_CHANGED_EVENT));
        Message.success(t('settings.workspaceIdentity.switchDone', { defaultValue: '已切换项目组' }));
      } catch (e) {
        Message.error(String(e));
      }
    },
    [t]
  );

  const handleAdminLogin = useCallback(async () => {
    // Land on the admin console after logging in (EnterpriseConsole gates
    // non-admins with a clear permission page), not the personal /guid chat.
    const ok = await openWebuiAdminLogin('/enterprise/console');
    if (!ok) {
      Message.warning(
        t('common.enterprise.loginWebuiRequired', {
          defaultValue: '无法打开浏览器登录页，请先在设置 → 远程连接 中启动 WebUI。',
        })
      );
    }
  }, [t]);

  // The org-admin console entry is only reachable from this dropdown today
  // (SiderEnterpriseEntry isn't mounted in the main nav), so a member who has
  // already joined must see membership-aware actions here — not the generic
  // "join a team" guest copy, which previously showed unconditionally even
  // for an authenticated system_admin (bug found while dogfooding this build).
  const isEnterprise = Boolean(context?.isEnterprise);
  const isAdmin = isOrgAdminRole(context?.role);

  /**
   * Compact `label — value` rows for facts NOT already carried by the header.
   * Rendering each fact as its own full sentence ("项目组：X", "企业 SSO：Y",
   * "部门：Z") stacked under a bold title is what made this menu read as a wall
   * of near-identical text.
   */
  const facts: Array<{ key: string; label: string; value: string }> = [];
  // Only when it differs from the header — otherwise it is the same string twice.
  if (identityName && identityName !== primaryName) {
    facts.push({
      key: 'identity',
      label: t('settings.workspaceIdentity.factIdentity', { defaultValue: '身份' }),
      value: identityName,
    });
  }
  const companyLabel = enterpriseIdentity?.companyName ?? enterpriseIdentity?.companyId;
  if (remoteSession && companyLabel) {
    facts.push({
      key: 'company',
      label: t('settings.workspaceIdentity.factCompany', { defaultValue: '企业' }),
      value: companyLabel,
    });
  }
  if (enterpriseIdentity?.department) {
    facts.push({
      key: 'department',
      label: t('settings.workspaceIdentity.factDepartment', { defaultValue: '部门' }),
      value: enterpriseIdentity.department,
    });
  }

  const menu = (
    <Menu
      className={styles.wsMenu}
      onClickMenuItem={(key) => {
        if (key.startsWith('switch:')) {
          void handleSwitchTenant(key.slice('switch:'.length));
          return;
        }
        if (key === 'join') handleEnterpriseLogin();
        if (key === 'joinGroup') handleJoinProjectGroup();
        if (key === 'admin') void handleAdminLogin();
        if (key === 'console') navigate('/enterprise/console');
        if (key === 'settings') navigate('/settings/enterprise');
      }}
    >
      {/* Header — a title, deliberately NOT a copy of the trigger pill. The pill
          sitting right below already carries avatar + name + edition; repeating
          that layout here stacked two identical-looking rows on top of each
          other, which is what made the menu look duplicated. */}
      <div className={styles.menuHeader}>
        <div className={styles.menuHeaderName}>{primaryName}</div>
        <div className={styles.menuHeaderSub}>{editionLine}</div>
      </div>
      {facts.length > 0 ? (
        <div className={styles.menuFacts}>
          {facts.map((f) => (
            <div key={f.key} className={styles.factRow}>
              <span className={styles.factLabel}>{f.label}</span>
              <span className={styles.factValue}>{f.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {!isEnterprise && !remoteSession ? (
        <div className={styles.menuHint}>
          {hasLocalCompany
            ? t('settings.workspaceIdentity.guestDescCompanyAdmin', {
                defaultValue:
                  '你是本机「{{company}}」的企业管理员，可在设置 → 企业管理后台中管理成员与设置。加入项目组后可使用协作能力。',
                company: localCompany?.name ?? '',
              })
            : t('settings.workspaceIdentity.guestDesc', {
                defaultValue: '当前为单机个人版，可直接使用会话与工作区。加入团队后可使用企业协作能力。',
              })}
        </div>
      ) : null}
      <div className={styles.menuDivider} />
      {/* Multi-membership switcher: only when the caller belongs to more than
          one project group. Clicking a group activates it server-side. */}
      {myTenants.length > 1 ? (
        <Menu.ItemGroup title={t('settings.workspaceIdentity.myGroupsTitle', { defaultValue: '我的项目组' })}>
          {myTenants.map((tn) => (
            <Menu.Item key={`switch:${tn.tenantId}`}>
              <span className='flex items-center justify-between gap-8px'>
                <span className='truncate'>{tn.name}</span>
                {tn.isActive ? <Check theme='outline' size={14} fill='rgb(var(--primary-6))' /> : null}
              </span>
            </Menu.Item>
          ))}
        </Menu.ItemGroup>
      ) : null}
      {isEnterprise ? (
        <>
          {/* Client mode deliberately has no in-app admin console entry —
              enterprise/index.tsx's own "进入企业管理后台" button is gated
              the same way (!isDeploymentClient), and the hint text shown
              elsewhere on client terminals promises exactly this ("本机不
              显示项目组管理后台入口"). This item used to gate on `isAdmin`
              alone, so a client-mode org_admin still saw and could open
              /enterprise/console in-app, contradicting that promise. */}
          {isAdmin && !hideLocalAdmin ? (
            <Menu.Item key='console'>
              <span className={styles.actionRow}>
                <Peoples theme='outline' size={15} />
                {t('settings.workspaceIdentity.openConsole', { defaultValue: '进入项目组管理后台' })}
              </span>
            </Menu.Item>
          ) : null}
          {/* One route, one label. This used to read "项目组设置 / 退出项目组",
              advertising two destinations for a single navigation — leaving the
              menu instead of exiting anything. Exiting lives on that page. */}
          <Menu.Item key='settings'>
            <span className={styles.actionRow}>
              <Setting theme='outline' size={15} />
              {t('settings.workspaceIdentity.openSettings', { defaultValue: '项目组设置' })}
            </span>
          </Menu.Item>
        </>
      ) : remoteSession ? (
        // Signed in to the company already: offer only the remaining step.
        <Menu.Item key='joinGroup'>
          <span className={styles.actionRow}>
            <Login theme='outline' size={15} />
            {t('settings.workspaceIdentity.joinProjectGroup', { defaultValue: '加入项目组' })}
          </span>
        </Menu.Item>
      ) : (
        <Menu.Item key='join'>
          <span className={styles.actionRow}>
            <Login theme='outline' size={15} />
            {t('settings.workspaceIdentity.guestJoinEnterprise', { defaultValue: '登录 / 加入项目组' })}
          </span>
        </Menu.Item>
      )}
      {!hideLocalAdmin ? (
        <Menu.Item key='admin'>
          <span className={styles.actionRow}>
            <Earth theme='outline' size={15} />
            {t('settings.workspaceIdentity.guestAdminLogin', { defaultValue: 'WebUI 管理员登录' })}
          </span>
        </Menu.Item>
      ) : null}
    </Menu>
  );

  if (!isElectronDesktop()) return null;

  if (collapsed) {
    return (
      <div className={styles.root}>
        <Dropdown droplist={menu} trigger='click' position='tr'>
          <div className={styles.trigger} style={{ justifyContent: 'center', padding: '8px 0' }}>
            <Avatar size={28} style={{ backgroundColor: 'rgb(var(--primary-6))' }}>
              {avatarSeed}
            </Avatar>
          </div>
        </Dropdown>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Dropdown droplist={menu} trigger='click' position='tr'>
        <div className={styles.trigger}>
          <Avatar size={32} className={styles.avatar} style={{ backgroundColor: 'rgb(var(--primary-6))' }}>
            {loading ? '…' : avatarSeed}
          </Avatar>
          <div className={styles.meta}>
            <div className={styles.name}>{primaryName}</div>
            <div className={styles.sub}>{editionLine}</div>
          </div>
        </div>
      </Dropdown>
    </div>
  );
};

export default WorkspaceIdentityEntry;
