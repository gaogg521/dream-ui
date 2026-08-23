import FlexFullContainer from '@/renderer/components/layout/FlexFullContainer';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  Brain,
  BuildingOne,
  Communication,
  Computer,
  Earth,
  IdCard,
  Info,
  Lightning,
  LinkCloud,
  Peoples,
  Puzzle,
  Robot,
  Speed,
  System,
} from '@icon-park/react';
import { useCompanyIdentity } from '@/renderer/pages/enterprise/hooks/useCompanyIdentity';
import { isSystemAdminRole, useOrgContext } from '@/renderer/pages/enterprise/hooks/useOrgContext';
import { useDeploymentRole } from '@renderer/hooks/enterprise/useDeploymentRole';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tooltip } from '@arco-design/web-react';
import { getSiderTooltipProps } from '@/renderer/utils/ui/siderTooltip';

/**
 * Builtin settings tab IDs in display order (must match router paths).
 * The order here also drives the mobile top nav in SettingsPageWrapper, and must
 * stay consistent with SETTINGS_GROUPS below — a group's members are expected to
 * be contiguous in this list.
 */
export const BUILTIN_TAB_IDS = [
  // AI core
  'agent',
  'model',
  'skills',
  'memory',
  // Apps & connections
  'superAssistant',
  'webui',
  'codexBridge',
  'claudeBridge',
  // Enterprise
  'company',
  'enterprise',
  'enterpriseIdentity',
  // Other
  'system',
  'about',
] as const;

/**
 * Legacy anchor IDs that have been merged into (or replaced by) other tabs.
 * When an extension anchors to one of these, it is redirected to the new host.
 * This keeps older extensions working without requiring them to update.
 *
 * `tools` is deliberately absent: MCP tools live on the top-level `/mcp` page,
 * which has no settings-sider row to anchor against. Extensions anchored to it
 * fall through to the "unanchored → before system" path, and
 * `navigateToSettingsTab('tools')` still resolves via the router's
 * `/settings/tools → /mcp` redirect.
 */
export const LEGACY_ANCHOR_REMAP: Record<string, string> = {
  'skills-hub': 'skills',
  capabilities: 'skills',
  display: 'appearance',
};

/**
 * Sider groups in display order. The header is rendered once, immediately before
 * the group's first *visible* member — not before a fixed id — because some
 * members are conditional (e.g. `company` only shows for company admins). Binding
 * to a fixed id would drop the whole header when that particular row is hidden,
 * silently merging the rest of the group into the previous one.
 *
 * Extension tabs anchored between these builtins inherit the enclosing group
 * visually.
 */
const SETTINGS_GROUPS: ReadonlyArray<{ headerKey: string; members: readonly string[] }> = [
  { headerKey: 'settings.groupAiCore', members: ['agent', 'model', 'skills', 'memory'] },
  { headerKey: 'settings.groupApp', members: ['superAssistant', 'webui', 'codexBridge', 'claudeBridge'] },
  { headerKey: 'settings.groupEnterprise', members: ['company', 'enterprise', 'enterpriseIdentity'] },
  { headerKey: 'settings.groupAbout', members: ['system', 'about'] },
];

type SiderItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
  isImageIcon?: boolean;
  /** Route path segment — for builtins: `/settings/{path}`, for extensions: `/settings/ext/{id}` */
  path: string;
};

const isSettingsItemActive = (pathname: string, itemPath: string): boolean => {
  const fullPath = `/settings/${itemPath}`;
  return pathname === fullPath || pathname.startsWith(`${fullPath}/`);
};

export { isSettingsItemActive };

const SettingsSider: React.FC<{ collapsed?: boolean; tooltipEnabled?: boolean }> = ({
  collapsed = false,
  tooltipEnabled = false,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isDesktop = isElectronDesktop();
  // Company admin console (Direction B). Shown when the viewer administers an
  // existing company, OR when this machine is a SERVER and the viewer is a
  // system_admin (so they can 设立企业 the first time). Personal / standalone is
  // client-mode by default → isServer is false → the entry stays hidden, so a
  // no-company system_admin on a personal install never sees it.
  const { company, isCompanyAdmin } = useCompanyIdentity();
  const { context } = useOrgContext();
  const { isServer } = useDeploymentRole();
  const showCompany = (Boolean(company) && isCompanyAdmin) || (isServer && isSystemAdminRole(context?.role));

  const extensionTabs = useExtensionSettingsTabs();
  const { resolveExtTabName } = useExtI18n();

  const { menus, groupHeaderAt } = useMemo(() => {
    // Build builtin items
    const builtinMap: Record<string, SiderItem> = {
      model: { id: 'model', label: t('settings.model'), icon: <LinkCloud />, path: 'model' },
      agent: {
        id: 'agent',
        label: t('settings.agents', { defaultValue: 'Agents' }),
        icon: <Speed />,
        path: 'agent',
      },
      superAssistant: {
        id: 'superAssistant',
        label: t('common.superAssistant.title', { defaultValue: '超级助手' }),
        icon: <Robot />,
        path: 'super-assistant',
      },
      skills: {
        id: 'skills',
        label: t('common.sider.mySkills', { defaultValue: '我的技能' }),
        icon: <Lightning />,
        path: 'skills',
      },
      memory: {
        id: 'memory',
        label: t('common.sider.memory', { defaultValue: '记忆管理' }),
        icon: <Brain />,
        path: 'memory',
      },
      appearance: { id: 'appearance', label: t('settings.appearancePanel'), icon: <Computer />, path: 'appearance' },
      webui: {
        id: 'webui',
        label: t('settings.webui'),
        icon: isDesktop ? <Earth /> : <Communication />,
        path: 'webui',
      },
      codexBridge: {
        id: 'codexBridge',
        label: t('settings.codexBridge.title'),
        icon: <LinkCloud />,
        path: 'codex-bridge',
      },
      claudeBridge: {
        id: 'claudeBridge',
        label: t('settings.claudeBridge.title'),
        icon: <LinkCloud />,
        path: 'claude-bridge',
      },
      company: {
        id: 'company',
        label: t('common.company.title', { defaultValue: '企业管理后台' }),
        icon: <BuildingOne />,
        path: 'company',
      },
      enterprise: {
        id: 'enterprise',
        label: t('common.enterprise.title', { defaultValue: '项目组' }),
        icon: <Peoples />,
        path: 'enterprise',
      },
      enterpriseIdentity: {
        id: 'enterpriseIdentity',
        label: t('common.enterprise.identityTabTitle', { defaultValue: '企业身份' }),
        icon: <IdCard />,
        path: 'enterprise-identity',
      },
      system: { id: 'system', label: t('settings.system'), icon: <System />, path: 'system' },
      about: { id: 'about', label: t('settings.about'), icon: <Info />, path: 'about' },
    };

    const result: SiderItem[] = BUILTIN_TAB_IDS.filter((id) => id !== 'company' || showCompany).map(
      (id) => builtinMap[id]
    );

    // Extension tabs with position anchoring
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();
    const unanchored: IExtensionSettingsTab[] = [];

    for (const tab of extensionTabs) {
      if (!tab.position) {
        unanchored.push(tab);
        continue;
      }
      const { relativeTo: rawAnchor, placement } = tab.position;
      const anchor = LEGACY_ANCHOR_REMAP[rawAnchor] ?? rawAnchor;
      if (!result.some((item) => item.id === anchor)) {
        unanchored.push(tab);
        continue;
      }
      const map = placement === 'before' ? beforeMap : afterMap;
      let list = map.get(anchor);
      if (!list) {
        list = [];
        map.set(anchor, list);
      }
      list.push(tab);
    }

    // Helper to create SiderItem from extension tab
    const toSiderItem = (tab: IExtensionSettingsTab): SiderItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? <img src={resolvedIcon} alt='' className='w-full h-full object-contain' /> : <Puzzle />,
        isImageIcon: Boolean(resolvedIcon),
        path: `ext/${tab.id}`,
      };
    };

    // Insert anchored tabs (reverse iteration to preserve indices)
    for (let i = result.length - 1; i >= 0; i--) {
      const builtinId = result[i].id;
      const afters = afterMap.get(builtinId);
      if (afters) {
        result.splice(i + 1, 0, ...afters.map(toSiderItem));
      }
      const befores = beforeMap.get(builtinId);
      if (befores) {
        result.splice(i, 0, ...befores.map(toSiderItem));
      }
    }

    // Append unanchored before "system"
    if (unanchored.length > 0) {
      const systemIdx = result.findIndex((item) => item.id === 'system');
      const insertIdx = systemIdx >= 0 ? systemIdx : result.length;
      result.splice(insertIdx, 0, ...unanchored.map(toSiderItem));
    }

    // Compute group header render positions.
    //
    // Anchor on the group's first *surviving* member rather than a fixed id, so a
    // hidden conditional row (e.g. `company` for non-admins) shifts the header
    // down to the next member instead of dropping it entirely.
    //
    // The anchor may itself be preceded by extension tabs anchored with
    // placement='before'; the header has to go above those too, otherwise such an
    // extension renders above the header and visually joins the previous group.
    const headerAt = new Map<number, string>();
    for (const { headerKey, members } of SETTINGS_GROUPS) {
      for (const memberId of members) {
        const memberIdx = result.findIndex((item) => item.id === memberId);
        if (memberIdx < 0) continue;
        const beforeCount = beforeMap.get(memberId)?.length ?? 0;
        headerAt.set(memberIdx - beforeCount, headerKey);
        break;
      }
    }

    return { menus: result, groupHeaderAt: headerAt };
  }, [t, isDesktop, extensionTabs, resolveExtTabName, showCompany]);

  // Scroll affordance: the sider is long enough to clip entries, but the global
  // scrollbar thumb is transparent until hovered, so nothing tells the user more
  // rows exist below. Expose "content continues past the bottom edge" as a data
  // attribute driving the fade mask in layout.css.
  //
  // Bottom edge only, deliberately: group headers are sticky, so once the user has
  // scrolled at all one is always pinned to the top edge — that is already the top
  // affordance, and a top fade would just paint over it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  const syncOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // 1px slack absorbs sub-pixel rounding at fractional zoom levels, which would
    // otherwise leave the fade permanently on when scrolled all the way down.
    setHasMoreBelow(scrollTop + clientHeight < scrollHeight - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncOverflow();
    // Content height changes without a scroll event (extension tabs loading in,
    // the company row appearing, the sider being resized by the drag handle).
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [syncOverflow, menus.length, collapsed]);

  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  return (
    <div
      ref={scrollRef}
      onScroll={syncOverflow}
      data-overflow-bottom={hasMoreBelow ? '' : undefined}
      className={classNames('h-full settings-sider flex flex-col gap-2px overflow-y-auto overflow-x-hidden', {
        'settings-sider--collapsed': collapsed,
      })}
    >
      {menus.map((item, index) => {
        const isSelected = isSettingsItemActive(pathname, item.path);
        const groupHeaderKey = groupHeaderAt.get(index);
        const groupHeader =
          groupHeaderKey && !collapsed ? (
            <div className='settings-sider__group-header px-12px mt-8px h-28px flex items-center text-14px font-[500] text-t-tertiary select-none'>
              {t(groupHeaderKey)}
            </div>
          ) : null;
        return (
          <React.Fragment key={item.id}>
            {groupHeader}
            <Tooltip {...siderTooltipProps} content={item.label} position='right'>
              <div
                data-settings-id={item.id}
                data-settings-path={item.path}
                className={classNames(
                  'settings-sider__item h-34px rd-8px flex items-center gap-8px group cursor-pointer relative overflow-hidden shrink-0 conversation-item [&.conversation-item+&.conversation-item]:mt-2px transition-colors',
                  collapsed ? 'w-full justify-center px-0' : 'justify-start px-10px',
                  {
                    'hover:bg-fill-3': !isSelected,
                    '!bg-fill-3': isSelected,
                  }
                )}
                onClick={() => {
                  Promise.resolve(navigate(`/settings/${item.path}`, { replace: true })).catch((error) => {
                    console.error('Navigation failed:', error);
                  });
                }}
              >
                {/* Leading icon — 22px slot to align with main sider rows */}
                <span className='size-22px flex items-center justify-center shrink-0 line-height-0'>
                  {item.isImageIcon ? (
                    <span className='w-16px h-16px flex items-center justify-center'>{item.icon}</span>
                  ) : (
                    React.cloneElement(
                      item.icon as React.ReactElement<{
                        theme?: string;
                        size?: string | number;
                        className?: string;
                        strokeWidth?: number;
                      }>,
                      {
                        theme: 'outline',
                        size: '16',
                        strokeWidth: 3,
                        className: 'block leading-none text-t-secondary',
                      }
                    )
                  )}
                </span>
                <FlexFullContainer className='h-24px collapsed-hidden'>
                  <div className='settings-sider__item-label text-nowrap overflow-hidden inline-block w-full text-14px font-[500] lh-24px whitespace-nowrap text-t-primary'>
                    {item.label}
                  </div>
                </FlexFullContainer>
              </div>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default SettingsSider;
