import classNames from 'classnames';
import React from 'react';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import {
  SettingsTabNavigateProvider,
  SettingsViewModeProvider,
} from '@/renderer/components/settings/SettingsModal/settingsViewContext';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';
import { useExtensionSettingsTabs } from '@/renderer/hooks/system/useExtensionSettingsTabs';
import {
  Brain,
  Communication,
  Earth,
  IdCard,
  Info,
  Lightning,
  LinkCloud,
  Peoples,
  Puzzle,
  Robot,
  System,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useExtI18n } from '@/renderer/hooks/system/useExtI18n';
import { BUILTIN_TAB_IDS, LEGACY_ANCHOR_REMAP, isSettingsItemActive } from './SettingsSider';
import './settings.css';

interface SettingsPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

type NavItem = { label: string; icon: React.ReactElement; path: string; id: string };

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export function getBuiltinSettingsNavItems(isDesktop: boolean, t: TranslateFn): NavItem[] {
  const builtinMap: Record<string, NavItem> = {
    model: { id: 'model', label: t('settings.model'), icon: <LinkCloud theme='outline' size='16' />, path: 'model' },
    assistants: {
      id: 'assistants',
      label: t('settings.assistants', { defaultValue: 'Assistants' }),
      icon: <Robot theme='outline' size='16' />,
      path: 'assistants',
    },
    agent: {
      id: 'agent',
      label: t('settings.agents', { defaultValue: 'Agents' }),
      icon: <Robot theme='outline' size='16' />,
      path: 'agent',
    },
    superAssistant: {
      id: 'superAssistant',
      label: t('common.superAssistant.title', { defaultValue: '超级助手' }),
      icon: <Robot theme='outline' size='16' />,
      path: 'super-assistant',
    },
    skills: {
      id: 'skills',
      label: t('common.sider.mySkills', { defaultValue: '我的技能' }),
      icon: <Lightning theme='outline' size='16' />,
      path: 'skills',
    },
    memory: {
      id: 'memory',
      label: t('common.sider.memory', { defaultValue: '记忆管理' }),
      icon: <Brain theme='outline' size='16' />,
      path: 'memory',
    },
    webui: {
      id: 'webui',
      label: t('settings.webui'),
      icon: isDesktop ? <Earth theme='outline' size='16' /> : <Communication theme='outline' size='16' />,
      path: 'webui',
    },
    enterprise: {
      id: 'enterprise',
      label: t('common.enterprise.title', { defaultValue: '项目组' }),
      icon: <Peoples theme='outline' size='16' />,
      path: 'enterprise',
    },
    enterpriseIdentity: {
      id: 'enterpriseIdentity',
      label: t('common.enterprise.identityTabTitle', { defaultValue: '企业身份' }),
      icon: <IdCard theme='outline' size='16' />,
      path: 'enterprise-identity',
    },
    system: { id: 'system', label: t('settings.system'), icon: <System theme='outline' size='16' />, path: 'system' },
    about: { id: 'about', label: t('settings.about'), icon: <Info theme='outline' size='16' />, path: 'about' },
  };

  return BUILTIN_TAB_IDS.map((id) => builtinMap[id]).filter((item): item is NavItem => item != null);
}

const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = ({ children, className, contentClassName }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();

  const extensionTabs = useExtensionSettingsTabs();

  const { resolveExtTabName } = useExtI18n();

  const menuItems = React.useMemo(() => {
    // Insert extension tabs before system (unanchored default) or at anchor position
    const result = [...getBuiltinSettingsNavItems(isDesktop, t)];
    const unanchored: IExtensionSettingsTab[] = [];
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();

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

    const toNavItem = (tab: IExtensionSettingsTab): NavItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? (
          <img src={resolvedIcon} alt='' className='w-16px h-16px object-contain' />
        ) : (
          <Puzzle theme='outline' size='16' />
        ),
        path: `ext/${tab.id}`,
      };
    };

    for (let i = result.length - 1; i >= 0; i--) {
      const id = result[i].id;
      const afters = afterMap.get(id);
      if (afters) result.splice(i + 1, 0, ...afters.map(toNavItem));
      const befores = beforeMap.get(id);
      if (befores) result.splice(i, 0, ...befores.map(toNavItem));
    }

    if (unanchored.length > 0) {
      const sysIdx = result.findIndex((item) => item.id === 'system');
      const idx = sysIdx >= 0 ? sysIdx : result.length;
      result.splice(idx, 0, ...unanchored.map(toNavItem));
    }

    return result;
  }, [isDesktop, t, extensionTabs, resolveExtTabName]);

  const containerClass = classNames(
    'settings-page-wrapper w-full min-h-full box-border overflow-y-auto',
    isMobile ? 'px-16px py-14px' : 'px-12px md:px-40px py-32px',
    className
  );

  const contentClass = classNames('settings-page-content mx-auto w-full md:max-w-1024px', contentClassName);

  const navigateToSettingsTab = React.useCallback(
    (tabId: string) => {
      const remapped = LEGACY_ANCHOR_REMAP[tabId] ?? tabId;
      void navigate(`/settings/${remapped}`);
    },
    [navigate]
  );

  return (
    <SettingsViewModeProvider value='page'>
      <SettingsTabNavigateProvider value={navigateToSettingsTab}>
        <div className={containerClass}>
          {isMobile && (
            <div className='settings-mobile-top-nav'>
              {menuItems.map((item) => {
                const active = isSettingsItemActive(pathname, item.path);
                return (
                  <button
                    key={item.path}
                    type='button'
                    className={classNames('settings-mobile-top-nav__item', {
                      'settings-mobile-top-nav__item--active': active,
                    })}
                    onClick={() => {
                      void navigate(`/settings/${item.path}`, { replace: true });
                    }}
                  >
                    <span className='settings-mobile-top-nav__icon'>{item.icon}</span>
                    <span className='settings-mobile-top-nav__label'>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className={contentClass}>{children}</div>
        </div>
      </SettingsTabNavigateProvider>
    </SettingsViewModeProvider>
  );
};

export default SettingsPageWrapper;
