import React, { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import DocumentTitle from '@renderer/components/layout/DocumentTitle';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { resolveSafeRedirect } from '@renderer/utils/navigation';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
const loadConversation = () => import('@renderer/pages/conversation');
const loadGuid = () => import('@renderer/pages/guid');
const loadAssistantSettings = () => import('@renderer/pages/settings/AssistantSettings');
const loadTeamIndex = () => import('@renderer/pages/team');
const loadSkillsSettings = () => import('@renderer/pages/settings/SkillsHubSettings');
const loadMcpPage = () => import('@renderer/pages/mcp');

const Conversation = React.lazy(loadConversation);
const Guid = React.lazy(loadGuid);
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AgentRepairPage = React.lazy(() => import('@renderer/pages/settings/AgentSettings/AgentRepairPage'));
const AssistantSettings = React.lazy(loadAssistantSettings);
const AppearanceSettings = React.lazy(() => import('@renderer/pages/settings/AppearanceSettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const CodexBridgeSettings = React.lazy(() => import('@renderer/pages/settings/CodexBridgeSettings'));
const ClaudeBridgeSettings = React.lazy(() => import('@renderer/pages/settings/ClaudeBridgeSettings'));
const EnterpriseSettings = React.lazy(() => import('@renderer/pages/settings/EnterpriseSettings'));
const EnterpriseIdentitySettings = React.lazy(() => import('@renderer/pages/settings/EnterpriseIdentitySettings'));
const CompanyConsole = React.lazy(() => import('@renderer/pages/enterprise/CompanyConsole'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage'));
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(loadTeamIndex);
const SuperAssistant = React.lazy(() => import('@renderer/pages/superAssistant'));
const EnterpriseLoginPage = React.lazy(() => import('@renderer/pages/enterprise/EnterpriseLoginPage'));
const EnterpriseConsole = React.lazy(() => import('@renderer/pages/enterprise/EnterpriseConsole'));
const MemoryPage = React.lazy(() => import('@renderer/pages/memory'));
const SessionCenter = React.lazy(() => import('@renderer/pages/SessionCenter'));
const SkillsSettings = React.lazy(loadSkillsSettings);
const SkillDetailPage = React.lazy(() => import('@renderer/pages/settings/skillsHub/SkillDetailPage'));
const McpPage = React.lazy(loadMcpPage);

const HIGH_TRAFFIC_ROUTE_LOADERS = [
  loadGuid,
  loadConversation,
  loadAssistantSettings,
  loadTeamIndex,
  loadMcpPage,
  loadSkillsSettings,
] as const;

/**
 * Warm the high-traffic route chunks after the first screen has painted. This
 * keeps the current page from lingering while a first-time navigation waits
 * for a large route module (notably Assistants, Teams, MCP, and Skills).
 */
const RouteChunkPreloader: React.FC = () => {
  useEffect(() => {
    const preload = () => {
      for (const load of HIGH_TRAFFIC_ROUTE_LOADERS) {
        void load().catch((error) => console.warn('[Router] Failed to preload route chunk:', error));
      }
    };
    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = globalThis.setTimeout(preload, 250);
    return () => globalThis.clearTimeout(timer);
  }, []);
  return null;
};

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

/**
 * Redirect for the legacy top-level skill detail route, preserving the
 * dynamic `:skillName` param (`<Navigate>` can't interpolate route params).
 */
const SkillDetailRedirect: React.FC = () => {
  const { skillName } = useParams<{ skillName: string }>();
  return <Navigate to={`/settings/skills/detail/${skillName ?? ''}`} replace />;
};

/**
 * `/login` route. When already authenticated, honor a validated `redirect`
 * query param (e.g. the "WebUI 管理员登录" entry passes
 * `?redirect=/enterprise/console`) instead of always bouncing to /guid.
 */
const LoginRoute: React.FC = () => {
  const { status } = useAuth();
  const [searchParams] = useSearchParams();
  if (status === 'checking') {
    return <AppLoader />;
  }
  if (status === 'authenticated') {
    return <Navigate to={resolveSafeRedirect(searchParams.get('redirect'))} replace />;
  }
  return withRouteFallback(LoginPage);
};

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <RouteChunkPreloader />
      <DocumentTitle />
      <Routes>
        <Route path='/login' element={<LoginRoute />} />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/assistants' element={withRouteFallback(AssistantSettings)} />
          {/* Assistants moved out of Settings to a top-level entry; keep a redirect
              so old deep links / back-nav still land on the new page. */}
          <Route path='/settings/assistants' element={<Navigate to='/assistants' replace />} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/agent/:id/repair' element={withRouteFallback(AgentRepairPage)} />
          {/* Legacy routes. The "Capabilities" page merged Skills Hub + MCP tools
              behind one sider entry; both halves now have their own homes
              (`/settings/skills` and the top-level `/mcp`), so the merged page is
              gone and its routes redirect to the surviving pages. */}
          <Route path='/settings/capabilities' element={<Navigate to='/settings/skills' replace />} />
          <Route
            path='/settings/capabilities/skills/import-history'
            element={<Navigate to='/settings/skills/import-history' replace />}
          />
          <Route path='/settings/capabilities/skills/detail/:skillName' element={<SkillDetailRedirect />} />
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/skills' replace />} />
          <Route path='/settings/tools' element={<Navigate to='/mcp' replace />} />
          <Route path='/settings/appearance' element={withRouteFallback(AppearanceSettings)} />
          <Route path='/settings/display' element={<Navigate to='/settings/appearance' replace />} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/codex-bridge' element={withRouteFallback(CodexBridgeSettings)} />
          <Route path='/settings/claude-bridge' element={withRouteFallback(ClaudeBridgeSettings)} />
          <Route path='/settings/enterprise' element={withRouteFallback(EnterpriseSettings)} />
          <Route path='/settings/enterprise-identity' element={withRouteFallback(EnterpriseIdentitySettings)} />
          <Route path='/settings/company' element={withRouteFallback(CompanyConsole)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/model' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
          {/* Super Assistant / My Skills / Memory now live under Settings (low-usage
              tools, moved out of the main sider into a dedicated Settings group).
              Old top-level routes redirect so stale links/history still resolve. */}
          <Route path='/settings/super-assistant' element={withRouteFallback(SuperAssistant)} />
          <Route path='/super-assistant' element={<Navigate to='/settings/super-assistant' replace />} />
          <Route path='/settings/memory' element={withRouteFallback(MemoryPage)} />
          <Route path='/memory' element={<Navigate to='/settings/memory' replace />} />
          <Route path='/settings/skills' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/import-history' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/detail/:skillName' element={withRouteFallback(SkillDetailPage)} />
          <Route path='/skills' element={<Navigate to='/settings/skills' replace />} />
          <Route path='/skills/import-history' element={<Navigate to='/settings/skills/import-history' replace />} />
          <Route path='/skills/detail/:skillName' element={<SkillDetailRedirect />} />
          <Route path='/enterprise/login' element={withRouteFallback(EnterpriseLoginPage)} />
          <Route path='/enterprise/console' element={withRouteFallback(EnterpriseConsole)} />
          <Route path='/enterprise' element={<Navigate to='/settings/enterprise' replace />} />
          <Route path='/sessions' element={withRouteFallback(SessionCenter)} />
          <Route path='/mcp' element={withRouteFallback(McpPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
