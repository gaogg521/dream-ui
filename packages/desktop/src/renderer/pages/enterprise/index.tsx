/**
 * Project-group (项目组) settings.
 *
 * Scope rule: this page shows only surfaces whose data is `tenant_id`-scoped,
 * i.e. things that belong to THIS project group. Enterprise- and
 * deployment-scoped surfaces (SSO wiring, subscription & usage, backup) moved
 * to the company console — leaving them here meant a group admin could edit
 * another group's world.
 *
 * The tabs are grouped rather than flat: a flat list had grown to 13 and
 * overflowed the viewport, which pushed table columns off-screen and forced a
 * page-level horizontal scrollbar. Related surfaces now share one tab with an
 * inner switcher, keeping the top level scannable.
 *
 * Overview is visible to every user (join / create / exit); the rest render for
 * org_admin / system_admin inside a project group, or read-only on a
 * client-mode terminal.
 */

import React, { useEffect, useState } from 'react';
import { Button, Spin, Tabs } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isOrgAdminRole, useOrgContext } from './hooks/useOrgContext';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import OverviewTab from './components/OverviewTab';
import UsersTab from './components/UsersTab';
import InvitesTab from './components/InvitesTab';
import AuditTab from './components/AuditTab';
import RuntimeTab from './components/RuntimeTab';
import AgentAuditTab from './components/AgentAuditTab';
import OnboardingTab from './components/OnboardingTab';
import OrgTreeTab from './components/OrgTreeTab';
import IntegrationsTab from './components/IntegrationsTab';
import PlatformTab from './components/PlatformTab';

const TabKey = {
  OVERVIEW: 'overview',
  USERS: 'users',
  /** Invite codes + bulk onboarding — both are "get people in". */
  INVITES: 'invites',
  ORG_TREE: 'orgTree',
  /** Operator audit + agent-run audit — both answer "what happened". */
  AUDIT: 'audit',
  /** Runtime nodes + integrations + platform — the group's infrastructure. */
  INFRA: 'infra',
} as const;

/**
 * Keys that used to be their own top-level tab. Deep links such as
 * `?tab=billing` are still in the wild (the project-group console links this
 * way), so they are redirected to wherever the surface lives now instead of
 * silently falling back to the overview.
 */
const LEGACY_TAB_ALIASES: Record<string, TabKey> = {
  runtime: 'infra',
  integrations: 'infra',
  platform: 'infra',
  agentAudit: 'audit',
  onboarding: 'invites',
};

/** Surfaces that moved to the company console (`/settings/company`). */
const MOVED_TO_COMPANY = new Set(['sso', 'billing', 'backup']);

type TabKey = (typeof TabKey)[keyof typeof TabKey];

const TAB_VALUES = new Set<string>(Object.values(TabKey));

const EnterprisePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const tab = searchParams.get('tab');
    if (!tab) return TabKey.OVERVIEW;
    if (TAB_VALUES.has(tab)) return tab as TabKey;
    return LEGACY_TAB_ALIASES[tab] ?? TabKey.OVERVIEW;
  });
  // A deep link to a surface that now lives on the company console should take
  // the user there rather than dumping them on an unrelated tab.
  const movedTarget = searchParams.get('tab');
  useEffect(() => {
    if (movedTarget && MOVED_TO_COMPANY.has(movedTarget)) {
      navigate(`/settings/company?from=${movedTarget}`, { replace: true });
    }
  }, [movedTarget, navigate]);
  const { loading, context, error, refresh } = useOrgContext();
  const { isClient: isDeploymentClient, loading: deploymentLoading } = useDeploymentRole();

  // These tabs (成员/邀请码/组织架构/审计日志/基础设施) call `/api/one/org/*`
  // and `/api/one/admin/*`, both governance-routed — client mode correctly
  // forwards them to the remote server (see `GOVERNANCE_PATH_PREFIXES`), so
  // there is no backend reason to hide them for a client-mode admin. They
  // used to be gated on `!isDeploymentClient` regardless of role, which for
  // an org whose admins all work in client mode (a normal shape — most
  // employees aren't sitting at the literal server machine) made 组织架构/
  // 审计日志/运行时节点/集成连接器/基础设施 unreachable: no local tab, and
  // no working remote link either (`OverviewTab`'s admin-console link only
  // ever points at `/#/enterprise/console`, the company console, which
  // doesn't carry these tabs at all).
  const isProjectGroupAdmin = Boolean(context?.isEnterprise && isOrgAdminRole(context?.role));
  const showAdminTabs = !deploymentLoading && isProjectGroupAdmin;
  // A client-mode member who ISN'T this project group's admin still gets the
  // read-only roster/invite-code view (BUG4); an admin gets the full
  // editable tabs above instead, regardless of deployment mode.
  const showMemberReadonlyTabs =
    !deploymentLoading && isDeploymentClient && Boolean(context?.isEnterprise) && !isProjectGroupAdmin;

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center justify-between border-b border-border-2 px-16px py-12px'>
        <div className='text-16px font-600 text-t-primary'>
          {t('common.enterprise.title', { defaultValue: '企业' })}
        </div>
        {showAdminTabs && (
          <Button type='primary' size='small' onClick={() => void navigate('/enterprise/console')}>
            {t('common.enterprise.openConsole', { defaultValue: '进入企业管理后台' })}
          </Button>
        )}
      </div>
      <div className='flex-1 overflow-auto p-16px'>
        {/* "Connect to a remote server" used to live here, but it is an
            enterprise-IDENTITY concern (browser SSO login / logout), not a
            project-group one — it now lives on /settings/enterprise-identity
            since the two dimensions were fully decoupled. The deployment role
            card (server/client) moved out for the same reason: it is neither
            tenant- nor company-scoped, it decides which machine's data this
            whole app defers to — so it now lives on /settings/webui
            ("远程连接"), alongside the other "how this machine is reached /
            who it connects to" controls. */}
        <Spin loading={loading}>
          <Tabs className='settings-remote-tabs' activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)}>
            <Tabs.TabPane key={TabKey.OVERVIEW} title={t('common.enterprise.tabOverview', { defaultValue: '概览' })}>
              <OverviewTab context={context} error={error} onChanged={() => void refresh()} />
            </Tabs.TabPane>
            {(showAdminTabs || showMemberReadonlyTabs) && (
              <Tabs.TabPane key={TabKey.USERS} title={t('common.enterprise.tabUsers', { defaultValue: '成员' })}>
                <UsersTab currentRole={context?.role ?? 'member'} readOnly={showMemberReadonlyTabs} />
              </Tabs.TabPane>
            )}
            {(showAdminTabs || showMemberReadonlyTabs) && (
              <Tabs.TabPane key={TabKey.INVITES} title={t('common.enterprise.tabInvites', { defaultValue: '邀请码' })}>
                {/* Single codes and bulk onboarding are the same job at two
                    scales, so they share a tab instead of competing for space
                    in the top-level bar. */}
                {showAdminTabs ? (
                  <Tabs type='rounded' size='small' defaultActiveTab='codes'>
                    <Tabs.TabPane key='codes' title={t('common.enterprise.tabInvites', { defaultValue: '邀请码' })}>
                      <InvitesTab readOnly={false} />
                    </Tabs.TabPane>
                    <Tabs.TabPane key='bulk' title={t('common.enterprise.tabOnboarding', { defaultValue: '批量邀请' })}>
                      <OnboardingTab />
                    </Tabs.TabPane>
                  </Tabs>
                ) : (
                  <InvitesTab readOnly />
                )}
              </Tabs.TabPane>
            )}
            {showAdminTabs && (
              <Tabs.TabPane
                key={TabKey.ORG_TREE}
                title={t('common.enterprise.tabOrgTree', { defaultValue: '组织架构' })}
              >
                <OrgTreeTab />
              </Tabs.TabPane>
            )}
            {showAdminTabs && (
              <Tabs.TabPane key={TabKey.AUDIT} title={t('common.enterprise.tabAudit', { defaultValue: '审计日志' })}>
                {/* Operator actions and agent tool-calls answer the same
                    question ("what happened here"), just about different
                    actors. */}
                <Tabs type='rounded' size='small' defaultActiveTab='operator'>
                  <Tabs.TabPane
                    key='operator'
                    title={t('common.enterprise.auditSubOperator', { defaultValue: '操作审计' })}
                  >
                    <AuditTab />
                  </Tabs.TabPane>
                  <Tabs.TabPane
                    key='agent'
                    title={t('common.enterprise.tabAgentAudit', { defaultValue: 'Agent 审计' })}
                  >
                    <AgentAuditTab />
                  </Tabs.TabPane>
                </Tabs>
              </Tabs.TabPane>
            )}
            {showAdminTabs && (
              <Tabs.TabPane key={TabKey.INFRA} title={t('common.enterprise.tabInfra')}>
                {/* Runtime nodes, outbound connectors and platform config are
                    all "what this group runs on". */}
                <Tabs type='rounded' size='small' defaultActiveTab='runtime'>
                  <Tabs.TabPane key='runtime' title={t('common.enterprise.tabRuntime', { defaultValue: '运行时节点' })}>
                    <RuntimeTab />
                  </Tabs.TabPane>
                  <Tabs.TabPane
                    key='integrations'
                    title={t('common.enterprise.tabIntegrations', { defaultValue: '集成连接器' })}
                  >
                    <IntegrationsTab />
                  </Tabs.TabPane>
                  <Tabs.TabPane key='platform' title={t('common.enterprise.tabPlatform', { defaultValue: '基础设施' })}>
                    <PlatformTab />
                  </Tabs.TabPane>
                </Tabs>
              </Tabs.TabPane>
            )}
          </Tabs>
        </Spin>
      </div>
    </div>
  );
};

export default EnterprisePage;
