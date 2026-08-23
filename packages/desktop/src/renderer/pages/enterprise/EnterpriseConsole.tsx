/**
 * Enterprise admin console home — unified portal that aggregates the
 * research/dev capabilities (already living under /settings/super-assistant) and the
 * org-governance surfaces (users / invites / audit / SSO on the enterprise
 * page) into one grid dashboard. Ported in spirit from the legacy 1one
 * EnterpriseHome, wired to the fork's routes and one-org / one-employee APIs.
 *
 * Only reachable in server deployment mode by an org admin (entry button lives
 * on the enterprise page). Capabilities the fork does not yet expose (DORA
 * insights / artifact repo / code repo) are shown as "coming soon".
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Grid, Statistic, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Analysis,
  Book,
  Calendar,
  CheckOne,
  Code,
  EveryUser,
  Globe,
  Inbox,
  Left,
  Lock,
  Peoples,
  Plug,
  Right,
  Robot,
  Server,
  Setting,
  Thunderbolt,
  TicketOne,
} from '@icon-park/react';
import { ipcBridge } from '@/common';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { isOrgAdminRole, useOrgContext } from '@renderer/pages/enterprise/hooks/useOrgContext';

const { Row, Col } = Grid;

type ConsoleCard = {
  key: string;
  labelKey: string;
  labelDefault: string;
  descKey: string;
  descDefault: string;
  icon: React.ReactNode;
  path?: string;
  comingSoon?: boolean;
};

const CAPABILITY_CARDS: ConsoleCard[] = [
  {
    key: 'issues',
    labelKey: 'common.enterpriseConsole.cardIssues',
    labelDefault: '协作看板',
    descKey: 'common.enterpriseConsole.cardIssuesDesc',
    descDefault: '需求协同、任务拆解与跨角色推进。',
    icon: <Peoples theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=issues',
  },
  {
    key: 'agents',
    labelKey: 'common.enterpriseConsole.cardAgents',
    labelDefault: '数字员工',
    descKey: 'common.enterpriseConsole.cardAgentsDesc',
    descDefault: '团队数字员工编排与调度。',
    icon: <Robot theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=agents',
  },
  {
    key: 'pipelines',
    labelKey: 'common.enterpriseConsole.cardPipelines',
    labelDefault: '流水线编排',
    descKey: 'common.enterpriseConsole.cardPipelinesDesc',
    descDefault: '持续集成编排、运行与质量闸口。',
    icon: <Thunderbolt theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=pipelines',
  },
  {
    key: 'rag',
    labelKey: 'common.enterpriseConsole.cardRag',
    labelDefault: '团队知识库',
    descKey: 'common.enterpriseConsole.cardRagDesc',
    descDefault: '全离线语义向量知识库。',
    icon: <Book theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=rag',
  },
  {
    key: 'milestones',
    labelKey: 'common.enterpriseConsole.cardMilestones',
    labelDefault: '版本规划',
    descKey: 'common.enterpriseConsole.cardMilestonesDesc',
    descDefault: '里程碑与版本节奏规划。',
    icon: <Calendar theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=milestones',
  },
  {
    key: 'testplans',
    labelKey: 'common.enterpriseConsole.cardTestPlans',
    labelDefault: '测试计划',
    descKey: 'common.enterpriseConsole.cardTestPlansDesc',
    descDefault: '测试计划与质量校验。',
    icon: <CheckOne theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=testplans',
  },
  {
    key: 'runtimes',
    labelKey: 'common.enterpriseConsole.cardRuntimes',
    labelDefault: '运行时节点',
    descKey: 'common.enterpriseConsole.cardRuntimesDesc',
    descDefault: '团队运行时节点与资源。',
    icon: <Server theme='outline' size={18} />,
    path: '/settings/enterprise?tab=infra',
  },
  {
    key: 'cmeas',
    labelKey: 'common.enterpriseConsole.cardCmeas',
    labelDefault: '效能洞察',
    descKey: 'common.enterpriseConsole.cardCmeasDesc',
    descDefault: 'DORA 指标与交付效能分析。',
    icon: <Analysis theme='outline' size={18} />,
    comingSoon: true,
  },
  {
    key: 'cpack',
    labelKey: 'common.enterpriseConsole.cardCpack',
    labelDefault: '制品仓库',
    descKey: 'common.enterpriseConsole.cardCpackDesc',
    descDefault: '制品仓库、资产与分发出口。',
    icon: <Inbox theme='outline' size={18} />,
    comingSoon: true,
  },
  {
    key: 'ccode',
    labelKey: 'common.enterpriseConsole.cardCcode',
    labelDefault: '代码库',
    descKey: 'common.enterpriseConsole.cardCcodeDesc',
    descDefault: '代码资产接入与交付链路关联。',
    icon: <Code theme='outline' size={18} />,
    comingSoon: true,
  },
];

const FOUNDATION_CARDS: ConsoleCard[] = [
  {
    key: 'users',
    labelKey: 'common.enterpriseConsole.cardUsers',
    labelDefault: '用户管理',
    descKey: 'common.enterpriseConsole.cardUsersDesc',
    descDefault: '成员账号与角色分配。',
    icon: <EveryUser theme='outline' size={18} />,
    path: '/settings/enterprise?tab=users',
  },
  {
    key: 'invites',
    labelKey: 'common.enterpriseConsole.cardInvites',
    labelDefault: '邀请码',
    descKey: 'common.enterpriseConsole.cardInvitesDesc',
    descDefault: '成员邀请码生成与管理。',
    icon: <TicketOne theme='outline' size={18} />,
    path: '/settings/enterprise?tab=invites',
  },
  // 企业认证 (SSO config) moved to the company admin console (Direction B): it
  // is a company-level policy, not a project-group setting.
  {
    key: 'audit',
    labelKey: 'common.enterpriseConsole.cardAudit',
    labelDefault: '审计日志',
    descKey: 'common.enterpriseConsole.cardAuditDesc',
    descDefault: '成员操作与安全审计记录。',
    icon: <Lock theme='outline' size={18} />,
    path: '/settings/enterprise?tab=audit',
  },
  {
    key: 'skills',
    labelKey: 'common.enterpriseConsole.cardSkills',
    labelDefault: '团队技能',
    descKey: 'common.enterpriseConsole.cardSkillsDesc',
    descDefault: '管理员下发到成员机的团队技能资产。',
    icon: <Thunderbolt theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=skills',
  },
  {
    key: 'mcp',
    labelKey: 'common.enterpriseConsole.cardMcp',
    labelDefault: '团队 MCP 工具',
    descKey: 'common.enterpriseConsole.cardMcpDesc',
    descDefault: '管理员下发的团队 MCP 集成连接。',
    icon: <Plug theme='outline' size={18} />,
    path: '/settings/super-assistant?tab=registries&section=mcp',
  },
  {
    key: 'memory',
    labelKey: 'common.enterpriseConsole.cardMemory',
    labelDefault: '团队记忆',
    descKey: 'common.enterpriseConsole.cardMemoryDesc',
    descDefault: '管理员下发的团队记忆（后端建设中）。',
    icon: <Book theme='outline' size={18} />,
    comingSoon: true,
  },
  {
    key: 'settings',
    labelKey: 'common.enterpriseConsole.cardSettings',
    labelDefault: '企业设置',
    descKey: 'common.enterpriseConsole.cardSettingsDesc',
    descDefault: '企业名称、退出口令等基础配置。',
    icon: <Setting theme='outline' size={18} />,
    comingSoon: true,
  },
  {
    key: 'teams',
    labelKey: 'common.enterpriseConsole.cardTeams',
    labelDefault: '团队与组织',
    descKey: 'common.enterpriseConsole.cardTeamsDesc',
    descDefault: '团队结构与组织架构管理。',
    icon: <Peoples theme='outline' size={18} />,
    path: '/settings/enterprise?tab=orgTree',
  },
  {
    key: 'usage',
    labelKey: 'common.enterpriseConsole.cardUsage',
    labelDefault: '订阅与用量',
    descKey: 'common.enterpriseConsole.cardUsageDesc',
    descDefault: '订阅档位、席位上限与调用用量分析。',
    icon: <Analysis theme='outline' size={18} />,
    // Subscription data is keyed by enterprise_id, so it lives on the company
    // console now — a project-group admin has no business moving the whole
    // company's plan or spend cap.
    path: '/settings/company?from=billing',
  },
  {
    key: 'integrations',
    labelKey: 'common.enterpriseConsole.cardIntegrations',
    labelDefault: '集成连接器',
    descKey: 'common.enterpriseConsole.cardIntegrationsDesc',
    descDefault: 'GitHub / GitLab / Jira / 飞书 连接器配置（预留）。',
    icon: <Plug theme='outline' size={18} />,
    path: '/settings/enterprise?tab=infra',
  },
  {
    key: 'platform',
    labelKey: 'common.enterpriseConsole.cardPlatform',
    labelDefault: '基础设施',
    descKey: 'common.enterpriseConsole.cardPlatformDesc',
    descDefault: '容器运行时与实时协作后端配置（预留）。',
    icon: <Server theme='outline' size={18} />,
    path: '/settings/enterprise?tab=infra',
  },
];

const KPI_CARD_STYLE: React.CSSProperties = {
  boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
  border: '1px solid var(--color-border-2)',
};

const EnterpriseConsole: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { context, loading: orgLoading } = useOrgContext();
  // Security gate: the admin backend is org-admin only. In the browser WebUI a
  // regular member could otherwise reach this route by typing the URL, so we
  // redirect non-admins away once the org context has resolved.
  const isAdmin = isOrgAdminRole(context?.role);
  const [counts, setCounts] = useState<{
    mcp: number | null;
    skills: number | null;
    rag: number | null;
    pipelines: number | null;
  }>({ mcp: null, skills: null, rag: null, pipelines: null });

  useEffect(() => {
    let disposed = false;
    // The enterprise console reflects the TEAM (tenant) registries the admin
    // defined via one-devops — never this machine's personal skills/MCP. In
    // client mode these calls route to the remote server (see getBaseUrl).
    void Promise.allSettled([
      ipcBridge.oneDevops.listMcpRegistry.invoke(),
      ipcBridge.oneDevops.listSkills.invoke(),
      ipcBridge.oneDevops.listRagDocuments.invoke(),
      ipcBridge.oneDevops.listPipelines.invoke(),
    ]).then(([mcp, skills, rag, pipelines]) => {
      if (disposed) return;
      setCounts({
        mcp: mcp.status === 'fulfilled' ? (mcp.value ?? []).filter((e) => e.enabled).length : null,
        skills: skills.status === 'fulfilled' ? (skills.value ?? []).filter((e) => e.enabled).length : null,
        rag: rag.status === 'fulfilled' ? (rag.value ?? []).length : null,
        pipelines: pipelines.status === 'fulfilled' ? (pipelines.value ?? []).length : null,
      });
    });
    return () => {
      disposed = true;
    };
  }, []);

  const tenantLabel = useMemo(
    () => context?.tenantName || t('common.enterpriseConsole.title', { defaultValue: '企业管理后台' }),
    [context?.tenantName, t]
  );

  const openModule = (card: ConsoleCard) => {
    if (card.comingSoon || !card.path) return;
    void navigate(card.path);
  };

  const quickLinks: { label: string; path: string }[] = [
    { label: t('common.enterpriseConsole.quickSessions', { defaultValue: '会话' }), path: '/guid' },
    { label: t('common.enterpriseConsole.quickAssistants', { defaultValue: 'Agent 助手' }), path: '/assistants' },
    {
      label: t('common.enterpriseConsole.quickSuperAssistant', { defaultValue: '超级助手' }),
      path: '/settings/super-assistant',
    },
    { label: t('common.enterpriseConsole.quickSkills', { defaultValue: '我的技能' }), path: '/settings/skills' },
  ];

  const renderCard = (card: ConsoleCard, wide: boolean) => (
    <Col key={card.key} xs={24} sm={12} lg={wide ? 8 : 6}>
      <Card
        className={`h-full rd-12px border border-solid border-border-2 transition-all ${
          card.comingSoon ? 'opacity-70' : 'cursor-pointer hover:border-primary hover:-translate-y-2px'
        }`}
        style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.02)' }}
        bodyStyle={{ padding: '16px 20px' }}
        hoverable={!card.comingSoon}
        onClick={() => openModule(card)}
      >
        <div className='flex items-center justify-between gap-12px'>
          <div className='flex items-center gap-12px min-w-0 flex-1'>
            <div className='w-36px h-36px rd-8px flex items-center justify-center bg-fill-2 text-primary shrink-0'>
              {card.icon}
            </div>
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-8px mb-2px'>
                <span className='text-14px font-600 text-t-primary truncate'>
                  {t(card.labelKey, { defaultValue: card.labelDefault })}
                </span>
                {card.comingSoon && (
                  <Tag size='small' color='gray' className='rd-10px scale-90 origin-left shrink-0'>
                    {t('common.enterpriseConsole.comingSoon', { defaultValue: '即将推出' })}
                  </Tag>
                )}
              </div>
              <Typography.Paragraph type='secondary' className='mb-0 text-12px'>
                {t(card.descKey, { defaultValue: card.descDefault })}
              </Typography.Paragraph>
            </div>
          </div>
          {!card.comingSoon && <Right theme='outline' size='14' className='text-t-tertiary shrink-0' />}
        </div>
      </Card>
    </Col>
  );

  // Not an admin (or opened in a browser session logged in as a regular
  // member): show an explicit permission page instead of silently bouncing to
  // /guid — the old behavior made the console link look like it "redirected to
  // the personal WebUI" (BUG6). `/login` bounces authenticated users back to
  // /guid, so switching account must log out first.
  const handleSwitchAccount = async () => {
    try {
      await logout();
    } catch {
      // Best-effort — navigate to login regardless.
    }
    void navigate('/login');
  };

  if (!orgLoading && !isAdmin) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-16px p-24px text-center'>
        <Lock theme='outline' size={48} className='text-t-tertiary' />
        <div className='text-18px font-600 text-t-primary'>
          {t('common.enterpriseConsole.adminRequiredTitle', { defaultValue: '需要管理员权限' })}
        </div>
        <Typography.Paragraph type='secondary' className='max-w-420px'>
          {t('common.enterpriseConsole.adminRequiredHint', {
            defaultValue: '企业管理后台需使用管理员账号登录 WebUI。当前账号没有管理员权限，请切换到管理员账号后重试。',
          })}
        </Typography.Paragraph>
        <div className='flex gap-12px'>
          <Button type='primary' onClick={() => void handleSwitchAccount()}>
            {t('common.enterpriseConsole.adminRequiredSwitch', { defaultValue: '切换账号登录' })}
          </Button>
          <Button onClick={() => void navigate('/guid')}>
            {t('common.enterpriseConsole.adminRequiredBackHome', { defaultValue: '返回首页' })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      <div className='flex items-center gap-8px border-b border-border-2 px-16px py-12px'>
        <Button
          type='text'
          size='small'
          icon={<Left theme='outline' size={16} />}
          onClick={() => void navigate('/settings/enterprise')}
        >
          {t('common.enterpriseConsole.back', { defaultValue: '返回企业' })}
        </Button>
        <div className='text-16px font-600 text-t-primary'>
          {t('common.enterpriseConsole.title', { defaultValue: '企业管理后台' })}
        </div>
      </div>

      <div className='flex-1 overflow-auto p-16px'>
        <div className='max-w-1200px mx-auto pb-40px'>
          {/* Hero header */}
          <div
            className='rd-12px p-24px mb-24px text-white relative overflow-hidden'
            style={{
              background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)',
              boxShadow: '0 8px 30px rgba(30, 27, 75, 0.25)',
            }}
          >
            <div className='flex items-center gap-16px relative z-10'>
              <div className='w-48px h-48px rd-10px flex items-center justify-center bg-white/10 border border-white/20 text-yellow-400 shrink-0'>
                <Globe theme='outline' size={24} />
              </div>
              <div className='min-w-0'>
                <div className='text-12px opacity-75 font-600 tracking-wider mb-2px uppercase'>
                  {t('common.enterpriseConsole.kicker', { defaultValue: '企业团队研发控制台' })}
                </div>
                <Typography.Title heading={4} style={{ color: '#fff', margin: 0, fontWeight: 700 }}>
                  {tenantLabel}
                </Typography.Title>
                <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.78)', margin: '8px 0 0' }}>
                  {t('common.enterpriseConsole.heroHint', {
                    defaultValue: '日常会话、任务与共享工作区仍在主工作台中，下面可直接返回。',
                  })}
                </Typography.Paragraph>
                <div className='mt-12px flex items-center gap-8px flex-wrap'>
                  {quickLinks.map((link) => (
                    <Button key={link.path} size='small' onClick={() => void navigate(link.path)}>
                      {link.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className='absolute -right-40px -top-40px w-200px h-200px rd-full bg-white/5 pointer-events-none' />
          </div>

          {/* KPI cards — all team-scoped (one-devops tenant registries) */}
          <Row gutter={[16, 16]} className='mb-24px'>
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false} className='rd-12px' style={KPI_CARD_STYLE}>
                <Statistic
                  title={t('common.enterpriseConsole.metricSkills', { defaultValue: '团队技能' })}
                  value={counts.skills ?? '--'}
                  prefix={<Thunderbolt theme='outline' size={18} className='text-primary mr-8px' />}
                  suffix={t('common.enterpriseConsole.metricUnit', { defaultValue: '个' })}
                  extra={
                    <span className='text-11px text-t-tertiary'>
                      {t('common.enterpriseConsole.metricSkillsHint', { defaultValue: '管理员下发的团队技能' })}
                    </span>
                  }
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false} className='rd-12px' style={KPI_CARD_STYLE}>
                <Statistic
                  title={t('common.enterpriseConsole.metricMcps', { defaultValue: '团队 MCP 工具' })}
                  value={counts.mcp ?? '--'}
                  prefix={<Plug theme='outline' size={18} className='text-green-500 mr-8px' />}
                  suffix={t('common.enterpriseConsole.metricUnit', { defaultValue: '个' })}
                  extra={
                    <span className='text-11px text-t-tertiary'>
                      {t('common.enterpriseConsole.metricMcpHint', { defaultValue: '已启用的团队 MCP 连接' })}
                    </span>
                  }
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false} className='rd-12px' style={KPI_CARD_STYLE}>
                <Statistic
                  title={t('common.enterpriseConsole.metricRags', { defaultValue: '团队知识库文档' })}
                  value={counts.rag ?? '--'}
                  suffix={t('common.enterpriseConsole.metricUnit', { defaultValue: '个' })}
                  extra={
                    <span className='text-11px text-t-tertiary'>
                      {t('common.enterpriseConsole.metricRagHint', { defaultValue: '离线语义向量知识库' })}
                    </span>
                  }
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false} className='rd-12px' style={KPI_CARD_STYLE}>
                <Statistic
                  title={t('common.enterpriseConsole.metricPipelines', { defaultValue: '团队流水线' })}
                  value={counts.pipelines ?? '--'}
                  suffix={t('common.enterpriseConsole.metricUnit', { defaultValue: '个' })}
                  extra={
                    <span className='text-11px text-t-tertiary'>
                      {t('common.enterpriseConsole.metricPipelineHint', { defaultValue: '持续集成编排流水线' })}
                    </span>
                  }
                />
              </Card>
            </Col>
          </Row>

          {/* Capability grid */}
          <Typography.Title
            heading={6}
            className='mt-0 mb-16px text-14px font-700 text-t-secondary uppercase tracking-wider'
          >
            {t('common.enterpriseConsole.capabilityTitle', { defaultValue: '研发智能工作台' })}
          </Typography.Title>
          <Row gutter={[16, 16]} className='mb-24px'>
            {CAPABILITY_CARDS.map((card) => renderCard(card, false))}
          </Row>

          {/* Foundation grid */}
          <Typography.Title
            heading={6}
            className='mt-0 mb-16px text-14px font-700 text-t-secondary uppercase tracking-wider'
          >
            {t('common.enterpriseConsole.menuTitle', { defaultValue: '组织管理与平台配置' })}
          </Typography.Title>
          <Row gutter={[16, 16]}>{FOUNDATION_CARDS.map((card) => renderCard(card, true))}</Row>
        </div>
      </div>
    </div>
  );
};

export default EnterpriseConsole;
